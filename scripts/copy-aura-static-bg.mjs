import { copyFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(
  process.env.USERPROFILE ?? '',
  '.cursor/projects/c-Users-gjern-OneDrive-Desktop-Game/assets',
  'c__Users_gjern_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_ChatGPT_Image_Jul_13__2026__11_56_15_PM-8a5ae707-afbd-497a-95d9-ad436483e6c4.png'
);
const dst = join(root, 'client/public/assets/ui/aura-screen/aura-screen-static-background.png');

if (!existsSync(src)) {
  console.error('Source image missing:', src);
  process.exit(1);
}

mkdirSync(dirname(dst), { recursive: true });
copyFileSync(src, dst);
const b = readFileSync(dst);
const w = b.readUInt32BE(16);
const h = b.readUInt32BE(20);
console.log(JSON.stringify({ path: dst, bytes: b.length, width: w, height: h }));
