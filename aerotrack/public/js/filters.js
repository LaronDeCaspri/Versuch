// Filterzustand und Abgleich einzelner Luftfahrzeuge.

import { CLASSES, isEmergencySquawk } from './classify.js';

export const DEFAULT_FILTERS = {
  classes: Object.keys(CLASSES),
  altMin: 0,
  altMax: 50000,
  spdMin: 0,
  text: '',
  hideGround: false,
  onlyEmergency: false,
};

export class Filters {
  constructor(saved = {}) {
    Object.assign(this, structuredClone(DEFAULT_FILTERS), saved);
    this.compile();
  }

  compile() {
    this._classes = new Set(this.classes);
    this._terms = this.text
      .toUpperCase()
      .split(/[\s,]+/)
      .filter(Boolean);
  }

  set(patch) {
    Object.assign(this, patch);
    this.compile();
  }

  reset() {
    this.set(structuredClone(DEFAULT_FILTERS));
  }

  get active() {
    return (
      this._classes.size !== Object.keys(CLASSES).length ||
      this.altMin > 0 || this.altMax < 50000 || this.spdMin > 0 ||
      this._terms.length > 0 || this.hideGround || this.onlyEmergency
    );
  }

  toJSON() {
    const { classes, altMin, altMax, spdMin, text, hideGround, onlyEmergency } = this;
    return { classes, altMin, altMax, spdMin, text, hideGround, onlyEmergency };
  }

  match(ac) {
    if (!this._classes.has(ac.cls)) return false;
    if (this.onlyEmergency && !isEmergencySquawk(ac.sq) && !ac.em) return false;
    if (ac.gnd) {
      if (this.hideGround) return false;
    } else if (ac.alt != null && (ac.alt < this.altMin || (this.altMax < 50000 && ac.alt > this.altMax))) return false;
    if (this.spdMin > 0 && (ac.gs ?? 0) < this.spdMin) return false;
    if (this._terms.length) {
      const hay = `${ac.cs || ''} ${ac.reg || ''} ${ac.type || ''} ${ac.hex} ${ac.op || ''} ${ac.desc || ''}`.toUpperCase();
      if (!this._terms.some((t) => hay.includes(t))) return false;
    }
    return true;
  }
}
