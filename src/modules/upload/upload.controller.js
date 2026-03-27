import { supabase } from '../../core/database/supabase.js';
import fileService from './file.service.js';
import { APIError } from '../../core/middleware/errorHandler.js';

export const uploadLogo = async (req, res) => {
    if (!req.file) throw new APIError('No file uploaded', 400);

    await fileService.optimizeImage(req.file.path, { maxWidth: 400, maxHeight: 400 });

    const key = `${req.user.organizationId}:logoFilename`; // Use scoped key for consistency
    // OR legacy 'logoFilename' if that's what frontend expects? 
    // Server.js used: .upsert({ key: 'logoFilename', value: req.file.filename });
    // This implies it was NOT scoped in the original code, or RLS handled it.
    // Wait, Lines 1605: .upsert({ key: 'logoFilename', value: req.file.filename });
    // And Lines 1510: settingsObj.logoPath = ...
    // And getSettings logic strips orgId prefix.
    // If I use 'logoFilename' literally, it might clash if unique constraint is on (key).
    // The table likely has (key, organization_id) unique constraint.
    // I will stick to the exact code from server.js to be safe.

    const { error } = await supabase
        .from('organization_configs')
        .upsert({
            organization_id: req.user.organizationId,
            logo_filename: req.file.filename,
            updated_at: new Date()
        });

    if (error) throw new Error(error.message);

    res.json({
        success: true,
        filename: req.file.filename,
        url: fileService.getFileUrl(req.file.filename)
    });
};

export const getLogo = (req, res) => {
    const filePath = fileService.getFilePath(req.params.filename);
    if (fileService.fileExists(req.params.filename)) {
        res.sendFile(filePath);
    } else {
        res.status(404).json({ error: 'File not found' });
    }
};

export const deleteLogo = async (req, res) => {
    const deleted = fileService.deleteFile(req.params.filename);
    if (deleted) {
        res.json({ success: true });
    } else {
        throw new APIError('File not found', 404);
    }
};
