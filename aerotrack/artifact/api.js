// Ersatz für ../public/js/api.js in der eigenständigen Variante:
// Daten kommen aus der Verkehrssimulation im Browser, ohne Server.

import { Simulator } from '../lib/sim.js';

const sim = new Simulator();
const later = (v) => new Promise((r) => setTimeout(() => r(v), 60));

export const api = {
  meta: () => later({ demo: true, source: 'Simulation' }),
  area: (lat, lon, r) => later(sim.area(lat, lon, Math.min(r, 250))),
  mil: () => later(sim.military()),
  search: (q) => later(sim.search(q)),
  routes: (planes) => later(sim.routes(planes)),
  photo: () => later(null),
};
