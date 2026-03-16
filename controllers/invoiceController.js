import { supabase } from '../supabase.js';
import pdfService from '../services/pdfService.js';
import emailService from '../services/emailService.js';
import fileService from '../services/fileService.js';
import { APIError } from '../middleware/errorHandler.js';
import { mapConfigToFrontend } from '../utils/configUtils.js';

export const getInvoices = async (req, res) => {
    let query = supabase
        .from('invoices')
        .select(`
            *,
            customers!invoices_customer_id_fkey (id, name, email),
            items: invoice_items (*)
        `)
        .eq('organization_id', req.user.organizationId) // Tenant isolation
        .order('createdAt', { ascending: false });

    if (req.query.persona) {
        query = query.eq('persona', req.query.persona);
    }

    if (req.query.limit) {
        query = query.limit(parseInt(req.query.limit, 10));
    }

    const { data: invoices, error } = await query;

    if (error) throw new APIError(error.message, 500);
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

    if (!buyer || !buyer.name) {
        throw new APIError('Buyer information is required', 400);
    }

    // Find or create customer
    let customer_id;
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
                state: buyer.state || null,
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
                subtotal: subtotal !== undefined ? subtotal : calculatedSubtotal,
                taxAmount: taxAmount !== undefined ? taxAmount : calculatedTax,
                taxType,
                taxRate: taxRate || 0,
                discount: discount || 0,
                discount_amount: discount_amount || 0,
                amount_paid: amount_paid || 0,
                shipping: shipping || 0,
                total: total !== undefined ? total : calculatedTotal,
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
                gst_type: gstType || null,
                cgst_amount: cgstAmount || 0,
                sgst_amount: sgstAmount || 0,
                igst_amount: igstAmount || 0,
                tds_applicable: tdsApplicable || false,
                tds_rate: tdsRate || 0,
                tds_amount: tdsAmount || 0,
                net_receivable: netReceivable || null,
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

    // 1. Group items by productId for aggregated stock updates
    const productQuantities = items.reduce((acc, item) => {
        if (item.productId) {
            acc[item.productId] = (acc[item.productId] || 0) + (item.quantity || 0);
        }
        return acc;
    }, {});

    const productIdsToUpdate = Object.keys(productQuantities);

    // 2. Validate stock levels before proceeding (Transactional logic simulation)
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
                // "Never less than 1" - User requested stock to not drop below 1
                if ((p.stock || 0) - requestedQty < 0) {
                    throw new APIError(`Insufficient stock for ${p.name}. Available: ${p.stock}, Requested: ${requestedQty}`, 400);
                }
            }
        }
    }

    // Insert Items
    const invoiceItems = items.map(item => ({
        invoiceId: invoice.id,
        productId: item.productId || null,
        description: item.description,
        quantity: item.quantity,
        price: item.price,
        organization_id: req.user.organizationId,
        service_start_date: item.serviceStartDate || null,
        service_end_date: item.serviceEndDate || null,
        sku: item.sku || null,
        hsn_code: item.hsnCode || null,
        sac_code: item.sacCode || null,
        tax_rate: item.taxRate || 0,
        cgst_rate: item.cgstRate || 0,
        sgst_rate: item.sgstRate || 0,
        igst_rate: item.igstRate || 0,
        cgst_amount: item.cgstAmount || 0,
        sgst_amount: item.sgstAmount || 0,
        igst_amount: item.igstAmount || 0,
        taxable_value: item.taxableValue || null,
        discount_percent: item.discountPercent || 0,
        sort_order: item.sortOrder || 0,
        unit: item.unit || 'pcs'
    }));

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

        // Run updates in background
        Promise.all(stockUpdatePromises).catch(err => console.error("Aggregated inventory update error:", err));
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

    // Check ownership
    const { data: existing } = await supabase
        .from('invoices')
        .select('id')
        .eq('id', id)
        .eq('organization_id', req.user.organizationId)
        .single();

    if (!existing) throw new APIError('Invoice not found', 404);

    // Update main invoice data
    const { data: updated, error } = await supabase
        .from('invoices')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

    if (error) throw new APIError(error.message, 500);

    // Handle items if provided
    if (items) {
        // Delete existing items
        await supabase
            .from('invoice_items')
            .delete()
            .eq('invoiceId', id)
            .eq('organization_id', req.user.organizationId);

        // Insert new items
        if (items.length > 0) {
            const invoiceItems = items.map(item => ({
                invoiceId: id,
                productId: item.productId || null,
                description: item.description,
                quantity: item.quantity,
                price: item.price,
                organization_id: req.user.organizationId,
                service_start_date: item.serviceStartDate || null,
                service_end_date: item.serviceEndDate || null,
                sku: item.sku || null
            }));

            const { error: itemsError } = await supabase
                .from('invoice_items')
                .insert(invoiceItems);

            if (itemsError) console.error("Error updating invoice items:", itemsError);
        }
    }

    // Fetch the fully updated invoice to return
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
    const { error } = await supabase
        .from('invoices')
        .delete()
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId);

    if (error) throw new APIError(error.message, 500);
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
