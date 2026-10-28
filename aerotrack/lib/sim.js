// Simulierter Luftverkehr über Mitteleuropa für den Demo-Modus (DEMO=1).
// Liefert dasselbe Format wie normalize() in adsb.js. Alle Daten sind erfunden.

import { bearing, destination, distanceNm } from '../public/js/geo.js';

const AIRPORTS = [
  [50.033, 8.57, 'FRA', 'EDDF', 'Frankfurt'],
  [52.362, 13.501, 'BER', 'EDDB', 'Berlin'],
  [48.354, 11.786, 'MUC', 'EDDM', 'München'],
  [53.63, 9.988, 'HAM', 'EDDH', 'Hamburg'],
  [51.289, 6.767, 'DUS', 'EDDL', 'Düsseldorf'],
  [50.866, 7.143, 'CGN', 'EDDK', 'Köln/Bonn'],
  [52.308, 4.764, 'AMS', 'EHAM', 'Amsterdam'],
  [51.47, -0.454, 'LHR', 'EGLL', 'London Heathrow'],
  [49.009, 2.548, 'CDG', 'LFPG', 'Paris CDG'],
  [47.458, 8.555, 'ZRH', 'LSZH', 'Zürich'],
  [48.11, 16.57, 'VIE', 'LOWW', 'Wien'],
  [50.1, 14.26, 'PRG', 'LKPR', 'Prag'],
  [55.618, 12.656, 'CPH', 'EKCH', 'Kopenhagen'],
  [41.8, 12.25, 'FCO', 'LIRF', 'Rom'],
];

const PROFILES = {
  airliner: { n: 150, cat: 'A3', types: ['A320', 'A20N', 'A321', 'B738', 'B38M', 'A319', 'E190', 'CRJ9'], gs: [420, 480], alt: [31000, 39000] },
  heavy: { n: 25, cat: 'A5', types: ['A359', 'B77W', 'B789', 'A388', 'A333', 'B744'], gs: [470, 510], alt: [35000, 41000] },
  bizjet: { n: 30, cat: 'A2', types: ['GLF6', 'GL7T', 'FA7X', 'C68A', 'CL35', 'PC24', 'E55P'], gs: [430, 500], alt: [39000, 45000] },
  light: { n: 30, cat: 'A1', types: ['C172', 'P28A', 'DA40', 'SR22'], gs: [95, 140], alt: [2500, 6500] },
  heli: { n: 14, cat: 'A7', types: ['EC35', 'H145', 'EC45', 'R44'], gs: [90, 125], alt: [800, 2200] },
  mil: { n: 16, cat: 'A5', types: ['A400', 'C130', 'K35R', 'E3TF', 'EUFI', 'F35', 'A332'], gs: [300, 470], alt: [18000, 32000] },
};
const AIRLINES = ['DLH', 'EWG', 'RYR', 'EZY', 'KLM', 'AFR', 'SWR', 'AUA', 'CFG', 'BAW', 'SAS', 'WZZ'];
const MIL_CS = ['GAF', 'RCH', 'NATO', 'CNV', 'RRR', 'IAM', 'FAF'];

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Simulator {
  constructor(seed = 42) {
    const r = rng(seed);
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    const between = ([a, b]) => a + r() * (b - a);
    const letters = (n) => Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(r() * 26))).join('');
    this.t0 = Date.now();
    this.ac = [];
    let hexN = 0x3c4000;
    for (const [cls, p] of Object.entries(PROFILES)) {
      for (let i = 0; i < p.n; i++) {
        const a = pick(AIRPORTS);
        let b = pick(AIRPORTS);
        while (b === a) b = pick(AIRPORTS);
        const reg = cls === 'light' ? `D-E${letters(3)}` : cls === 'heli' ? `D-H${letters(3)}` : cls === 'bizjet' ? (r() < 0.5 ? `D-C${letters(3)}` : `N${100 + Math.floor(r() * 899)}${letters(2)}`) : `D-A${letters(3)}`;
        const cs =
          cls === 'mil' ? `${pick(MIL_CS)}${Math.floor(r() * 90 + 10)}` :
          cls === 'light' || cls === 'bizjet' ? reg.replace('-', '') :
          cls === 'heli' ? `CHX${Math.floor(r() * 90 + 10)}` :
          `${pick(AIRLINES)}${Math.floor(r() * 9000 + 100)}`;
        this.ac.push({
          cls,
          hex: (hexN++).toString(16),
          cs,
          reg,
          type: pick(p.types),
          cat: p.cat,
          flags: cls === 'mil' ? 1 : 0,
          gs: between(p.gs),
          cruise: Math.round(between(p.alt) / 100) * 100,
          from: a,
          to: b,
          phase: r(),
          orbit: cls === 'light' || cls === 'heli' || (cls === 'mil' && r() < 0.4),
          orbitR: 6 + r() * 20,
          sq: String(Math.floor(r() * 7000 + 1000)).replace(/[89]/g, '1'),
        });
      }
    }
    // Ein simulierter Luftnotfall, damit Alarme sichtbar getestet werden können.
    this.ac[3].sq = '7700';
    this.ac[3].em = 'general';
  }

  state(a, t) {
    const [lat0, lon0] = a.from;
    if (a.orbit) {
      const circ = 2 * Math.PI * a.orbitR;
      const ang = ((a.phase + (t * a.gs) / 3600 / circ) % 1) * 360;
      const [lat, lon] = destination(lat0, lon0, ang, a.orbitR);
      return { lat, lon, trk: (ang + 90) % 360, alt: a.cruise, vr: 0 };
    }
    const [lat1, lon1] = a.to;
    const dist = distanceNm(lat0, lon0, lat1, lon1);
    const f = (a.phase + (t * a.gs) / 3600 / dist) % 1;
    const brg = bearing(lat0, lon0, lat1, lon1);
    const [lat, lon] = destination(lat0, lon0, brg, f * dist);
    const climb = Math.min(1, f / 0.12, (1 - f) / 0.12);
    const alt = Math.round((1500 + (a.cruise - 1500) * climb) / 25) * 25;
    const vr = f < 0.12 ? 2200 : f > 0.88 ? -1800 : 0;
    return { lat, lon, trk: bearing(lat, lon, lat1, lon1), alt, vr };
  }

  snapshot() {
    const t = (Date.now() - this.t0) / 1000;
    return this.ac.map((a) => {
      const s = this.state(a, t);
      return {
        hex: a.hex, cs: a.cs, reg: a.reg, type: a.type, desc: null, op: null, year: null,
        lat: s.lat, lon: s.lon, alt: s.alt, galt: s.alt + 150, gnd: false,
        gs: Math.round(a.gs), trk: Math.round(s.trk * 10) / 10, vr: s.vr,
        sq: a.sq, em: a.em || null, cat: a.cat, flags: a.flags, src: 'adsb_icao', seen: 0,
      };
    });
  }

  area(lat, lon, r) {
    const ac = this.snapshot().filter((a) => distanceNm(lat, lon, a.lat, a.lon) <= r);
    return { now: Date.now(), ac, center: [lat, lon], radius: r, capped: r > 250 };
  }

  military() {
    return { now: Date.now(), ac: this.snapshot().filter((a) => a.flags & 1) };
  }

  search(q) {
    const s = q.trim().toUpperCase().replace(/[\s-]/g, '');
    const ac = this.snapshot().filter((a) =>
      [a.cs, a.reg?.replace('-', ''), a.hex.toUpperCase(), a.type].some((v) => v && v.toUpperCase() === s));
    return { now: Date.now(), ac };
  }

  routes(planes) {
    const out = {};
    const byCs = new Map(this.ac.map((a) => [a.cs, a]));
    for (const p of planes) {
      const a = byCs.get(p.cs);
      if (!a || a.orbit) continue;
      const ap = ([lat, lon, iata, icao, name]) => ({ iata, icao, name, city: name, country: null, lat, lon });
      out[a.cs] = { airports: [ap(a.from), ap(a.to)], plausible: true };
    }
    return out;
  }
}
