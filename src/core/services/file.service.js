import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fallback upload directory assuming it was in the project root
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../../uploads');

class FileService {
    /**
     * Resolves a filename to its absolute path on the disk
     */
    getFilePath(filename) {
        if (!filename) return null;
        
        // If it's already a full URL, return as is
        if (filename.startsWith('http://') || filename.startsWith('https://')) {
            return filename;
        }
        
        return path.join(UPLOAD_DIR, filename);
    }
}

export default new FileService();
