import { supabase } from '../supabase.js';
import { APIError } from '../middleware/errorHandler.js';

export const getExpenses = async (req, res) => {
    const { data: expenses, error } = await supabase
        .from('expenses')
        .select('*')
        .eq('organization_id', req.user.organizationId)
        .order('date', { ascending: false });

    if (error) throw new Error(error.message);
    res.json(expenses);
};

export const createExpense = async (req, res) => {
    const { id, description, amount, date, category } = req.body;

    if (id) {
        const { error } = await supabase
            .from('expenses')
            .update({ description, amount, date, category })
            .eq('id', id)
            .eq('organization_id', req.user.organizationId);
        if (error) throw new Error(error.message);
        res.json({ success: true, id });
    } else {
        const { data, error } = await supabase
            .from('expenses')
            .insert([{
                description, amount, date: date || new Date().toISOString(), category,
                organization_id: req.user.organizationId,
                user_id: req.user.id
            }])
            .select()
            .single();
        if (error) throw new Error(error.message);
        res.json({ success: true, id: data.id });
    }
};

export const deleteExpense = async (req, res) => {
    const { error } = await supabase
        .from('expenses')
        .delete()
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId);

    if (error) throw new Error(error.message);
    res.json({ success: true });
};
