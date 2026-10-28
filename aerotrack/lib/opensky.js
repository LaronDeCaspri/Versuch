// Weltweite Übersicht über die OpenSky-Network-API (/states/all).
// adsb.lol bietet keine weltweite Abfrage; OpenSky liefert alle Positionen in einem Aufruf,
// ist aber kontingentiert. Deshalb ein gemeinsamer Schnappschuss für alle Clients.
//
// Ohne Konto: ca. 400 Credits/Tag, ein weltweiter Aufruf kostet 4 → Standard alle 15 min.
// Mit kostenlosem Konto (OPENSKY_CLIENT_ID/SECRET): ca. 4000 Credits/Tag → alle 90 s.

const API = 'https://opensky-network.org/api/states/all?extended=1';
const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const ID = process.env.OPENSKY_CLIENT_ID;
const SECRET = process.env.OPENSKY_CLIENT_SECRET;
export const INTERVAL_MS = (Number(process.env.OPENSKY_INTERVAL) || (ID ? 90 : 900)) * 1000;

// OpenSky-Emitterkategorie (Zahl) → ADS-B-Kategorie wie bei readsb
const CAT = { 2: 'A1', 3: 'A2', 4: 'A3', 5: 'A4', 6: 'A5', 7: 'A6', 8: 'A7', 9: 'B1', 10: 'B2', 11: 'B3', 12: 'B4', 14: 'B6', 15: 'B7', 16: 'C1', 17: 'C2', 18: 'C3' };
const M_TO_FT = 3.28084;
const MS_TO_KT = 1.943844;
const MS_TO_FPM = 196.8504;

export function normalizeState(s, nowSec) {
  const [icao24, callsign, , timePos, lastContact, lon, lat, baroAlt, onGround, velocity, track, vrate, , geoAlt, squawk, , source, category] = s;
  if (lat == null || lon == null || !icao24) return null;
  const round = (v, f) => (v == null ? null : Math.round(v * f));
  return {
    hex: String(icao24).toLowerCase(),
    cs: (callsign || '').trim() || null,
    reg: null,
    type: null,
    desc: null,
    op: null,
    year: null,
    lat,
    lon,
    alt: onGround ? 0 : round(baroAlt ?? geoAlt, M_TO_FT),
    galt: round(geoAlt, M_TO_FT),
    gnd: !!onGround,
    gs: round(velocity, MS_TO_KT),
    trk: track ?? null,
    vr: round(vrate, MS_TO_FPM),
    sq: squawk || null,
    em: null,
    cat: CAT[category] || null,
    flags: 0,
    src: source === 2 ? 'mlat' : 'adsb_icao',
    seen: Math.max(0, nowSec - (timePos ?? lastContact ?? nowSec)),
    world: true,
  };
}

let token = null;
async function auth() {
  if (!ID || !SECRET) return {};
  if (!token || Date.now() > token.exp) {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: ID, client_secret: SECRET }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`OpenSky-Anmeldung fehlgeschlagen (HTTP ${res.status})`);
    const j = await res.json();
    token = { value: j.access_token, exp: Date.now() + Math.max(60, (j.expires_in || 1800) - 60) * 1000 };
  }
  return { authorization: `Bearer ${token.value}` };
}

let snapshot = null; // { t, ac }
let pending = null;
let blockedUntil = 0;
let lastError = null;

async function refresh() {
  const res = await fetch(API, { headers: await auth(), signal: AbortSignal.timeout(45000) });
  if (res.status === 429) {
    const wait = Number(res.headers.get('x-rate-limit-retry-after-seconds')) || 3600;
    blockedUntil = Date.now() + wait * 1000;
    throw new Error(`OpenSky-Kontingent erschöpft, nächster Versuch in ${Math.round(wait / 60)} min`);
  }
  if (!res.ok) throw new Error(`OpenSky HTTP ${res.status}`);
  const data = await res.json();
  const nowSec = data.time || Math.floor(Date.now() / 1000);
  snapshot = { t: nowSec * 1000, ac: (data.states || []).map((s) => normalizeState(s, nowSec)).filter(Boolean) };
  lastError = null;
}

// Liefert den letzten Schnappschuss; stößt bei Bedarf eine Aktualisierung an,
// ohne auf sie zu warten (außer es gibt noch gar keine Daten).
export async function world() {
  const stale = !snapshot || Date.now() - snapshot.t > INTERVAL_MS;
  if (stale && !pending && Date.now() > blockedUntil) {
    pending = refresh()
      .catch((e) => {
        lastError = e.message;
        console.error('[opensky]', e.message);
      })
      .finally(() => (pending = null));
  }
  if (!snapshot && pending) await pending;
  return {
    now: Date.now(),
    asOf: snapshot?.t ?? null,
    interval: INTERVAL_MS,
    source: 'OpenSky Network',
    error: lastError,
    // Alter relativ zu jetzt, damit der Client keine veralteten Positionen vorhersagt
    ac: snapshot ? withAge(snapshot) : [],
  };
}

function withAge({ t, ac }) {
  const extra = Math.max(0, (Date.now() - t) / 1000);
  return ac.map((a) => ({ ...a, seen: a.seen + extra }));
}
