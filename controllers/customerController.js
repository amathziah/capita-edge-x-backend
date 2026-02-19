import { supabase } from '../supabase.js';
import { APIError } from '../middleware/errorHandler.js';

export const getCustomers = async (req, res) => {
    const { data: customers, error } = await supabase
        .from('customers')
        .select('*')
        .eq('organization_id', req.user.organizationId) // Tenant isolation
        .order('name', { ascending: true });

    if (error) throw new Error(error.message);
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
        const { error } = await supabase
            .from('customers')
            .update({
                name,
                email,
                phone,
                address,
                taxId, // Corrected from tax_id
                updatedAt: new Date() // Corrected from updatedAt: new Date() (wait, schema is updatedAt)
            })
            .eq('id', id)
            .eq('organization_id', req.user.organizationId);

        if (error) {
            console.error('Error updating customer:', error);
            throw new Error(error.message);
        }
        res.json({ success: true, id });
    } else {
        // Create
        const { data, error } = await supabase
            .from('customers')
            .insert([{
                name,
                email,
                phone,
                address,
                taxId, // Corrected from tax_id
                organization_id: req.user.organizationId,
                user_id: req.user.id
            }])
            .select()
            .single();

        if (error) {
            console.error('Error creating customer:', error);
            throw new Error(error.message);
        }
        res.json({ success: true, id: data.id });
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
