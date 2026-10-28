// Flugplätze aus OurAirports (gemeinfrei). Wird beim ersten Start heruntergeladen,
// in DATA_DIR/airports.json zwischengespeichert und wöchentlich erneuert.

import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SOURCE_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const MAX_AGE_MS = 7 * 86_400_000;
const TYPES = { large_airport: 3, medium_airport: 2, small_airport: 1, heliport: 0 };

// Minimaler CSV-Parser mit Anführungszeichen und eingebetteten Kommas/Zeilenumbrüchen.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function toAirports(csv) {
  const [head, ...rows] = parseCsv(csv);
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  const out = [];
  for (const r of rows) {
    const size = TYPES[r[col.type]];
    if (size === undefined) continue;
    const lat = Number(r[col.latitude_deg]);
    const lon = Number(r[col.longitude_deg]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      name: r[col.name],
      icao: r[col.gps_code] || r[col.ident] || null,
      iata: r[col.iata_code] || null,
      city: r[col.municipality] || null,
      country: r[col.iso_country] || null,
      elev: r[col.elevation_ft] ? Number(r[col.elevation_ft]) : null,
      lat,
      lon,
      size,
      sched: r[col.scheduled_service] === 'yes',
    });
  }
  // Große zuerst, damit bei Begrenzung die wichtigen erhalten bleiben
  return out.sort((a, b) => b.size - a.size || Number(b.sched) - Number(a.sched));
}

export class AirportDb {
  constructor(dataDir, fallback = []) {
    this.file = path.join(dataDir, 'airports.json');
    this.list = fallback;
    this.error = null;
  }

  async init() {
    try {
      const age = Date.now() - (await stat(this.file)).mtimeMs;
      this.list = JSON.parse(await readFile(this.file, 'utf8'));
      if (age > MAX_AGE_MS) this.download();
    } catch {
      await this.download();
    }
  }

  async download() {
    try {
      const res = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = toAirports(await res.text());
      if (list.length < 1000) throw new Error('unerwartet wenige Einträge');
      this.list = list;
      await writeFile(this.file, JSON.stringify(list));
      console.log(`Flugplätze geladen: ${list.length}`);
    } catch (e) {
      this.error = e.message;
      console.error('[airports] Download fehlgeschlagen:', e.message);
    }
  }

  // Ausschnitt nach Kartengrenzen; je weiter herausgezoomt, desto nur größere Plätze.
  query(s, w, n, e, zoom) {
    const minSize = zoom < 6 ? 3 : zoom < 8 ? 2 : zoom < 10 ? 1 : 0;
    const wrap = w > e; // Ausschnitt über die Datumsgrenze
    const out = [];
    for (const a of this.list) {
      if (a.size < minSize) continue;
      if (a.lat < s || a.lat > n) continue;
      if (wrap ? a.lon < w && a.lon > e : a.lon < w || a.lon > e) continue;
      out.push(a);
      if (out.length >= 3000) break;
    }
    return out;
  }
}
