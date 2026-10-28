// Ersatz für ../public/js/api.js in der eigenständigen Variante:
// Daten kommen aus der Verkehrssimulation im Browser, ohne Server.

import { Simulator } from '../lib/sim.js';
import { searchAirports } from '../public/js/airportsearch.js';

const sim = new Simulator();
const later = (v) => new Promise((r) => setTimeout(() => r(v), 60));

export const api = {
  meta: () => later({ demo: true, source: 'Simulation' }),
  area: (lat, lon, r) => later(sim.area(lat, lon, Math.min(r, 250))),
  mil: () => later(sim.military()),
  world: () => later(sim.world()),
  airports: () => later({ airports: sim.airports() }),
  search: (q) => later(sim.search(q)),
  routes: (planes) => later(sim.routes(planes)),
  photo: () => later(null),
  airportSearch: (q) => later({ airports: searchAirports(sim.airports(), q) }),
  metar: (icao) => later({ metar: sim.metar(icao) }),
};
