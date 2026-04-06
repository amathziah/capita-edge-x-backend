import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const brandProfilePath = path.resolve(__dirname, './shared/brandProfile.json');

export const brandProfile = JSON.parse(fs.readFileSync(brandProfilePath, 'utf8'));
