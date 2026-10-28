// Zustand aller bekannten Luftfahrzeuge: Zusammenführen der Abfragen,
// Positionsvorhersage zwischen zwei Abfragen und Flugspur-Historie.

import { destination, distanceNm } from './geo.js';
import { classify } from './classify.js';

const TRAIL_MAX = 900;
const SMOOTH_MS = 1500;
const MAX_EXTRAPOLATE_S = 25;

export class Store {
  constructor() {
    this.ac = new Map();
    this.lastIngest = 0;
  }

  ingest(list) {
    const now = Date.now();
    const fresh = [];
    for (const a of list) {
      const fixT = now - (a.seen || 0) * 1000;
      let ac = this.ac.get(a.hex);
      if (!ac) {
        ac = { ...a, fixT, updated: now, firstSeen: now, trail: [], smooth: null };
        ac.cls = classify(ac);
        this.ac.set(a.hex, ac);
        fresh.push(ac);
      } else {
        // Nur neuere Positionen übernehmen (Bereichs- und Militärabfrage überlappen sich).
        if (fixT < ac.fixT - 500) continue;
        const before = this.position(ac, now);
        Object.assign(ac, a);
        ac.fixT = fixT;
        ac.updated = now;
        ac.cls = classify(ac);
        const after = this.position(ac, now, true);
        const jump = distanceNm(before.lat, before.lon, after.lat, after.lon);
        ac.smooth = jump < 3 ? { dLat: before.lat - after.lat, dLon: before.lon - after.lon, t: now } : null;
      }
      this.pushTrail(ac);
    }
    this.lastIngest = now;
    return fresh;
  }

  pushTrail(ac) {
    const last = ac.trail.at(-1);
    if (last && distanceNm(last[0], last[1], ac.lat, ac.lon) < 0.08 && Math.abs((last[2] ?? 0) - (ac.alt ?? 0)) < 100) return;
    ac.trail.push([ac.lat, ac.lon, ac.gnd ? 0 : ac.alt, ac.fixT, ac.gs]);
    if (ac.trail.length > TRAIL_MAX) ac.trail.splice(0, ac.trail.length - TRAIL_MAX);
  }

  // Vorhergesagte Position anhand Geschwindigkeit und Kurs (Dead Reckoning),
  // plus abklingender Korrektur, damit Sprünge bei neuen Daten weich bleiben.
  position(ac, t = Date.now(), raw = false) {
    let lat = ac.lat;
    let lon = ac.lon;
    if (!ac.gnd && ac.gs > 30 && ac.trk != null) {
      const dt = Math.min((t - ac.fixT) / 1000, MAX_EXTRAPOLATE_S);
      if (dt > 0) [lat, lon] = destination(lat, lon, ac.trk, (ac.gs * dt) / 3600);
    }
    if (!raw && ac.smooth) {
      const k = 1 - (t - ac.smooth.t) / SMOOTH_MS;
      if (k > 0) {
        lat += ac.smooth.dLat * k;
        lon += ac.smooth.dLon * k;
      } else ac.smooth = null;
    }
    return { lat, lon };
  }

  prune(keep = new Set(), maxAgeMs = 60_000) {
    const now = Date.now();
    for (const [hex, ac] of this.ac) {
      const limit = keep.has(hex) ? 600_000 : maxAgeMs;
      if (now - ac.updated > limit) this.ac.delete(hex);
    }
  }

  get(hex) {
    return this.ac.get(hex);
  }

  values() {
    return this.ac.values();
  }
}
