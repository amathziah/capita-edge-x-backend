import { supabase } from '../../core/database/supabase.js';
import { APIError } from '../../core/middleware/errorHandler.js';
import { parsePagination } from '../../core/utils/pagination.js';
import { CUSTOMER_HEALTH } from '../../core/config/constants.js';
import analyticsService from '../analytics/analytics.service.js';

export const getCustomers = async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);

    const { data: customers, error, count } = await supabase
        .from('customers')
        .select('*', { count: 'exact' })
        .eq('organization_id', req.user.organizationId) // Tenant isolation
        .order('name', { ascending: true })
        .range(offset, offset + limit - 1);

    if (error) throw new Error(error.message);
    
    res.setHeader('X-Total-Count', count || 0);
    res.json(customers);
};

export const createCustomer = async (req, res) => {
    const { id, name, email, phone, address, taxId, currency } = req.body;

    // Check for existing email if provided
    if (email) {
        const { data: existing } = await supabase
            .from('customers')
            .select('id')
            .eq('email', email)
            .eq('organization_id', req.user.organizationId)
            .single();

        if (existing && existing.id !== id) {
            throw new APIError('Customer with this email already exists', 400);
        }
    }

    if (id) {
        // Update
        const { data, error } = await supabase
            .from('customers')
            .update({
                name,
                email,
                phone,
                address,
                taxId,
                updatedAt: new Date()
            })
            .eq('id', id)
            .eq('organization_id', req.user.organizationId)
            .select()
            .single();

        if (error) {
            console.error('Error updating customer:', error);
            throw new Error(error.message);
        }
        res.json(data);
    } else {
        // Create
        const { data, error } = await supabase
            .from('customers')
            .insert([{
                name,
                email,
                phone,
                address,
                taxId,
                organization_id: req.user.organizationId,
                user_id: req.user.id
            }])
            .select()
            .single();

        if (error) {
            console.error('Error creating customer:', error);
            throw new Error(error.message);
        }
        res.json(data);
    }
};


export const getCustomerById = async (req, res) => {
    const { data: customer, error } = await supabase
        .from('customers')
        .select('*')
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .single();

    if (error || !customer) throw new APIError('Customer not found', 404);
    res.json(customer);
};

export const deleteCustomer = async (req, res) => {
    const { error } = await supabase
        .from('customers')
        .delete()
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId);

    if (error) throw new APIError(error.message, 500);
    res.json({ success: true });
};

export const getCustomerInvoices = async (req, res) => {
    const { data: invoices, error } = await supabase
        .from('invoices')
        .select(`
            *,
            items: invoice_items (*)
        `)
        .eq('customer_id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .order('createdAt', { ascending: false });

    if (error) throw new APIError(error.message, 500);
    res.json(invoices);
};

export const getCustomerInsights = async (req, res) => {
    try {
        const insights = await analyticsService.getCustomerIntelligence(req.params.id, req.user.organizationId);
        res.json(insights);
    } catch (error) {
        throw new APIError(error.message, 500);
    }
};
