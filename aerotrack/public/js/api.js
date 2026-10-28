// Dünner Client für die Server-Endpunkte.

async function getJSON(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const api = {
  meta: () => getJSON('/api/meta'),
  area: (lat, lon, r) => getJSON(`/api/area?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&r=${Math.round(r)}`),
  mil: () => getJSON('/api/mil'),
  search: (q) => getJSON(`/api/search?q=${encodeURIComponent(q)}`),
  routes: (planes) =>
    getJSON('/api/routes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planes }),
    }),
  photo: (hex) => getJSON(`/api/photo/${encodeURIComponent(hex)}`),
};
