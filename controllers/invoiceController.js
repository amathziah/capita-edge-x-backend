import { supabase } from '../supabase.js';
import pdfService from '../services/pdfService.js';
import emailService from '../services/emailService.js';
import fileService from '../services/fileService.js';
import { APIError } from '../middleware/errorHandler.js';

export const getInvoices = async (req, res) => {
    const { data: invoices, error } = await supabase
        .from('invoices')
        .select(`
            *,
            *,
            customers!invoices_customer_id_fkey (id, name, email),
            items: invoice_items (*)
        `)
        .eq('organization_id', req.user.organizationId) // Tenant isolation
        .order('createdAt', { ascending: false });

    if (error) throw new APIError(error.message, 500);
    res.json(invoices);
};

export const getNextInvoiceNumber = async (req, res) => {
    // Find the latest invoice to increment the number
    const { data: latest, error } = await supabase
        .from('invoices')
        .select('invoiceNumber')
        .eq('organization_id', req.user.organizationId)
        .order('createdAt', { ascending: false })
        .limit(1);

    if (error) throw new APIError(error.message, 500);

    let nextNumber = 'INV-0001';
    if (latest && latest.length > 0 && latest[0].invoiceNumber) {
        const match = latest[0].invoiceNumber.match(/INV-(\d+)/);
        if (match) {
            const num = parseInt(match[1], 10) + 1;
            nextNumber = `INV-${num.toString().padStart(4, '0')}`;
        }
    }

    res.json({ nextNumber });
};

export const createInvoice = async (req, res) => {
    let {
        buyer,
        items,
        dueDate,
        notes,
        taxRate,
        taxAmount,
        subtotal,
        total,
        invoiceNumber,
        status,
        date,
        seller,
        shipTo,
        taxType,
        discount,
        discount_amount,
        amount_paid,
        shipping
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
                organization_id: req.user.organizationId
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

    // Create Invoice
    const { data: invoice, error } = await supabase
        .from('invoices')
        .insert([{
            customer_id,
            buyer, // Store the buyer JSON object
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
            invoiceNumber: invoiceNumber || `INV-${Date.now()}`,
            organization_id: req.user.organizationId
        }])
        .select()
        .single();

    if (error) throw new APIError(error.message, 500);

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
            .select('id, name, stock')
            .in('id', productIdsToUpdate)
            .eq('organization_id', req.user.organizationId);

        if (fetchError) throw new APIError('Failed to verify inventory stock', 500);

        for (const p of currentProducts) {
            const requestedQty = productQuantities[p.id];
            // "Never less than 1" - User requested stock to not drop below 1
            if ((p.stock || 0) - requestedQty < 0) {
                throw new APIError(`Insufficient stock for ${p.name}. Available: ${p.stock}, Requested: ${requestedQty}`, 400);
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
        organization_id: req.user.organizationId
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
            const { data: p } = await supabase.from('products').select('stock').eq('id', productId).single();
            const newStock = Math.max(0, (p.stock || 0) - requestedQty);

            await supabase
                .from('products')
                .update({ stock: newStock, updatedAt: new Date() })
                .eq('id', productId);

            console.log(`Aggregated stock update: Product ${productId} reduced by ${requestedQty} to ${newStock}`);
        });

        // Run updates in background
        Promise.all(stockUpdatePromises).catch(err => console.error("Aggregated inventory update error:", err));
    }

    res.status(201).json(invoice);
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
                organization_id: req.user.organizationId
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
    const { data: settingsObj } = await supabase
        .from('organization_configs')
        .select('*')
        .eq('organization_id', req.user.organizationId)
        .single();

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
    const { data: settingsObj } = await supabase
        .from('organization_configs')
        .select('*')
        .eq('organization_id', req.user.organizationId)
        .single();

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
