import analyticsService from '../services/analyticsService.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const getDashboardStats = async (req, res) => {
    const stats = await analyticsService.getDashboardStats(req.user.organizationId);
    res.json(stats);
};

export const getRevenueTrends = async (req, res) => {
    const period = req.query.period || 'monthly';
    const trends = await analyticsService.getRevenueTrends(req.user.organizationId, period);
    res.json(trends);
};

export const getCustomerInsights = async (req, res) => {
    const insights = await analyticsService.getCustomerInsights(req.user.organizationId);
    res.json(insights);
};

export const getProductPerformance = async (req, res) => {
    const performance = await analyticsService.getProductPerformance(req.user.organizationId);
    res.json(performance);
};

export const getCashFlow = async (req, res) => {
    const cashFlow = await analyticsService.getCashFlowAnalysis(req.user.organizationId);
    res.json(cashFlow);
};

export const getHealthScore = async (req, res) => {
    const healthScore = await analyticsService.getBusinessHealthScore(req.user.organizationId);
    res.json(healthScore);
};

export const exportData = async (req, res) => {
    const type = req.query.type || 'invoices';
    const csv = await analyticsService.exportToCSV(type, {}, req.user.organizationId);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${type}-export.csv`);
    res.send(csv);
};
export const getPersonaStats = async (req, res) => {
    const persona = req.query.persona;
    if (!persona) throw new Error('Persona is required');
    const stats = await analyticsService.getPersonaStats(req.user.organizationId, persona);
    res.json(stats);
};
