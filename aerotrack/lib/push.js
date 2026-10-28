// Web-Push: speichert Abonnements samt Alarmregeln und prüft sie serverseitig,
// damit Meldungen auch bei geschlossenem Tab ankommen.

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import webpush from 'web-push';
import { Alerts, WATCH_KINDS } from '../public/js/alerts.js';
import { CLASSES, classify } from '../public/js/classify.js';

const CHECK_INTERVAL_MS = 30_000;
const MAX_SUBSCRIPTIONS = 200;

export class PushService {
  constructor({ dataDir, source, subject }) {
    this.dataDir = dataDir;
    this.source = source; // { area(lat, lon, nm), search(q) }
    this.subject = subject;
    this.subs = new Map(); // id -> { subscription, rules, alerts }
    this.saveQueue = Promise.resolve();
  }

  async init() {
    await mkdir(this.dataDir, { recursive: true });
    this.keys = await this.loadKeys();
    webpush.setVapidDetails(this.subject, this.keys.publicKey, this.keys.privateKey);
    for (const s of await readJson(this.file('subscriptions.json'), [])) this.attach(s.subscription, s.rules);
    this.timer = setInterval(() => this.checkAll().catch((e) => console.error('[push]', e.message)), CHECK_INTERVAL_MS);
    this.timer.unref();
    console.log(`Push aktiv: ${this.subs.size} Abonnement(s), Prüfung alle ${CHECK_INTERVAL_MS / 1000} s`);
  }

  file(name) {
    return path.join(this.dataDir, name);
  }

  // VAPID-Schlüssel aus Umgebung oder Datei; beim ersten Start erzeugt.
  async loadKeys() {
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    }
    const existing = await readJson(this.file('vapid.json'), null);
    if (existing?.publicKey && existing?.privateKey) return existing;
    const keys = webpush.generateVAPIDKeys();
    await writeAtomic(this.file('vapid.json'), keys, 0o600);
    return keys;
  }

  attach(subscription, rules) {
    const id = subId(subscription.endpoint);
    const prev = this.subs.get(id);
    const clean = sanitizeRules(rules);
    const alerts = new Alerts(clean, { notify: (e) => this.send(id, e) });
    if (prev) alerts.fired = prev.alerts.fired; // Abklingzeiten bei Regeländerung behalten
    this.subs.set(id, { subscription, rules: clean, alerts });
    return id;
  }

  async subscribe(subscription, rules) {
    validateSubscription(subscription);
    const id = subId(subscription.endpoint);
    if (!this.subs.has(id) && this.subs.size >= MAX_SUBSCRIPTIONS) {
      throw Object.assign(new Error('Maximale Anzahl Abonnements erreicht'), { status: 429 });
    }
    this.attach(subscription, rules);
    await this.save();
    return id;
  }

  async unsubscribe(endpoint) {
    const deleted = this.subs.delete(subId(String(endpoint || '')));
    if (deleted) await this.save();
    return deleted;
  }

  async test(endpoint) {
    const id = subId(String(endpoint || ''));
    if (!this.subs.has(id)) throw Object.assign(new Error('Abonnement unbekannt'), { status: 404 });
    await this.send(id, { level: 'info', title: 'AeroTrack: Test', body: 'Push-Benachrichtigungen funktionieren.', hex: null }, true);
  }

  async send(id, event, throwOnError = false) {
    const sub = this.subs.get(id);
    if (!sub) return;
    const payload = JSON.stringify({ title: event.title, body: event.body, hex: event.hex, level: event.level, url: event.url || null });
    try {
      await webpush.sendNotification(sub.subscription, payload, { TTL: 600, urgency: event.level === 'danger' ? 'high' : 'normal' });
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        // Abonnement im Browser widerrufen oder abgelaufen
        this.subs.delete(id);
        await this.save();
      } else console.error('[push] Versand fehlgeschlagen:', err.statusCode || '', err.message);
      if (throwOnError) throw err;
    }
  }

  // Bündelt die Datenabfragen aller Abonnements, damit gleiche Suchbegriffe
  // und Zonen nur einmal abgefragt werden.
  async checkAll() {
    if (!this.subs.size) return;
    const searches = new Map();
    const areas = new Map();
    const query = (map, key, fn) => {
      if (!map.has(key)) map.set(key, fn().then((r) => r.ac.map(withClass)).catch(() => []));
      return map.get(key);
    };
    await Promise.all(
      [...this.subs.values()].map(async ({ rules, alerts }) => {
        const lists = [];
        for (const w of rules.watch) {
          if (w.kind !== 'type') lists.push(query(searches, w.value, () => this.source.search(w.value)));
        }
        const z = rules.zone;
        if (z.enabled && z.lat != null) {
          const nm = z.km / 1.852;
          lists.push(query(areas, `${z.lat.toFixed(2)}:${z.lon.toFixed(2)}:${Math.ceil(nm)}`, () => this.source.area(z.lat, z.lon, nm)));
        }
        const seen = new Map();
        for (const list of await Promise.all(lists)) for (const ac of list) seen.set(ac.hex, ac);
        // Nur Treffer aus Watchlist oder Zone; Notfall-Squawks gelten damit ebenfalls nur dort.
        alerts.check([...seen.values()].filter((ac) => alerts.watchMatch(ac) || alerts.inZone(ac)));
      }),
    );
  }

  save() {
    const data = [...this.subs.values()].map(({ subscription, rules }) => ({ subscription, rules }));
    this.saveQueue = this.saveQueue.then(() => writeAtomic(this.file('subscriptions.json'), data, 0o600)).catch((e) => console.error('[push] Speichern:', e.message));
    return this.saveQueue;
  }
}

const withClass = (ac) => ({ ...ac, cls: classify(ac) });

const subId = (endpoint) => createHash('sha256').update(endpoint).digest('hex').slice(0, 24);

function validateSubscription(s) {
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
  if (!s || typeof s.endpoint !== 'string' || s.endpoint.length > 1000) throw bad('Ungültiges Abonnement');
  let url;
  try {
    url = new URL(s.endpoint);
  } catch {
    throw bad('Ungültiger Endpunkt');
  }
  if (url.protocol !== 'https:') throw bad('Endpunkt muss HTTPS sein');
  if (typeof s.keys?.p256dh !== 'string' || typeof s.keys?.auth !== 'string') throw bad('Schlüssel fehlen');
}

// Regeln vom Client nur in bekannter Form übernehmen.
export function sanitizeRules(r = {}) {
  const watch = (Array.isArray(r.watch) ? r.watch : [])
    .filter((w) => w && WATCH_KINDS[w.kind] && typeof w.value === 'string' && /^[A-Z0-9~]{1,10}$/.test(w.value))
    .slice(0, 25)
    .map((w) => ({ kind: w.kind, value: w.value, label: String(w.label || '').slice(0, 40) }));
  const z = r.zone || {};
  const valid = Number.isFinite(z.lat) && Number.isFinite(z.lon) && Math.abs(z.lat) <= 90 && Math.abs(z.lon) <= 180;
  const zone = {
    enabled: !!z.enabled && valid,
    lat: valid ? z.lat : null,
    lon: valid ? z.lon : null,
    km: Math.min(200, Math.max(2, Number(z.km) || 25)),
    cls: z.cls === 'all' || CLASSES[z.cls] ? z.cls : 'all',
  };
  return { watch, zone, squawk: r.squawk !== false };
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeAtomic(file, data, mode) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data), { mode });
  await rename(tmp, file);
}
