// Aktuelles Flughafenwetter (METAR) vom Aviation Weather Center der NOAA, 10 min zwischengespeichert.

const cache = new Map();
const TTL_MS = 10 * 60_000;

export function normalizeMetar(m) {
  if (!m) return null;
  const visib = typeof m.visib === 'string' ? parseFloat(m.visib) : m.visib;
  return {
    icao: m.icaoId || null,
    time: m.obsTime ? m.obsTime * 1000 : m.reportTime ? Date.parse(m.reportTime) : null,
    temp: m.temp ?? null,
    dewp: m.dewp ?? null,
    wdir: m.wdir ?? null, // Grad oder "VRB"
    wspd: m.wspd ?? null, // Knoten
    wgst: m.wgst ?? null,
    visSm: Number.isFinite(visib) ? visib : null, // Statute Miles; "10+" → 10
    visPlus: typeof m.visib === 'string' && m.visib.includes('+'),
    wx: m.wxString || null,
    clouds: Array.isArray(m.clouds) ? m.clouds.map((c) => ({ cover: c.cover, base: c.base ?? null })) : [],
    cat: m.fltCat || null,
    raw: m.rawOb || null,
  };
}

export async function metar(icao) {
  const id = String(icao).toUpperCase();
  if (!/^[A-Z0-9]{3,4}$/.test(id)) return null;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.v;
  const res = await fetch(`https://aviationweather.gov/api/data/metar?ids=${id}&format=json`, {
    headers: { 'user-agent': 'AeroTrack/0.1' },
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`METAR HTTP ${res.status}`);
  const list = await res.json().catch(() => []);
  const v = normalizeMetar(Array.isArray(list) ? list[0] : null);
  cache.set(id, { t: Date.now(), v });
  return v;
}
