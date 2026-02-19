import { supabase } from '../supabase.js';
import { APIError } from '../middleware/errorHandler.js';

export const getTasks = async (req, res) => {
    const { data: tasks, error } = await supabase
        .from('compliance_tasks')
        .select('*')
        .eq('organization_id', req.user.organizationId)
        .order('due_date', { ascending: true });

    if (error) throw new Error(error.message);

    // Auto-update overdue status
    const today = new Date().toISOString().split('T')[0];
    const updatedTasks = tasks.map(task => {
        if (task.status === 'pending' && task.due_date < today) {
            return { ...task, status: 'overdue' };
        }
        return task;
    });

    res.json(updatedTasks);
};

export const createTask = async (req, res) => {
    const { id, type, description, dueDate, status, priority, notes } = req.body;

    if (!type || !dueDate) throw new APIError('Type and due date are required', 400);

    const taskData = {
        type,
        description: description || '',
        due_date: dueDate,
        status: status || 'pending',
        priority: priority || 'medium',
        notes: notes || '',
        updated_at: new Date(),
        organization_id: req.user.organizationId
    };

    if (id) {
        const { error } = await supabase
            .from('compliance_tasks')
            .update(taskData)
            .eq('id', id)
            .eq('organization_id', req.user.organizationId);
        if (error) throw new Error(error.message);
        res.json({ success: true, id });
    } else {
        const { data, error } = await supabase
            .from('compliance_tasks')
            .insert([taskData])
            .select()
            .single();
        if (error) throw new Error(error.message);
        res.json({ success: true, id: data.id });
    }
};

export const updateTask = async (req, res) => {
    const { type, description, dueDate, status, priority, notes } = req.body;
    const updateData = { updated_at: new Date() };

    if (type !== undefined) updateData.type = type;
    if (description !== undefined) updateData.description = description;
    if (dueDate !== undefined) updateData.due_date = dueDate;
    if (status !== undefined) updateData.status = status;
    if (priority !== undefined) updateData.priority = priority;
    if (notes !== undefined) updateData.notes = notes;

    const { error } = await supabase
        .from('compliance_tasks')
        .update(updateData)
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId);

    if (error) throw new Error(error.message);
    res.json({ success: true });
};

export const deleteTask = async (req, res) => {
    const { error } = await supabase
        .from('compliance_tasks')
        .delete()
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId); // Simplification: Removed debug logs and double check

    if (error) throw new Error(error.message);
    res.json({ success: true });
};
