// Baut AeroTrack als eine einzige HTML-Datei mit simulierten Daten und Vektorkarte,
// die ohne Server läuft (z. B. als geteilte Vorschau).
// Aufruf: node scripts/build-artifact.mjs [ausgabe.html]

import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(ROOT, 'dist/aerotrack.html'));

const swap = {
  name: 'swap-server-modules',
  setup(b) {
    b.onResolve({ filter: /^\.\/(api|push)\.js$/ }, (args) =>
      args.importer.includes(`${path.sep}public${path.sep}js${path.sep}`)
        ? { path: path.join(ROOT, 'artifact', path.basename(args.path)) }
        : undefined);
  },
};

const js = (await build({
  entryPoints: [path.join(ROOT, 'artifact/entry.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2022',
  write: false,
  plugins: [swap],
})).outputFiles[0].text;

const html = await readFile(path.join(ROOT, 'public/index.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
const leafletCss = await readFile(path.join(ROOT, 'node_modules/leaflet/dist/leaflet.css'), 'utf8');
const appCss = await readFile(path.join(ROOT, 'public/app.css'), 'utf8');
const extraCss = `
#map { background: #070b16; }
.topbar { top: calc(10px + env(safe-area-inset-top, 0px)); left: calc(10px + env(safe-area-inset-left, 0px)); right: calc(10px + env(safe-area-inset-right, 0px)); }
.statusbar { bottom: calc(10px + env(safe-area-inset-bottom, 0px)); left: calc(10px + env(safe-area-inset-left, 0px)); right: calc(10px + env(safe-area-inset-right, 0px)); }
:root { padding: 0 !important; }`;

const page = `<title>AeroTrack</title>
<meta name="description" content="Live-Flugtracker – Vorschau mit simulierten Daten">
<style>${leafletCss}\n${appCss}\n${extraCss}</style>
${body.trim()}
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>
`;
await writeFile(out, page);
console.log(`${out}  (${(page.length / 1024).toFixed(0)} KB)`);
