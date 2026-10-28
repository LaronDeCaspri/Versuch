// AeroTrack-Server: liefert die statische App aus und vermittelt die Datenquellen
// (vermeidet CORS-Probleme, bündelt Requests über einen Cache).

import http from 'node:http';
import { networkInterfaces } from 'node:os';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as adsb from './lib/adsb.js';
import { PushService } from './lib/push.js';
import { Simulator } from './lib/sim.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATIC = [
  ['/vendor/leaflet/', path.join(ROOT, 'node_modules/leaflet/dist/')],
  ['/', path.join(ROOT, 'public/')],
];
const PORT = Number(process.env.PORT) || 8080;
const DEMO = process.env.DEMO === '1';
const sim = DEMO ? new Simulator() : null;
const push = new PushService({
  dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'),
  subject: process.env.VAPID_SUBJECT || 'mailto:admin@localhost',
  source: DEMO
    ? { area: async (lat, lon, r) => sim.area(lat, lon, r), search: async (q) => sim.search(q) }
    : { area: adsb.area, search: adsb.search },
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req, limit = 32_768) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Body zu groß'), { status: 413 });
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  } catch {
    throw Object.assign(new Error('Ungültiges JSON'), { status: 400 });
  }
}

const num = (v, lo, hi) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw Object.assign(new Error('Ungültiger Parameter'), { status: 400 });
  return n;
};

async function api(req, res, url) {
  const p = url.pathname;
  const q = url.searchParams;
  if (p === '/api/meta') return send(res, 200, { demo: DEMO, source: DEMO ? 'Simulation' : 'adsb.lol' });
  if (p === '/api/area') {
    const lat = num(q.get('lat'), -90, 90);
    const lon = num(q.get('lon'), -180, 180);
    const r = num(q.get('r'), 1, 5000);
    return send(res, 200, DEMO ? sim.area(lat, lon, Math.min(r, 250)) : await adsb.area(lat, lon, r));
  }
  if (p === '/api/mil') return send(res, 200, DEMO ? sim.military() : await adsb.military());
  if (p === '/api/search') {
    const s = q.get('q') || '';
    return send(res, 200, DEMO ? sim.search(s) : await adsb.search(s));
  }
  if (p === '/api/routes' && req.method === 'POST') {
    const body = await readBody(req);
    const planes = Array.isArray(body.planes) ? body.planes : [];
    return send(res, 200, DEMO ? sim.routes(planes) : await adsb.routes(planes));
  }
  if (p === '/api/push/key') return send(res, 200, { publicKey: push.keys.publicKey });
  if (p.startsWith('/api/push/') && req.method === 'POST') {
    const body = await readBody(req);
    if (p === '/api/push/subscribe') return send(res, 200, { id: await push.subscribe(body.subscription, body.rules) });
    if (p === '/api/push/unsubscribe') return send(res, 200, { ok: await push.unsubscribe(body.endpoint) });
    if (p === '/api/push/test') {
      await push.test(body.endpoint);
      return send(res, 200, { ok: true });
    }
  }
  if (p.startsWith('/api/photo/')) {
    if (DEMO) return send(res, 200, null);
    return send(res, 200, await adsb.photo(decodeURIComponent(p.slice('/api/photo/'.length))));
  }
  return send(res, 404, { error: 'Unbekannter Endpunkt' });
}

async function serveStatic(res, pathname) {
  for (const [prefix, dir] of STATIC) {
    if (!pathname.startsWith(prefix)) continue;
    const rel = pathname.slice(prefix.length) || 'index.html';
    const file = path.normalize(path.join(dir, rel));
    if (!file.startsWith(dir)) return send(res, 403, 'Verboten', 'text/plain');
    try {
      const data = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': prefix === '/vendor/leaflet/' ? 'public, max-age=86400' : 'no-cache',
        ...(rel === 'sw.js' ? { 'service-worker-allowed': '/' } : {}),
        'x-content-type-options': 'nosniff',
      });
      return res.end(data);
    } catch {
      // nächstes Präfix probieren
    }
  }
  send(res, 404, 'Nicht gefunden', 'text/plain');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else await serveStatic(res, decodeURIComponent(url.pathname));
  } catch (err) {
    const status = err.status || 502;
    if (status >= 500) console.error(`[${req.method} ${url.pathname}]`, err.message);
    if (!res.headersSent) send(res, status, { error: err.message });
  }
});

await push.init();
server.listen(PORT, () => {
  console.log(`AeroTrack läuft auf http://localhost:${PORT}${DEMO ? '  (DEMO – simulierte Daten)' : ''}`);
  // Adressen im lokalen Netz, z. B. zum Öffnen auf dem Handy im selben WLAN
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) console.log(`Im WLAN erreichbar:   http://${n.address}:${PORT}`);
    }
  }
});
