// Alarme: Watchlist (weltweit), Überwachungszone um einen Standort und Notfall-Squawks.
// Meldet jedes Ereignis höchstens einmal pro Abklingzeit und Luftfahrzeug.

import { distanceNm } from './geo.js';
import { CLASSES, SQUAWK_TEXT, isEmergencySquawk } from './classify.js';

const COOLDOWN_MS = 30 * 60_000;
export const WATCH_KINDS = {
  reg: 'Kennzeichen',
  cs: 'Rufzeichen',
  hex: 'ICAO-Hex',
  type: 'Typ',
};
const MAX_WATCH = 25;

const norm = (s) => String(s || '').toUpperCase().replace(/[\s-]/g, '');

export class Alerts {
  constructor(saved = {}, { notify }) {
    this.watch = saved.watch || [];
    this.zone = saved.zone || { enabled: false, lat: null, lon: null, km: 25, cls: 'all' };
    this.squawk = saved.squawk ?? true;
    this.log = [];
    this.notify = notify;
    this.fired = new Map();
  }

  toJSON() {
    return { watch: this.watch, zone: this.zone, squawk: this.squawk };
  }

  addWatch(kind, value, label = '') {
    const v = norm(value);
    if (!v || !WATCH_KINDS[kind]) return false;
    if (this.watch.some((w) => w.kind === kind && w.value === v)) return false;
    if (this.watch.length >= MAX_WATCH) return false;
    this.watch.push({ kind, value: v, label: label.trim().slice(0, 40) });
    return true;
  }

  removeWatch(i) {
    this.watch.splice(i, 1);
  }

  watchMatch(ac) {
    return this.watch.find((w) => {
      const v = w.kind === 'reg' ? norm(ac.reg) : w.kind === 'cs' ? norm(ac.cs) : w.kind === 'hex' ? norm(ac.hex) : norm(ac.type);
      return v && v === w.value;
    });
  }

  inZone(ac) {
    const z = this.zone;
    if (!z.enabled || z.lat == null) return false;
    if (z.cls !== 'all' && ac.cls !== z.cls) return false;
    return distanceNm(z.lat, z.lon, ac.lat, ac.lon) * 1.852 <= z.km;
  }

  fire(key, event) {
    const last = this.fired.get(key);
    if (last && Date.now() - last < COOLDOWN_MS) return;
    this.fired.set(key, Date.now());
    const entry = { ...event, t: Date.now() };
    this.log.unshift(entry);
    this.log.length = Math.min(this.log.length, 50);
    this.notify(entry);
  }

  check(acs) {
    for (const ac of acs) {
      const name = ac.cs || ac.reg || ac.hex.toUpperCase();
      const w = this.watchMatch(ac);
      if (w) {
        this.fire(`w:${ac.hex}`, {
          level: 'info',
          hex: ac.hex,
          title: `Watchlist: ${w.label || name}`,
          body: `${name} · ${ac.type || 'Typ unbekannt'} ist aktiv.`,
        });
      }
      if (this.inZone(ac)) {
        const km = distanceNm(this.zone.lat, this.zone.lon, ac.lat, ac.lon) * 1.852;
        this.fire(`z:${ac.hex}`, {
          level: ac.cls === 'mil' ? 'warn' : 'info',
          hex: ac.hex,
          title: `In deiner Zone: ${name}`,
          body: `${CLASSES[ac.cls].label} · ${ac.type || '?'} · ${km.toFixed(1)} km entfernt`,
        });
      }
      if (this.squawk && (isEmergencySquawk(ac.sq) || ac.em)) {
        this.fire(`e:${ac.hex}:${ac.sq}`, {
          level: 'danger',
          hex: ac.hex,
          title: `Notfall: ${name}`,
          body: SQUAWK_TEXT[ac.sq] || `Notfallstatus: ${ac.em}`,
        });
      }
    }
  }
}
