// Flugplatzsuche (ohne Node-Abhängigkeiten, auch im Browser nutzbar).
export function searchAirports(list, q) {
  const s = String(q || '').trim().toUpperCase();
  if (s.length < 2) return [];
  const scored = [];
  for (const a of list) {
    let score = 0;
    if (a.iata === s || a.icao === s) score = 100;
    else if (s.length >= 3) {
      const name = (a.name || '').toUpperCase();
      const city = (a.city || '').toUpperCase();
      if (city.startsWith(s) || name.startsWith(s)) score = 40;
      else if (city.includes(s) || name.includes(s)) score = 20;
    }
    if (score) scored.push([score + a.size * 5 + (a.sched ? 3 : 0), a]);
  }
  return scored.sort((x, y) => y[0] - x[0]).slice(0, 8).map((x) => x[1]);
}
