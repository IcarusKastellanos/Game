import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Repo root .env (server/src/config → ../../../)
const envPath = resolve(__dirname, '../../../.env');
config({ path: envPath });
