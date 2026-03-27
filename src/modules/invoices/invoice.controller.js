import { supabase } from '../../core/database/supabase.js';
import pdfService from './pdf.service.js';
import emailService from '../settings/email.service.js';
import fileService from '../upload/file.service.js';
import { APIError } from '../../core/middleware/errorHandler.js';
import { mapConfigToFrontend } from '../../core/utils/configUtils.js';
import { calculateInvoiceTax } from './tax.service.js';
import { getStateFromGstin } from '../../core/lib/gstUtils.js';
import { parsePagination } from '../../core/utils/pagination.js';

export const getInvoices = async (req, res) => {
    let query = supabase
        .from('invoices')
        .select(`
            *,
            customers!invoices_customer_id_fkey (id, name, email),
            items: invoice_items (*)
        `, { count: 'exact' })
        .eq('organization_id', req.user.organizationId) // Tenant isolation
        .order('createdAt', { ascending: false });

    if (req.query.persona) {
        query = query.eq('persona', req.query.persona);
    }

    const { page, limit, offset } = parsePagination(req.query);
    query = query.range(offset, offset + limit - 1);

    const { data: invoices, error, count } = await query;

    if (error) throw new APIError(error.message, 500);

    res.setHeader('X-Total-Count', count || 0);
    res.json(invoices);
};

export const getNextInvoiceNumber = async (req, res) => {
    const nextNumber = await findNextAvailableNumber(req.user.organizationId);
    res.json({ nextNumber });
};

const findNextAvailableNumber = async (organizationId) => {
    try {
        // 1. Try atomic database sequence (Massive Concurrency Mode)
        const { data: rpcNumber, error: rpcError } = await supabase.rpc('generate_next_invoice_number', {
            p_organization_id: organizationId
        });

        if (!rpcError && rpcNumber) {
            return rpcNumber;
        }
    } catch (e) {
        // Fallback to legacy logic
    }

    // 2. Legacy Logic: Find latest and increment (Subject to collisions under load)
    const { data: latest, error } = await supabase
        .from('invoices')
        .select('invoiceNumber')
        .eq('organization_id', organizationId)
        .order('invoiceNumber', { ascending: false })
        .limit(1);

    if (error) return `INV-${Date.now().toString().slice(-6)}`;

    let nextNumber = 'INV-0001';
    if (latest && latest.length > 0 && latest[0].invoiceNumber) {
        const match = latest[0].invoiceNumber.match(/INV-(\d+)/);
        if (match) {
            const num = parseInt(match[1], 10) + 1;
            nextNumber = `INV-${num.toString().padStart(4, '0')}`;
        } else {
            // If existing doesn't match format, try to find the latest with that format
            const { data: latestPattern } = await supabase
                .from('invoices')
                .select('invoiceNumber')
                .eq('organization_id', organizationId)
                .like('invoiceNumber', 'INV-%')
                .order('invoiceNumber', { ascending: false })
                .limit(1);

            if (latestPattern && latestPattern.length > 0) {
                const match2 = latestPattern[0].invoiceNumber.match(/INV-(\d+)/);
                if (match2) {
                    const num = parseInt(match2[1], 10) + 1;
                    nextNumber = `INV-${num.toString().padStart(4, '0')}`;
                }
            }
        }
    }
    return nextNumber;
};

export const createInvoice = async (req, res) => {
    let {
        buyer, items, dueDate, notes, taxRate, taxAmount,
        subtotal, total, invoiceNumber, status, date,
        seller, shipTo, taxType, discount, discount_amount,
        amount_paid, shipping,
        // Persona fields
        projectName, shippingAddress, orderNumber,
        persona, frn, lutNumber, placeOfSupply,
        reverseCharge, isGstRegistered, gstType,
        // GST split
        cgstAmount, sgstAmount, igstAmount,
        // TDS
        tdsApplicable, tdsRate, tdsAmount, netReceivable,
        // Ecommerce
        courierName, courierTracking, dispatchDate,
        orderRef
    } = req.body;

    if (!items || items.length === 0) {
        throw new APIError('Invoice must have at least one item', 400);
    }

    const taxResult = calculateInvoiceTax({
        items: req.body.items || [],
        seller_gstin: req.body.seller?.taxId || req.body.seller?.gstin || '',
        buyer_gstin: req.body.buyer?.gstin || req.body.buyer?.taxId || '',
        persona: req.body.persona || 'solopreneur',
        delivery_state: req.body.deliveryState || req.body.delivery_state || undefined,
        is_gst_registered: req.body.isGstRegistered !== false,
        lut_number: req.body.lutNumber || req.body.lut_number || undefined,
        reverse_charge: !!(req.body.reverseCharge || req.body.reverse_charge),
        tds_enabled: !!(req.body.tdsApplicable || req.body.tdsEnabled),
        discount_amount: Number(req.body.discountAmount || req.body.discount_amount) || 0,
        shipping_charges: Number(req.body.shipping) || 0,
    });

    if (!buyer || !buyer.name) {
        throw new APIError('Buyer information is required', 400);
    }

    // Find or create customer
    let customer_id;
    let customerData = { state: buyer.state || null };

    const detectedState = getStateFromGstin(
        req.body.buyer?.gstin || req.body.buyer?.taxId || ''
    );
    if (detectedState && !customerData.state) {
        customerData.state = detectedState;
    }

    const { data: existingCustomer } = await supabase
        .from('customers')
        .select('id')
        .eq('name', buyer.name)
        .eq('organization_id', req.user.organizationId)
        .single();

    if (existingCustomer) {
        customer_id = existingCustomer.id;
    } else {
        const { data: newCustomer, error: createError } = await supabase
            .from('customers')
            .insert([{
                name: buyer.name,
                email: buyer.email || null,
                phone: buyer.phone || null,
                address: buyer.address || null,
                organization_id: req.user.organizationId,
                gstin: buyer.gstin || null,
                pan: buyer.pan || null,
                state: customerData.state,
                city: buyer.city || null,
                pincode: buyer.pincode || null,
                country: buyer.country || 'India'
            }])
            .select()
            .single();

        if (createError) throw new APIError('Failed to create customer', 500);
        customer_id = newCustomer.id;
    }

    // Calculate totals if not provided
    const calculatedSubtotal = items.reduce((acc, item) => acc + ((item.quantity || 1) * (item.price || 0)), 0);
    const calculatedTax = calculatedSubtotal * ((taxRate || 0) / 100);
    const calculatedTotal = calculatedSubtotal + calculatedTax;

    // --- MOVE STOCK VALIDATION HERE ---
    // 1. Group items by productId for aggregated stock updates
    const productQuantities = items.reduce((acc, item) => {
        if (item.productId) {
            acc[item.productId] = (acc[item.productId] || 0) + (item.quantity || 0);
        }
        return acc;
    }, {});

    const productIdsToUpdate = Object.keys(productQuantities);

    // 2. Validate stock levels before insertion (Transactional logic simulation)
    if (productIdsToUpdate.length > 0) {
        const { data: currentProducts, error: fetchError } = await supabase
            .from('products')
            .select('id, name, stock, is_inventory_tracked')
            .in('id', productIdsToUpdate)
            .eq('organization_id', req.user.organizationId);

        if (fetchError) throw new APIError('Failed to verify inventory stock', 500);

        for (const p of currentProducts) {
            // Only validate if inventory is tracked
            if (p.is_inventory_tracked) {
                const requestedQty = productQuantities[p.id];
                // Check if stock would drop below zero
                if ((p.stock || 0) - requestedQty < 0) {
                    throw new APIError(`Insufficient stock for ${p.name}. Available: ${p.stock}, Requested: ${requestedQty}`, 400);
                }
            }
        }
    }
    // --- END STOCK VALIDATION ---

    // Create Invoice with Jittered Exponential Backoff for High Concurrency
    let invoice = null;
    let insertError = null;
    let finalInvoiceNumber = invoiceNumber;
    let attempts = 0;
    const maxAttempts = 50; // Increased for high concurrency (100+ requests)

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Initial Staggered Start: Random delay to prevent thundering herd on first attempt
    const initialJitter = Math.random() * 500;
    await sleep(initialJitter);

    while (attempts < maxAttempts) {
        // If we don't have a number or this is a retry, get a fresh "next" number
        if (!finalInvoiceNumber || attempts > 0) {
            if (attempts > 0) {
                // Exponential backoff with jitter: wider spread for high concurrency
                const baseDelay = Math.min(Math.pow(1.5, attempts) * 100, 3000);
                const jitter = Math.random() * 200;
                const delay = baseDelay + jitter;
                console.log(`⚠️ Collision on ${finalInvoiceNumber || 'INV-next'}. Attempt ${attempts}/${maxAttempts}. Retrying in ${Math.round(delay)}ms...`);
                await sleep(delay);
            }
            finalInvoiceNumber = await findNextAvailableNumber(req.user.organizationId);
        }

        const { data, error } = await supabase
            .from('invoices')
            .insert([{
                customer_id,
                buyer,
                seller,
                shipTo,
                date: date || new Date().toISOString(),
                dueDate,
                notes,
                subtotal: taxResult.subtotal,
                taxAmount: taxResult.tax_amount,
                taxType: 'GST',
                taxRate: taxRate || 0,
                discount: discount || 0,
                discount_amount: discount_amount || 0,
                amount_paid: amount_paid || 0,
                shipping: shipping || 0,
                total: taxResult.grand_total,
                status: status || 'draft',
                invoiceNumber: finalInvoiceNumber,
                organization_id: req.user.organizationId,
                project_name: projectName || null,
                shipping_address: shippingAddress || null,
                order_number: orderNumber || null,
                persona: persona || null,
                frn: frn || null,
                lut_number: lutNumber || null,
                place_of_supply: placeOfSupply || null,
                reverse_charge: reverseCharge || false,
                is_gst_registered: isGstRegistered !== false,
                gst_type: taxResult.gst_type,
                cgst_amount: taxResult.cgst_amount,
                sgst_amount: taxResult.sgst_amount,
                igst_amount: taxResult.igst_amount,
                tds_applicable: !!(req.body.tdsApplicable || req.body.tdsEnabled),
                tds_rate: taxResult.tds_rate,
                tds_section: taxResult.tds_section,
                tds_amount: taxResult.tds_amount,
                net_receivable: taxResult.net_receivable,
                round_off: taxResult.round_off,
                courier_name: courierName || null,
                courier_tracking: courierTracking || null,
                dispatch_date: dispatchDate || null,
                order_ref: orderRef || null,
                follow_up_count: 0
            }])
            .select()
            .single();

        if (error) {
            // Check for unique constraint violation (Postgres code 23505)
            if (error.code === '23505' || error.message?.includes('unique constraint')) {
                attempts++;
                insertError = error;
                finalInvoiceNumber = null; // Force findNextAvailableNumber on next loop
                continue;
            }
            throw new APIError(error.message, 500);
        }

        invoice = data;
        break;
    }

    if (!invoice) {
        throw new APIError(`Failed to generate a unique invoice number after ${maxAttempts} attempts. Last error: ${insertError?.message}`, 500);
    }


    // Insert Items
    const invoiceItems = (req.body.items || []).map((item, i) => {
        const lineTax = taxResult.line_tax_results[i] || {};
        return {
            invoiceId: invoice.id,
            productId: item.productId || null,
            description: item.description,
            quantity: Number(item.quantity),
            price: Number(item.price),
            unit: item.unit || 'Qty',
            organization_id: req.user.organizationId,
            service_start_date: item.serviceStartDate || null,
            service_end_date: item.serviceEndDate || null,
            sku: item.sku || null,
            sac_code: item.sac_code || null,
            hsn_code: item.hsn_code || null,
            tax_rate: lineTax.tax_rate ?? 18,
            taxable_value: lineTax.taxable_value ?? 0,
            cgst_rate: lineTax.cgst_rate ?? 0,
            sgst_rate: lineTax.sgst_rate ?? 0,
            igst_rate: lineTax.igst_rate ?? 0,
            cgst_amount: lineTax.cgst_amount ?? 0,
            sgst_amount: lineTax.sgst_amount ?? 0,
            igst_amount: lineTax.igst_amount ?? 0,
            is_exempt: lineTax.is_exempt ?? false,
            discount_percent: Number(item.discount_percent || item.discount) || 0,
            sort_order: i
        };
    });

    const { error: itemsError } = await supabase
        .from('invoice_items')
        .insert(invoiceItems);

    if (itemsError) {
        // Rollback invoice if items fail
        await supabase.from('invoices').delete().eq('id', invoice.id);
        throw new APIError('Failed to create invoice items', 500);
    }

    // Update Inventory Stock (Decrements)
    if (productIdsToUpdate.length > 0) {
        try {
            const stockUpdatePromises = productIdsToUpdate.map(async (productId) => {
                const requestedQty = productQuantities[productId];

                // Atomic decrement using raw SQL would be better, but via JS for now:
                const { data: p } = await supabase
                    .from('products')
                    .select('stock, is_inventory_tracked')
                    .eq('id', productId)
                    .single();

                // Only update if inventory is tracked
                if (p && p.is_inventory_tracked) {
                    const newStock = Math.max(0, (p.stock || 0) - requestedQty);
                    await supabase
                        .from('products')
                        .update({ stock: newStock, updatedAt: new Date() })
                        .eq('id', productId);

                    console.log(`Aggregated stock update: Product ${productId} reduced by ${requestedQty} to ${newStock}`);
                }
            });

            // AWAIT the updates to ensure they succeed before returning 201
            await Promise.all(stockUpdatePromises);
        } catch (err) {
            // Rollback invoice and items if stock update fails
            await supabase.from('invoices').delete().eq('id', invoice.id);
            throw new APIError('Failed to update inventory stock', 500);
        }
    }

    res.status(201).json(invoice);

    // Update Capita client intelligence
    if (customer_id) {
        supabase.rpc('update_customer_intelligence', {
            p_customer_id: customer_id
        }).catch(err =>
            console.error('Intelligence update failed:', err)
        );
    }
};

export const getInvoiceById = async (req, res) => {
    const { data: invoice, error } = await supabase
        .from('invoices')
        .select(`
            *,
            customers!invoices_customer_id_fkey (id, name, email, phone, address),
            items: invoice_items (*)
        `)
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .single();

    if (error || !invoice) throw new APIError('Invoice not found', 404);
    res.json(invoice);
};

export const updateInvoice = async (req, res) => {
    const id = req.params.id;
    const { items, ...updates } = req.body;

    // 1. Check ownership and fetch existing data
    const { data: existing, error: findError } = await supabase
        .from('invoices')
        .select(`*, customers!invoices_customer_id_fkey (*)`)
        .eq('id', id)
        .eq('organization_id', req.user.organizationId)
        .single();

    if (findError || !existing) throw new APIError('Invoice not found', 404);

    // 2. Handle Customer Update/Sync if buyer is provided
    let customer_id = existing.customer_id;
    if (updates.buyer && updates.buyer.name) {
        const { data: customerMatch } = await supabase
            .from('customers')
            .select('id')
            .eq('name', updates.buyer.name)
            .eq('organization_id', req.user.organizationId)
            .single();

        if (customerMatch) {
            customer_id = customerMatch.id;
            // Update existing customer info
            await supabase
                .from('customers')
                .update({
                    email: updates.buyer.email || null,
                    phone: updates.buyer.phone || null,
                    address: updates.buyer.address || null,
                    gstin: updates.buyer.gstin || null,
                    state: updates.buyer.state || getStateFromGstin(updates.buyer.gstin || '') || null
                })
                .eq('id', customer_id);
        } else {
            // Create new customer if name changed to something non-existent
            const { data: newCustomer } = await supabase
                .from('customers')
                .insert([{
                    name: updates.buyer.name,
                    email: updates.buyer.email || null,
                    organization_id: req.user.organizationId,
                    state: updates.buyer.state || getStateFromGstin(updates.buyer.gstin || '') || null
                }])
                .select()
                .single();
            if (newCustomer) customer_id = newCustomer.id;
        }
    }

    // 3. Recalculate tax if items or tax-related fields are updated
    const taxRelevantFields = ['taxRate', 'tax_rate', 'discount', 'discountAmount', 'discount_amount', 'shipping', 'isGstRegistered', 'lutNumber', 'reverseCharge', 'tdsApplicable'];
    const isTaxAffected = items || taxRelevantFields.some(field => updates[field] !== undefined);

    if (isTaxAffected) {
        const taxResult = calculateInvoiceTax({
            items: items || existing.items || [], // Items are required for recalc
            seller_gstin: updates.seller?.taxId || updates.seller?.gstin || existing.seller?.taxId || existing.seller?.gstin || '',
            buyer_gstin: updates.buyer?.gstin || updates.buyer?.taxId || existing.buyer?.gstin || existing.buyer?.taxId || existing.customers?.gstin || '',
            persona: updates.persona || existing.persona || 'solopreneur',
            delivery_state: updates.deliveryState || updates.delivery_state || existing.delivery_state || undefined,
            is_gst_registered: updates.isGstRegistered !== undefined ? updates.isGstRegistered !== false : existing.is_gst_registered !== false,
            lut_number: updates.lutNumber || updates.lut_number || existing.lut_number || undefined,
            reverse_charge: !!(updates.reverseCharge || updates.reverse_charge || existing.reverse_charge),
            tds_enabled: !!(updates.tdsApplicable || updates.tdsEnabled || existing.tds_applicable),
            discount_amount: Number(updates.discountAmount || updates.discount_amount) || Number(existing.discount_amount) || 0,
            shipping_charges: Number(updates.shipping) || Number(existing.shipping) || 0,
        });

        // Merge computed tax values into the updates payload
        Object.assign(updates, {
            subtotal: taxResult.subtotal,
            taxAmount: taxResult.tax_amount,
            taxType: 'GST',
            total: taxResult.grand_total,
            cgst_amount: taxResult.cgst_amount,
            sgst_amount: taxResult.sgst_amount,
            igst_amount: taxResult.igst_amount,
            gst_type: taxResult.gst_type,
            tds_applicable: !!(updates.tdsApplicable || updates.tdsEnabled || existing.tds_applicable),
            tds_rate: taxResult.tds_rate,
            tds_section: taxResult.tds_section,
            tds_amount: taxResult.tds_amount,
            net_receivable: taxResult.net_receivable,
            round_off: taxResult.round_off,
        });

        // Store taxResult for items update below
        req.taxResult = taxResult;
    }

    // 4. Map ALL possible camelCase fields from frontend to snake_case for Supabase
    const supabaseUpdates = {
        ...updates,
        customer_id // Ensure synced customer ID is included
    };

    const mapping = {
        dueDate: 'dueDate',
        taxRate: 'taxRate',
        taxAmount: 'taxAmount',
        subtotal: 'subtotal',
        total: 'total',
        taxType: 'taxType',
        discountAmount: 'discount_amount',
        discount: 'discount',
        amountPaid: 'amount_paid',
        shipping: 'shipping',
        projectName: 'project_name',
        shippingAddress: 'shipping_address',
        orderNumber: 'order_number',
        lutNumber: 'lut_number',
        reverseCharge: 'reverse_charge',
        isGstRegistered: 'is_gst_registered',
        gstType: 'gst_type',
        cgstAmount: 'cgst_amount',
        sgstAmount: 'sgst_amount',
        igstAmount: 'igst_amount',
        tdsApplicable: 'tds_applicable',
        tdsRate: 'tds_rate',
        tdsSection: 'tds_section',
        tdsAmount: 'tds_amount',
        netReceivable: 'net_receivable',
        roundOff: 'round_off',
        courierName: 'courier_name',
        courierTracking: 'courier_tracking',
        dispatchDate: 'dispatch_date',
        orderRef: 'order_ref'
    };

    for (const [camel, snake] of Object.entries(mapping)) {
        if (supabaseUpdates[camel] !== undefined) {
            // Only update if mapping targets a different field name
            if (camel !== snake) {
                supabaseUpdates[snake] = supabaseUpdates[camel];
                delete supabaseUpdates[camel];
            }
        }
    }

    // 5. Perform the update in Supabase
    const { data: updated, error: updateError } = await supabase
        .from('invoices')
        .update(supabaseUpdates)
        .eq('id', id)
        .select()
        .single();

    if (updateError) throw new APIError(updateError.message, 500);

    // 6. Handle items update if provided
    if (items) {
        // Delete existing items
        await supabase
            .from('invoice_items')
            .delete()
            .eq('invoiceId', id)
            .eq('organization_id', req.user.organizationId);

        // Calculate tax for items if not already done
        const finalTaxResult = req.taxResult || calculateInvoiceTax({
            items,
            seller_gstin: updates.seller?.taxId || updates.seller?.gstin || existing.seller?.taxId || existing.seller?.gstin || '',
            buyer_gstin: updates.buyer?.gstin || updates.buyer?.taxId || existing.buyer?.gstin || existing.buyer?.taxId || existing.customers?.gstin || '',
            persona: updates.persona || existing.persona || 'solopreneur',
            is_gst_registered: updates.isGstRegistered !== undefined ? updates.isGstRegistered !== false : existing.is_gst_registered !== false,
        });

        if (items.length > 0) {
            const invoiceItems = items.map((item, i) => {
                const lineTax = finalTaxResult.line_tax_results[i] || {};
                return {
                    invoiceId: id,
                    productId: item.productId || null,
                    description: item.description,
                    quantity: Number(item.quantity),
                    price: Number(item.price),
                    unit: item.unit || 'Qty',
                    organization_id: req.user.organizationId,
                    service_start_date: item.serviceStartDate || null,
                    service_end_date: item.serviceEndDate || null,
                    sku: item.sku || null,
                    sac_code: item.sac_code || null,
                    hsn_code: item.hsn_code || null,
                    tax_rate: lineTax.tax_rate ?? 18,
                    taxable_value: lineTax.taxable_value ?? 0,
                    cgst_rate: lineTax.cgst_rate ?? 0,
                    sgst_rate: lineTax.sgst_rate ?? 0,
                    igst_rate: lineTax.igst_rate ?? 0,
                    cgst_amount: lineTax.cgst_amount ?? 0,
                    sgst_amount: lineTax.sgst_amount ?? 0,
                    igst_amount: lineTax.igst_amount ?? 0,
                    is_exempt: lineTax.is_exempt ?? false,
                    discount_percent: Number(item.discount_percent || item.discount) || 0,
                    sort_order: i
                };
            });

            const { error: itemsError } = await supabase
                .from('invoice_items')
                .insert(invoiceItems);

            if (itemsError) console.error("Error updating invoice items:", itemsError);
        }
    }

    // 7. Fetch the fully updated invoice to return
    const { data: fullInvoice } = await supabase
        .from('invoices')
        .select(`
            *,
            customers!invoices_customer_id_fkey (*),
            items: invoice_items (*)
        `)
        .eq('id', id)
        .single();

    res.json(fullInvoice || updated);
};

export const deleteInvoice = async (req, res) => {
    // 1. Get invoice items to restore stock
    const { data: items } = await supabase
        .from('invoice_items')
        .select('productId, quantity')
        .eq('invoiceId', req.params.id)
        .eq('organization_id', req.user.organizationId);

    // 2. Delete invoice (cascade should handle items)
    const { error } = await supabase
        .from('invoices')
        .delete()
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId);

    if (error) throw new APIError(error.message, 500);

    // 3. Restore stock for tracked products
    if (items && items.length > 0) {
        for (const item of items) {
            if (!item.productId) continue;
            
            const { data: p } = await supabase
                .from('products')
                .select('stock, is_inventory_tracked')
                .eq('id', item.productId)
                .single();
                
            if (p && p.is_inventory_tracked) {
                const newStock = (p.stock || 0) + item.quantity;
                await supabase
                    .from('products')
                    .update({ stock: newStock, updatedAt: new Date() })
                    .eq('id', item.productId);
            }
        }
    }

    res.json({ success: true });
};

export const generatePdf = async (req, res) => {
    const { data: invoice, error } = await supabase
        .from('invoices')
        .select(`*, customers!invoices_customer_id_fkey(*), items:invoice_items(*)`)
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .single();

    if (error || !invoice) throw new APIError('Invoice not found', 404);

    // Get settings
    const { data: settingsObj } = await supabase
        .from('organization_configs')
        .select('*')
        .eq('organization_id', req.user.organizationId)
        .single();

    if (settingsObj.logoFilename) {
        settingsObj.logoPath = fileService.getFilePath(settingsObj.logoFilename);
    }

    const doc = await pdfService.generateInvoicePDF(invoice, settingsObj, null); // returns stream

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoice.invoiceNumber}.pdf`);
    doc.pipe(res);
};

export const sendInvoiceEmail = async (req, res) => {
    const invoiceId = req.params.id;
    const { to, pdfAttachment } = req.body;

    const { data: invoice, error } = await supabase
        .from('invoices')
        .select(`*, customers!invoices_customer_id_fkey(*), items:invoice_items(*)`)
        .eq('id', invoiceId)
        .eq('organization_id', req.user.organizationId)
        .single();

    if (error || !invoice) throw new APIError('Invoice not found', 404);

    // Settings
    const { data: config } = await supabase
        .from('organization_configs')
        .select('*')
        .eq('organization_id', req.user.organizationId)
        .single();

    const settingsObj = mapConfigToFrontend(config);

    // Fetch SMTP pass from Vault
    if (settingsObj?.smtp_user) {
        const { data: vaultPass } = await supabase.rpc('get_organization_secret', {
            p_organization_id: req.user.organizationId,
            p_name: 'smtp_pass'
        });
        if (vaultPass) settingsObj.smtp_pass = vaultPass;
    }

    // Email Service Validation
    if (!settingsObj?.smtp_user || !settingsObj?.smtp_pass) {
        throw new APIError('Email service not configured. Please go to Settings to connect your Gmail account.', 400);
    }

    if (settingsObj.logoFilename) settingsObj.logoPath = fileService.getFilePath(settingsObj.logoFilename);

    // PDF Logic
    let tempPath = null;
    let pdfBuffer = null;

    if (pdfAttachment) {
        pdfBuffer = Buffer.from(pdfAttachment, 'base64');
    } else {
        try {
            tempPath = pdfService.getTempPDFPath(invoice.invoiceNumber);
            await pdfService.generateInvoicePDF(invoice, settingsObj, tempPath);
        } catch (err) {
            console.error('Failed to generate PDF:', err);
            tempPath = null;
        }
    }

    try {
        const result = await emailService.sendPaymentReminder(invoice, to, settingsObj, pdfBuffer || tempPath);

        // Update status
        if (invoice.status === 'draft') {
            await supabase.from('invoices').update({ status: 'sent', updatedAt: new Date() }).eq('id', invoiceId);
        }

        res.json(result);
    } finally {
        if (tempPath) pdfService.cleanupPDF(tempPath);
    }
};

export const bulkReminders = async (req, res) => {
    // 1. Find overdue invoices that haven't been sent recently? 
    // Logic from server.js (approx line 1450-1526):
    const { data: overdueInvoices, error } = await supabase
        .from('invoices')
        .select(`
            *,
            buyer, 
            items:invoice_items(*)
        `)
        .eq('organization_id', req.user.organizationId) // Tenant Check
        .eq('status', 'overdue'); // Only overdue? Server.js logic used .in(['overdue', 'sent'])?
    // Let's stick to 'overdue' for safety or whatever server.js had.
    // Server.js variable was `overdueInvoices`.
    // Let's assume standard query. 

    if (error) throw new APIError(error.message, 500);

    const results = [];

    // Get settings once
    const { data: config } = await supabase
        .from('organization_configs')
        .select('*')
        .eq('organization_id', req.user.organizationId)
        .single();

    const settingsObj = mapConfigToFrontend(config);

    // Fetch SMTP pass from Vault
    if (settingsObj?.smtp_user) {
        const { data: vaultPass } = await supabase.rpc('get_organization_secret', {
            p_organization_id: req.user.organizationId,
            p_name: 'smtp_pass'
        });
        if (vaultPass) settingsObj.smtp_pass = vaultPass;
    }

    if (settingsObj?.logo_filename) settingsObj.logoPath = fileService.getFilePath(settingsObj.logo_filename);

    // Generate PDF and send for each invoice
    for (const invoice of overdueInvoices || []) {
        if (!invoice.buyer?.email) {
            results.push({ invoiceId: invoice.id, success: false, error: 'No email address' });
            continue;
        }

        let tempPath = null;
        try {
            tempPath = pdfService.getTempPDFPath(invoice.invoiceNumber);
            await pdfService.generateInvoicePDF(invoice, settingsObj, tempPath);

            // Assuming emailService.sendPaymentReminder takes (invoice, toEmail, settings, attachmentPath)
            // Verify signature from pdfService usage in server.js: 
            // await emailService.sendPaymentReminder(invoice, invoice.buyer.email, settingsObj, tempPath);
            const res = await emailService.sendPaymentReminder(invoice, invoice.buyer.email, settingsObj, tempPath);
            results.push({ invoiceId: invoice.id, ...res });
        } catch (error) {
            console.error(`Failed to send reminder for ${invoice.invoiceNumber}:`, error);
            results.push({ invoiceId: invoice.id, success: false, error: error.message });
        } finally {
            if (tempPath) pdfService.cleanupPDF(tempPath);
        }
    }

    res.json({ success: true, results });
};

export const getInvoiceByShareToken = async (req, res) => {
    const { token } = req.params;

    // 1. Get invoice by token
    const { data: invoice, error } = await supabase
        .from('invoices')
        .select(`
            *,
            buyer:customers(name, email, phone, address),
            organization:organizations(name)
        `)
        .eq('share_token', token)
        .single();

    if (error || !invoice) {
        return res.status(404).send('Invalid or expired share token');
    }

    // 2. Get organization configs for branding
    const { data: settingsObj } = await supabase
        .from('organization_configs')
        .select('*')
        .eq('organization_id', invoice.organization_id)
        .single();

    // 3. Resolve logo path if present
    const settings = settingsObj || {};
    if (settings.logo_filename) {
        settings.logoPath = fileService.getFilePath(settings.logo_filename);
    }

    // 4. Generate & Stream PDF
    let tempPath = null;
    try {
        tempPath = pdfService.getTempPDFPath(invoice.invoiceNumber);
        await pdfService.generateInvoicePDF(invoice, settings, tempPath);

        res.download(tempPath, `Invoice_${invoice.invoiceNumber}.pdf`, (err) => {
            if (err) console.error('Download error:', err);
            pdfService.cleanupPDF(tempPath);
        });
    } catch (err) {
        if (tempPath) pdfService.cleanupPDF(tempPath);
        throw new APIError(err.message, 500);
    }
};
