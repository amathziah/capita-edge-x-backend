import { supabase } from '../supabase.js';
import { APIError } from '../middleware/errorHandler.js';

/**
 * Submit a new platform report (bug, feedback, etc.)
 */
export const createReport = async (req, res) => {
    const { type, title, description, priority, metadata } = req.body;
    const userId = req.user.id;
    const organizationId = req.headers['x-organization-id'];

    if (!type || !title) {
        throw new APIError('Type and title are required', 400);
    }

    if (!organizationId) {
        throw new APIError('Organization context is required', 400);
    }

    try {
        const { data: report, error } = await supabase
            .from('platform_reports')
            .insert([{
                organization_id: organizationId,
                user_id: userId,
                type,
                title,
                description,
                priority: priority || 'medium',
                status: 'open',
                metadata: metadata || {}
            }])
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            success: true,
            report
        });
    } catch (error) {
        console.error('[Create Report Error]:', error);
        throw new APIError(error.message || 'Failed to submit report', 500);
    }
};

/**
 * Get all reports for an organization
 */
export const getReports = async (req, res) => {
    const organizationId = req.headers['x-organization-id'];

    if (!organizationId) {
        throw new APIError('Organization context is required', 400);
    }

    try {
        const { data: reports, error } = await supabase
            .from('platform_reports')
            .select('*')
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.status(200).json(reports);
    } catch (error) {
        console.error('[Get Reports Error]:', error);
        throw new APIError(error.message || 'Failed to fetch reports', 500);
    }
};
