// Bestimmt das überflogene Land per Punkt-in-Polygon-Test auf den Länderumrissen.
// Funktioniert nur, wenn Umrisse geladen sind (eigenständige Variante); sonst null.

let index = null;

function build(world) {
  return world.features.map((f) => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const poly of polys) for (const [x, y] of poly[0]) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { name: f.properties?.name || null, polys, box: [minX, minY, maxX, maxY] };
  });
}

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function countryAt(lat, lon, world = globalThis.AEROTRACK_STATIC?.world || globalThis.AEROTRACK_WORLD) {
  if (!world) return null;
  index ||= build(world);
  for (const c of index) {
    const [a, b, d, e] = c.box;
    if (lon < a || lon > d || lat < b || lat > e) continue;
    for (const poly of c.polys) {
      if (inRing(lon, lat, poly[0]) && !poly.slice(1).some((hole) => inRing(lon, lat, hole))) return c.name;
    }
  }
  return 'Über dem Meer';
}

// Beschriftungspunkt eines Landes: Mitte des größten Teilpolygons.
export function labelPoint(feature) {
  const polys = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  let best = null;
  let bestArea = -1;
  for (const poly of polys) {
    const xs = poly[0].map((p) => p[0]);
    const ys = poly[0].map((p) => p[1]);
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    if (area > bestArea) {
      bestArea = area;
      best = [(Math.max(...ys) + Math.min(...ys)) / 2, (Math.max(...xs) + Math.min(...xs)) / 2, area];
    }
  }
  return best;
}
