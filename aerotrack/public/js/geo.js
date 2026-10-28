// Geodätische Hilfsfunktionen und Formatierung. Ohne DOM-Abhängigkeiten,
// damit Server, Browser und Tests dasselbe Modul nutzen.

const R_NM = 3440.065;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

export function distanceNm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearing(lat1, lon1, lat2, lon2) {
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Punkt in `distNm` Entfernung entlang Kurs `brg` (Großkreis).
export function destination(lat, lon, brg, distNm) {
  const d = distNm / R_NM;
  const b = toRad(brg);
  const p1 = toRad(lat);
  const l1 = toRad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [toDeg(p2), ((toDeg(l2) + 540) % 360) - 180];
}

// Punkte entlang des Großkreises; Längengrade fortlaufend (ohne Sprung an ±180°),
// damit Linien über die Datumsgrenze nicht quer über die Karte gezogen werden.
export function greatCircle(lat1, lon1, lat2, lon2, n = 64) {
  const p1 = toRad(lat1), l1 = toRad(lon1), p2 = toRad(lat2), l2 = toRad(lon2);
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d === 0) return [[lat1, lon1], [lat2, lon2]];
  const pts = [];
  let prevLon = lon1;
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const a = Math.sin((1 - f) * d) / Math.sin(d);
    const b = Math.sin(f * d) / Math.sin(d);
    const x = a * Math.cos(p1) * Math.cos(l1) + b * Math.cos(p2) * Math.cos(l2);
    const y = a * Math.cos(p1) * Math.sin(l1) + b * Math.cos(p2) * Math.sin(l2);
    const z = a * Math.sin(p1) + b * Math.sin(p2);
    let lon = toDeg(Math.atan2(y, x));
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    prevLon = lon;
    pts.push([toDeg(Math.atan2(z, Math.hypot(x, y))), lon]);
  }
  return pts;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Farbskala Höhe (ft) -> RGB. Bodennahe warm, Reiseflughöhe kühl.
export const ALT_STOPS = [
  [0, [249, 115, 22]],
  [2000, [250, 204, 21]],
  [8000, [163, 230, 53]],
  [16000, [34, 211, 238]],
  [28000, [59, 130, 246]],
  [38000, [168, 85, 247]],
  [45000, [236, 72, 153]],
];

export function altColor(alt, ground = false) {
  if (ground || alt == null) return 'rgb(148,163,184)';
  if (alt <= ALT_STOPS[0][0]) return `rgb(${ALT_STOPS[0][1].join(',')})`;
  for (let i = 1; i < ALT_STOPS.length; i++) {
    const [a1, c1] = ALT_STOPS[i];
    if (alt <= a1) {
      const [a0, c0] = ALT_STOPS[i - 1];
      const k = (alt - a0) / (a1 - a0);
      return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * k)).join(',')})`;
    }
  }
  return `rgb(${ALT_STOPS.at(-1)[1].join(',')})`;
}

const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

export function fmtAlt(ft, units, ground = false) {
  if (ground) return 'Boden';
  if (ft == null) return '–';
  return units === 'metric' ? `${nf0.format(ft * 0.3048)} m` : `${nf0.format(ft)} ft`;
}

export function fmtSpeed(kt, units) {
  if (kt == null) return '–';
  return units === 'metric' ? `${nf0.format(kt * 1.852)} km/h` : `${nf0.format(kt)} kt`;
}

export function fmtVr(fpm, units) {
  if (fpm == null) return '–';
  const sign = fpm > 0 ? '+' : '';
  return units === 'metric' ? `${sign}${(fpm * 0.00508).toFixed(1)} m/s` : `${sign}${nf0.format(fpm)} fpm`;
}

export function fmtDist(nm, units) {
  if (nm == null) return '–';
  return units === 'metric' ? `${nf0.format(nm * 1.852)} km` : `${nf0.format(nm)} NM`;
}

export function fmtDuration(min) {
  if (min == null || !Number.isFinite(min)) return '–';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Polygon der Nachtseite der Erde (für die Tag/Nacht-Grenze).
export function nightPolygon(date = new Date()) {
  const d = date.getTime() / 86400000 - 10957.5; // Tage seit J2000
  const g = toRad((357.529 + 0.98560028 * d) % 360);
  const q = (280.459 + 0.98564736 * d) % 360;
  const L = toRad((q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) % 360);
  const e = toRad(23.439 - 0.00000036 * d);
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const gmst = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const subLon = ((((toDeg(ra) - gmst * 15) % 360) + 540) % 360) - 180;
  const pts = [];
  for (let lon = -180; lon <= 180; lon += 2) {
    const ha = toRad(lon - subLon);
    pts.push([toDeg(Math.atan(-Math.cos(ha) / Math.tan(dec))), lon]);
  }
  const darkPole = dec > 0 ? -90 : 90;
  return [[darkPole, -180], ...pts, [darkPole, 180]];
}
