import { supabase } from '../supabase.js';

export const getReminders = async (req, res) => {
    try {
        const organizationId = req.user?.organizationId;
        if (!organizationId) {
            return res.status(400).json({ error: 'Organization ID is required' });
        }

        const { data, error } = await supabase
            .from('reminders')
            .select('*')
            .eq('organization_id', organizationId)
            .order('due_date', { ascending: true });

        if (error) throw error;

        // Ensure returning empty array if no data
        res.json(data || []);
    } catch (error) {
        console.error('Error fetching reminders:', error);
        res.status(500).json({ error: 'Failed to fetch reminders' });
    }
};

export const createReminder = async (req, res) => {
    try {
        const organizationId = req.user?.organizationId;
        if (!organizationId) {
            return res.status(400).json({ error: 'Organization ID is required' });
        }

        const { task, dueDate, priority, completed, snoozedUntil, id } = req.body;

        if (!task || !dueDate) {
            return res.status(400).json({ error: 'Task and due date are required' });
        }

        // If an ID is provided, treat this as an update
        if (id) {
            const { data, error } = await supabase
                .from('reminders')
                .update({
                    task,
                    due_date: dueDate,
                    priority: priority || 'Medium',
                    completed: !!completed,
                    snoozed_until: snoozedUntil || null,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id)
                .eq('organization_id', organizationId)
                .select()
                .single();

            if (error) throw error;
            return res.json(data);
        }

        // Otherwise create new reminder
        const { data, error } = await supabase
            .from('reminders')
            .insert([{
                task,
                due_date: dueDate,
                priority: priority || 'Medium',
                completed: !!completed,
                snoozed_until: snoozedUntil || null,
                organization_id: organizationId,
                user_id: req.user.id
            }])
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        console.error('Error creating/updating reminder:', error);
        res.status(500).json({ error: 'Failed to save reminder' });
    }
};

export const deleteReminder = async (req, res) => {
    try {
        const organizationId = req.user?.organizationId;
        if (!organizationId) {
            return res.status(400).json({ error: 'Organization ID is required' });
        }

        const { id } = req.params;

        const { error } = await supabase
            .from('reminders')
            .delete()
            .eq('id', id)
            .eq('organization_id', organizationId);

        if (error) throw error;
        res.json({ message: 'Reminder deleted successfully', id });
    } catch (error) {
        console.error('Error deleting reminder:', error);
        res.status(500).json({ error: 'Failed to delete reminder' });
    }
};
