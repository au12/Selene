// Bundles the simulator into a single self-contained dist/index.html (no external requests).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const js = ['shared/glyphs.js', 'shared/astro.js', 'shared/gmw15.js', 'shared/faces.js', 'shared/module.js', 'web/app.js'].map(rd).join('\n;\n');
const css = rd('web/app.css').replace(/\n\s*/g, '\n');
const icon = 'data:image/svg+xml,' + encodeURIComponent(rd('assets/icon.svg').replace(/\n\s*/g, ' '));
const pwa = process.argv.includes('--pwa');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
let html = rd('web/index.src.html')
  .replace('/*CSS*/', () => css)
  .replace('/*JS*/', () => js.replace(/<\/script/gi, '<\\/script'))
  .replaceAll('/*ICON*/', icon);
if (pwa) {
  html = html.replace('</head>', '<link rel="manifest" href="manifest.webmanifest">\n</head>')
    .replace('</body>', "<script>if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('sw.js').catch(()=>{});</script>\n</body>");
  for (const f of ['web/sw.js', 'web/manifest.webmanifest']) fs.copyFileSync(path.join(root, f), path.join(root, 'dist', path.basename(f)));
  for (const f of ['assets/icon-192.png', 'assets/icon-512.png']) if (fs.existsSync(path.join(root, f))) fs.copyFileSync(path.join(root, f), path.join(root, 'dist', path.basename(f)));
}
fs.writeFileSync(path.join(root, 'dist/index.html'), html);
// --csp=FILE: write an nginx Content-Security-Policy line that allows exactly this build's inline scripts (by hash)
const cspArg = process.argv.find((a) => a.startsWith('--csp='));
if (cspArg) {
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  const csp = ["default-src 'none'", `script-src 'self' ${hashes.join(' ')}`, "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
    "connect-src 'self'", "manifest-src 'self'", "worker-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'self'"].join('; ');
  fs.writeFileSync(cspArg.slice(6), `add_header Content-Security-Policy "${csp}" always;\n`);
  console.log('CSP', hashes.length, 'inline script(s) ->', cspArg.slice(6));
}
console.log('dist/index.html', (html.length / 1024).toFixed(1), 'KB');
