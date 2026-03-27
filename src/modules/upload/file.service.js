import multer from 'multer';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

/**
 * File Upload Service
 * Handles logo uploads, image optimization, and file management
 */

// Ensure upload directories exist
const uploadDir = path.join(process.cwd(), 'server', 'uploads', 'logos');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

/**
 * Multer storage configuration
 */
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = crypto.randomBytes(8).toString('hex');
        const ext = path.extname(file.originalname);
        cb(null, `logo_${uniqueSuffix}${ext}`);
    }
});

/**
 * File filter for images only
 */
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];

    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only JPEG and PNG images are allowed.'), false);
    }
};

/**
 * Multer upload middleware
 */
export const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 // 5MB default
    }
});

/**
 * File Service Class
 */
class FileService {
    /**
     * Optimize uploaded image
     */
    async optimizeImage(filePath, options = {}) {
        try {
            const { maxWidth = 800, maxHeight = 800, quality = 90 } = options;

            const optimizedPath = filePath.replace(/(\.\w+)$/, '_optimized$1');

            await sharp(filePath)
                .resize(maxWidth, maxHeight, {
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .jpeg({ quality })
                .png({ quality })
                .toFile(optimizedPath);

            // Replace original with optimized
            fs.unlinkSync(filePath);
            fs.renameSync(optimizedPath, filePath);

            return filePath;
        } catch (error) {
            console.error('Image optimization error:', error);
            throw error;
        }
    }

    /**
     * Get file URL
     */
    getFileUrl(filename) {
        return `/api/uploads/logos/${filename}`;
    }

    /**
     * Get file path
     */
    getFilePath(filename) {
        return path.join(uploadDir, filename);
    }

    /**
     * Delete file
     */
    deleteFile(filename) {
        try {
            const filePath = this.getFilePath(filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                return true;
            }
            return false;
        } catch (error) {
            console.error('File deletion error:', error);
            throw error;
        }
    }

    /**
     * List all uploaded files
     */
    listFiles() {
        try {
            const files = fs.readdirSync(uploadDir);
            return files.map(filename => ({
                filename,
                url: this.getFileUrl(filename),
                path: this.getFilePath(filename),
                size: fs.statSync(this.getFilePath(filename)).size,
                uploadedAt: fs.statSync(this.getFilePath(filename)).mtime
            }));
        } catch (error) {
            console.error('List files error:', error);
            return [];
        }
    }

    /**
     * Validate file exists
     */
    fileExists(filename) {
        return fs.existsSync(this.getFilePath(filename));
    }
}

export default new FileService();
