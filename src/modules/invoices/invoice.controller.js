import crypto from 'crypto';
import { supabase } from '../../core/database/supabase.js';
import pdfService from './pdf.service.js';
import emailService from '../../core/services/email.service.js';
import fileService from '../../core/services/file.service.js';
import { APIError } from '../../core/middleware/errorHandler.js';
import { mapConfigToFrontend } from '../../core/utils/configUtils.js';
import { calculateInvoiceTax } from './tax.service.js';
import { getStateFromGstin } from '../../core/lib/gstUtils.js';
import { parsePagination } from '../../core/utils/pagination.js';
import {
    attachResolvedInvoiceStatus,
    normalizeStoredInvoiceStatus
} from './invoiceStatus.service.js';
import { DEFAULTS } from '../../core/config/constants.js';

const escapeLikePattern = (value = '') => value.replace(/[%_]/g, '\\$&');
const SHARE_SCHEMA_COLUMNS = ['shared_enabled', 'share_expires_at', 'share_revoked_at'];

const isMissingShareColumnError = (error) =>
    Boolean(error?.message) &&
    SHARE_SCHEMA_COLUMNS.some((column) => error.message.includes(column));

const getDefaultShareExpiry = () => {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + DEFAULTS.SHARE_LINK_EXPIRY_DAYS);
    return expiresAt.toISOString();
};

const isShareAccessible = (invoice) => {
    if (!invoice) return false;
    if (invoice.shared_enabled === false) return false;
    if (invoice.share_revoked_at) return false;
    if (invoice.share_expires_at && new Date(invoice.share_expires_at).getTime() <= Date.now()) return false;
    return true;
};

const applyShareState = async (invoiceId, organizationId, updates, fallbackUpdates = {}) => {
    const primary = await supabase
        .from('invoices')
        .update(updates)
        .eq('id', invoiceId)
        .eq('organization_id', organizationId)
        .select(`
            *,
            customers!invoices_customer_id_fkey (*),
            items: invoice_items (*)
        `)
        .single();

    if (!primary.error) {
        return primary.data;
    }

    if (!isMissingShareColumnError(primary.error) || !Object.keys(fallbackUpdates).length) {
        throw new APIError(primary.error.message, 500);
    }

    const fallback = await supabase
        .from('invoices')
        .update(fallbackUpdates)
        .eq('id', invoiceId)
        .eq('organization_id', organizationId)
        .select(`
            *,
            customers!invoices_customer_id_fkey (*),
            items: invoice_items (*)
        `)
        .single();

    if (fallback.error) {
        throw new APIError(fallback.error.message, 500);
    }

    return fallback.data;
};

const getOrCreateOrganizationConfig = async (organizationId) => {
    const { data: existingConfig, error: configError } = await supabase
        .from('organization_configs')
        .select('*')
        .eq('organization_id', organizationId)
        .maybeSingle();

    if (configError) {
        throw new APIError(configError.message, 500);
    }

    if (existingConfig) {
        return existingConfig;
    }

    const { data: organization, error: organizationError } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', organizationId)
        .single();

    if (organizationError) {
        throw new APIError(organizationError.message, 500);
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('business_type')
        .eq('organization_id', organizationId)
        .limit(1)
        .maybeSingle();

    const fallbackConfig = {
        organization_id: organizationId,
        business_name: organization?.name || 'Your Business',
        currency: 'INR',
        tax_label: 'GST',
        invoice_prefix: 'INV-',
        business_type: profile?.business_type || 'solopreneur',
        default_due_days: 30,
    };

    const { data: insertedConfig, error: insertError } = await supabase
        .from('organization_configs')
        .upsert(fallbackConfig)
        .select()
        .single();

    if (insertError) {
        throw new APIError(insertError.message, 500);
    }

    return insertedConfig;
};

const markInvoiceAsShared = async (invoiceId, organizationId) => {
    const timestamp = new Date().toISOString();
    const { data: invoice, error } = await supabase
        .from('invoices')
        .select(`
            *,
            customers!invoices_customer_id_fkey (*),
            items: invoice_items (*)
        `)
        .eq('id', invoiceId)
        .eq('organization_id', organizationId)
        .single();

    if (error || !invoice) {
        throw new APIError('Invoice not found', 404);
    }

    const updates = { updatedAt: timestamp };
    if (normalizeStoredInvoiceStatus(invoice.status) === 'draft') {
        updates.status = 'sent';
    }
    const shouldUpdate = Object.keys(updates).some((key) => key !== 'updatedAt');
    if (!shouldUpdate) {
        return attachResolvedInvoiceStatus(invoice);
    }

    const { data: updatedInvoice, error: updateError } = await supabase
        .from('invoices')
        .update(updates)
        .eq('id', invoiceId)
        .eq('organization_id', organizationId)
        .select(`
            *,
            customers!invoices_customer_id_fkey (*),
            items: invoice_items (*)
        `)
        .single();

    if (updateError) {
        throw new APIError(updateError.message, 500);
    }

    return attachResolvedInvoiceStatus(updatedInvoice || { ...invoice, ...updates });
};

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
    res.json((invoices || []).map(attachResolvedInvoiceStatus));
};

export const getNextInvoiceNumber = async (req, res) => {
    const nextNumber = await findNextAvailableNumber(req.user.organizationId);
    res.json({ nextNumber });
};

const findNextInvoiceNumberPreview = async (organizationId) => {
    const config = await getOrCreateOrganizationConfig(organizationId);
    const invoicePrefix = config?.invoice_prefix || 'INV-';

    const { data: latest, error } = await supabase
        .from('invoices')
        .select('invoiceNumber')
        .eq('organization_id', organizationId)
        .like('invoiceNumber', `${escapeLikePattern(invoicePrefix)}%`)
        .order('invoiceNumber', { ascending: false })
        .limit(1);

    if (error || !latest?.length || !latest[0]?.invoiceNumber) {
        return `${invoicePrefix}0001`;
    }

    const prefixRegex = new RegExp(`^${invoicePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`);
    const match = latest[0].invoiceNumber.match(prefixRegex);

    if (!match) {
        return `${invoicePrefix}0001`;
    }

    const nextValue = parseInt(match[1], 10) + 1;
    return `${invoicePrefix}${nextValue.toString().padStart(4, '0')}`;
};

export const getInvoiceDraftDefaults = async (req, res) => {
    const config = await getOrCreateOrganizationConfig(req.user.organizationId);
    const settings = mapConfigToFrontend(config);
    const nextNumber = await findNextInvoiceNumberPreview(req.user.organizationId);

    res.json({
        nextNumber,
        defaults: {
            fromName: settings.owner_name || settings.businessName || '',
            fromAddress: settings.address || '',
            fromPan: settings.pan || settings.companyTaxId || '',
            fromGstin: settings.companyTaxId || settings.gstin || '',
            notes: settings.invoiceNotes || '',
            terms: settings.paymentInstructions || '',
            currencyCode: settings.currency || 'INR',
            taxLabel: settings.taxLabel || settings.tax_label || 'GST',
            defaultGstRate: Number(settings.defaultGstRate || 0),
            dueDays: Number(settings.defaultDueDays || 30),
            isGstRegistered: Boolean(settings.companyTaxId || settings.gstin),
            businessType: settings.businessType || 'solopreneur',
        }
    });
};

const findNextAvailableNumber = async (organizationId) => {
    const config = await getOrCreateOrganizationConfig(organizationId);
    const invoicePrefix = config?.invoice_prefix || 'INV-';

    try {
        // 1. Try atomic database sequence (Massive Concurrency Mode)
        if (invoicePrefix === 'INV-') {
            const { data: rpcNumber, error: rpcError } = await supabase.rpc('generate_next_invoice_number', {
                p_organization_id: organizationId
            });

            if (!rpcError && rpcNumber) {
                return rpcNumber;
            }
        }
    } catch (e) {
        // Fallback to legacy logic
    }

    return findNextInvoiceNumberPreview(organizationId);
};

export const createInvoice = async (req, res) => {
    await getOrCreateOrganizationConfig(req.user.organizationId);

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
        default_tax_rate: Number(req.body.taxRate || req.body.tax_rate) || 0,
        delivery_state: req.body.deliveryState || req.body.delivery_state || undefined,
        is_gst_registered: req.body.isGstRegistered !== false,
        lut_number: req.body.lutNumber || req.body.lut_number || undefined,
        reverse_charge: !!(req.body.reverseCharge || req.body.reverse_charge),
        tds_enabled: !!(req.body.tdsApplicable || req.body.tdsEnabled),
        tds_rate_override: req.body.tdsRate || req.body.tds_rate,
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

    // If user provided a custom invoice number, try it; otherwise auto-generate
    const userProvidedNumber = (invoiceNumber || '').trim();
    let invoice = null;
    let insertError = null;
    let finalInvoiceNumber = userProvidedNumber || await findNextAvailableNumber(req.user.organizationId);
    let isCustomNumber = Boolean(userProvidedNumber);
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
        if (attempts > 0) {
            if (isCustomNumber) {
                // Custom number collided — don't silently retry with a different number
                throw new APIError(`Invoice number "${userProvidedNumber}" already exists. Please choose a different number.`, 409);
            }
            // Auto-generated number collided — get a fresh one from DB
            finalInvoiceNumber = await findNextInvoiceNumberPreview(req.user.organizationId);
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
                status: normalizeStoredInvoiceStatus(status || 'draft'),
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

    res.status(201).json(attachResolvedInvoiceStatus(invoice));

    // Update Capita client intelligence
    if (customer_id) {
        void (async () => {
            const { error: intelligenceError } = await supabase.rpc('update_customer_intelligence', {
                p_customer_id: customer_id
            });
            if (intelligenceError) {
                console.error('Intelligence update failed:', intelligenceError);
            }
        })();
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
    res.json(attachResolvedInvoiceStatus(invoice));
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
            default_tax_rate: Number(updates.taxRate || updates.tax_rate || existing.taxRate || existing.tax_rate) || 0,
            delivery_state: updates.deliveryState || updates.delivery_state || existing.delivery_state || undefined,
            is_gst_registered: updates.isGstRegistered !== undefined ? updates.isGstRegistered !== false : existing.is_gst_registered !== false,
            lut_number: updates.lutNumber || updates.lut_number || existing.lut_number || undefined,
            reverse_charge: !!(updates.reverseCharge || updates.reverse_charge || existing.reverse_charge),
            tds_enabled: !!(updates.tdsApplicable || updates.tdsEnabled || existing.tds_applicable),
            tds_rate_override: updates.tdsRate || updates.tds_rate || existing.tds_rate,
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

    if (supabaseUpdates.status !== undefined) {
        supabaseUpdates.status = normalizeStoredInvoiceStatus(supabaseUpdates.status);
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
    res.json(attachResolvedInvoiceStatus(fullInvoice || updated));
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
    const { data: config } = await supabase
        .from('organization_configs')
        .select('*')
        .eq('organization_id', req.user.organizationId)
        .single();

    const settingsObj = mapConfigToFrontend(config || {});
    if (settingsObj.logoFilename) {
        settingsObj.logoPath = fileService.getFilePath(settingsObj.logoFilename);
    }
    if (config?.payment_qr_filename) {
        settingsObj.paymentQrPath = fileService.getFilePath(`payment-qr/${config.payment_qr_filename}`);
    }

    let tempPath = null;
    try {
        tempPath = pdfService.getTempPDFPath(invoice.invoiceNumber);
        await pdfService.generateInvoicePDF(invoice, settingsObj, tempPath);

        res.download(tempPath, `Invoice_${invoice.invoiceNumber}.pdf`, (err) => {
            if (err) console.error('PDF download error:', err);
            pdfService.cleanupPDF(tempPath);
        });
    } catch (err) {
        if (tempPath) pdfService.cleanupPDF(tempPath);
        throw err;
    }
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
        const result = await emailService.sendInvoice(invoice, pdfBuffer || tempPath, to, settingsObj);

        // Update status
        if (normalizeStoredInvoiceStatus(invoice.status) === 'draft') {
            await supabase.from('invoices').update({ status: 'sent', updatedAt: new Date() }).eq('id', invoiceId);
        }

        res.json(result);
    } finally {
        if (tempPath) pdfService.cleanupPDF(tempPath);
    }
};

export const shareInvoice = async (req, res) => {
    const baseInvoice = await markInvoiceAsShared(req.params.id, req.user.organizationId);
    const shareToken = baseInvoice.share_token || crypto.randomUUID();
    const now = new Date().toISOString();
    const invoice = await applyShareState(
        req.params.id,
        req.user.organizationId,
        {
            share_token: shareToken,
            shared_enabled: true,
            share_expires_at: getDefaultShareExpiry(),
            share_revoked_at: null,
            updatedAt: now
        },
        {
            share_token: shareToken,
            updatedAt: now
        }
    );

    res.json({
        success: true,
        invoice: attachResolvedInvoiceStatus(invoice),
        shareToken: invoice.share_token,
        shareExpiresAt: invoice.share_expires_at || null,
    });
};

export const revokeSharedInvoice = async (req, res) => {
    const { data: invoice, error } = await supabase
        .from('invoices')
        .select('id')
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .single();

    if (error || !invoice) {
        throw new APIError('Invoice not found', 404);
    }

    const now = new Date().toISOString();
    await applyShareState(
        req.params.id,
        req.user.organizationId,
        {
            shared_enabled: false,
            share_revoked_at: now,
            share_expires_at: now,
            share_token: crypto.randomUUID(),
            updatedAt: now
        },
        {
            share_token: crypto.randomUUID(),
            updatedAt: now
        }
    );

    res.json({ success: true });
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
        .select(`*, items:invoice_items(*)`)
        .eq('share_token', token)
        .single();

    if (error || !invoice || !isShareAccessible(invoice)) {
        return res.status(404).send('Invalid or expired share token');
    }

    // Record the first viewed timestamp (SaaS Tracking Standard)
    if (!invoice.share_viewed_at) {
        // Run async without blocking the PDF download response
        supabase.from('invoices')
            .update({ share_viewed_at: new Date().toISOString() })
            .eq('share_token', token)
            .then(() => console.log(`[Invoice] Tracked first open for ${invoice.invoiceNumber}`));
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
    if (settings.payment_qr_filename) {
        settings.paymentQrPath = fileService.getFilePath(`payment-qr/${settings.payment_qr_filename}`);
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

export const getInvoiceShareDetails = async (req, res) => {
    const { token } = req.params;

    const { data: invoice, error } = await supabase
        .from('invoices')
        .select(`*, items:invoice_items(*)`)
        .eq('share_token', token)
        .single();

    if (error || !invoice || !isShareAccessible(invoice)) {
        throw new APIError('Invalid or expired share token', 404);
    }

    if (!invoice.share_viewed_at) {
        supabase
            .from('invoices')
            .update({ share_viewed_at: new Date().toISOString() })
            .eq('share_token', token)
            .then(() => console.log(`[Invoice] Tracked first open for ${invoice.invoiceNumber}`))
            .catch((viewErr) => console.error('[Invoice] Share view tracking failed:', viewErr));
    }

    const { data: config } = await supabase
        .from('organization_configs')
        .select('*')
        .eq('organization_id', invoice.organization_id)
        .maybeSingle();

    const { data: organization } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', invoice.organization_id)
        .maybeSingle();

    const settings = mapConfigToFrontend(config || {});
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    res.json({
        invoice: attachResolvedInvoiceStatus(invoice),
        settings: {
            businessName: settings.businessName || organization?.name || 'Your Business',
            ownerName: settings.owner_name || '',
            businessType: settings.businessType || invoice.persona || 'solopreneur',
            companyTaxId: settings.companyTaxId || settings.gstin || '',
            email: settings.email || '',
            phone: settings.phone || '',
            address: settings.address || '',
            paymentInstructions: settings.paymentInstructions || '',
            invoiceNotes: settings.invoiceNotes || '',
            upiId: settings.upiId || '',
            bankName: settings.bankName || '',
            bankAccountNumber: settings.bankAccountNumber || '',
            bankIfsc: settings.bankIfsc || '',
            bankDetails: settings.bankDetails || '',
            logoUrl: settings.logoFilename ? `${baseUrl}/api/uploads/logos/${settings.logoFilename}` : null,
            paymentQrUrl: settings.paymentQrFilename ? `${baseUrl}/api/uploads/payment-qr/${settings.paymentQrFilename}` : null,
        },
        actions: {
            downloadUrl: `${baseUrl}/api/invoices/share/${token}`,
        }
    });
};
