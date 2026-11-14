// Copies optional plugin libraries from node_modules into app/public-browser/vendor
// so a static deployment (e.g. GitHub Pages) serves them itself. Plugins fall back
// to a pinned CDN copy if these files are missing, so this step never fails the build.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "app");
const modules = join(root, "node_modules");
const out = join(root, "public-browser", "vendor");
const files = [
  ["molstar/build/viewer/molstar.js", "molstar/molstar.js"],
  ["molstar/build/viewer/molstar.css", "molstar/molstar.css"],
  ["molstar/LICENSE", "molstar/LICENSE"],
  ["smiles-drawer/dist/smiles-drawer.min.js", "smiles-drawer/smiles-drawer.min.js"],
  ["smiles-drawer/LICENSE", "smiles-drawer/LICENSE"],
];
let copied = 0;
for (const [from, to] of files) {
  const source = join(modules, from);
  if (!existsSync(source)) { console.warn(`[vendor-sync] missing ${from} (plugin will use its CDN fallback)`); continue; }
  const target = join(out, to);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  copied++;
}
console.log(`[vendor-sync] ${copied}/${files.length} files copied to public-browser/vendor`);
