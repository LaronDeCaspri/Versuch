// Zugriff auf die offene ADS-B-API (adsb.lol, readsb-kompatibles v2-Format)
// mit kurzem In-Memory-Cache, damit viele Clients nicht viele Upstream-Requests erzeugen.

export const UPSTREAM = process.env.ADSB_API || 'https://api.adsb.lol';
const UA = 'AeroTrack/0.1 (+https://github.com/larondecaspri/versuch)';
const MAX_RADIUS_NM = 250;

// Reduziert ein readsb-Aircraft-Objekt auf die Felder, die der Client braucht.
export function normalize(a) {
  if (a == null || a.lat == null || a.lon == null || !a.hex) return null;
  const ground = a.alt_baro === 'ground';
  const alt = ground ? 0 : (typeof a.alt_baro === 'number' ? a.alt_baro : (a.alt_geom ?? null));
  return {
    hex: String(a.hex).toLowerCase(),
    cs: (a.flight || '').trim() || null,
    reg: a.r || null,
    type: a.t || null,
    desc: a.desc || null,
    op: a.ownOp || null,
    year: a.year || null,
    lat: a.lat,
    lon: a.lon,
    alt,
    galt: a.alt_geom ?? null,
    gnd: ground,
    gs: a.gs ?? null,
    trk: a.track ?? a.true_heading ?? a.mag_heading ?? null,
    vr: a.baro_rate ?? a.geom_rate ?? null,
    sq: a.squawk || null,
    em: a.emergency && a.emergency !== 'none' ? a.emergency : null,
    cat: a.category || null,
    flags: a.dbFlags || 0,
    src: a.type || null,
    seen: a.seen_pos ?? a.seen ?? 0,
  };
}

const cache = new Map();

// Eine laufende Anfrage wird geteilt, bis sie fertig ist; die TTL zählt ab Antwort.
// So entstehen bei langsamer Datenquelle keine parallelen Doppelanfragen.
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && (hit.t === null || Date.now() - hit.t < ttlMs)) return hit.p;
  const p = fn();
  const entry = { t: null, p };
  cache.set(key, entry);
  p.then(
    () => (entry.t = Date.now()),
    () => cache.get(key) === entry && cache.delete(key),
  );
  if (cache.size > 2000) {
    for (const [k, v] of cache) if (v.t !== null && Date.now() - v.t > 600_000) cache.delete(k);
  }
  return p;
}

async function upstream(path, init = {}) {
  const res = await fetch(UPSTREAM + path, {
    ...init,
    headers: { 'user-agent': UA, accept: 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Upstream ${path} -> HTTP ${res.status}`);
  return res.json();
}

const toList = (data) => (data?.ac || data?.aircraft || []).map(normalize).filter(Boolean);

// Bereichsabfrage. Mittelpunkt wird auf 0,25° gerastert (mit Radius-Zuschlag),
// damit benachbarte Kartenausschnitte sich denselben Cache-Eintrag teilen.
export function area(lat, lon, radiusNm) {
  const qlat = Math.round(lat * 4) / 4;
  const qlon = Math.round(lon * 4) / 4;
  const r = Math.min(MAX_RADIUS_NM, Math.ceil((radiusNm + 15) / 25) * 25);
  return cached(`area:${qlat}:${qlon}:${r}`, 2500, async () => {
    const data = await upstream(`/v2/point/${qlat}/${qlon}/${r}`);
    return { now: data.now || Date.now(), ac: toList(data), center: [qlat, qlon], radius: r, capped: radiusNm + 15 > MAX_RADIUS_NM };
  });
}

export function military() {
  return cached('mil', 8000, async () => {
    const data = await upstream('/v2/mil');
    return { now: data.now || Date.now(), ac: toList(data) };
  });
}

// Suche über Hex, Rufzeichen, Kennzeichen und Typ parallel; Ergebnisse werden zusammengeführt.
export async function search(q) {
  const s = q.trim().toUpperCase().replace(/\s+/g, '');
  if (!s || s.length > 10 || !/^[A-Z0-9~-]+$/.test(s)) return { ac: [] };
  const paths = [`/v2/callsign/${s}`, `/v2/reg/${s}`];
  if (/^~?[0-9A-F]{6}$/.test(s)) paths.push(`/v2/hex/${s.toLowerCase()}`);
  if (/^[A-Z][A-Z0-9]{1,3}$/.test(s)) paths.push(`/v2/type/${s}`);
  const results = await Promise.allSettled(paths.map((p) => cached(`s:${p}`, 5000, () => upstream(p))));
  const seen = new Map();
  for (const r of results) if (r.status === 'fulfilled') for (const a of toList(r.value)) seen.set(a.hex, a);
  return { now: Date.now(), ac: [...seen.values()].slice(0, 500) };
}

// Routen (Start/Ziel) aus der Routendatenbank von adsb.lol. Das Format ist nicht
// formal dokumentiert, deshalb defensiv ausgelesen.
export async function routes(planes) {
  const list = planes
    .filter((p) => p && typeof p.cs === 'string' && p.cs.trim())
    .slice(0, 50)
    .map((p) => ({ callsign: p.cs.trim(), lat: Number(p.lat) || 0, lng: Number(p.lon) || 0 }));
  if (!list.length) return {};
  const key = 'routes:' + list.map((p) => p.callsign).sort().join(',');
  return cached(key, 600_000, async () => {
    const data = await upstream('/api/0/routeset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planes: list }),
    });
    const out = {};
    for (const r of Array.isArray(data) ? data : []) {
      const airports = (r._airports || []).map((a) => ({
        iata: a.iata || null,
        icao: a.icao || null,
        name: a.name || null,
        city: a.location || null,
        country: a.countryiso2 || null,
        lat: a.lat,
        lon: a.lon,
      }));
      if (r.callsign && airports.length >= 2) {
        out[r.callsign] = { airports, plausible: r.plausible !== false && r.plausible !== 0 };
      }
    }
    return out;
  });
}

// Foto über die öffentliche Planespotters-API (Namensnennung Pflicht).
export function photo(hex) {
  const h = String(hex).toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(h)) return Promise.resolve(null);
  return cached(`photo:${h}`, 86_400_000, async () => {
    const res = await fetch(`https://api.planespotters.net/pub/photos/hex/${h}`, {
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const p = (await res.json()).photos?.[0];
    if (!p) return null;
    return { src: p.thumbnail_large?.src || p.thumbnail?.src, link: p.link, by: p.photographer };
  });
}
