import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));

export const __rootDirname = path.resolve(scriptsDirectory, '..');
export const __srcDirname = path.join(__rootDirname, 'src');
