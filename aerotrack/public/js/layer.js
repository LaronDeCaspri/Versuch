// Canvas-Ebene über der Leaflet-Karte. Zeichnet alle Luftfahrzeuge pro Frame neu,
// was flüssige Bewegung zwischen den Datenabfragen erlaubt und bei Tausenden
// Objekten deutlich schneller ist als einzelne DOM-Marker.

import { CLASSES, isEmergencySquawk } from './classify.js';
import { altColor } from './geo.js';

// Eigene Silhouetten, Nase zeigt nach oben, Koordinaten in [-1, 1].
const SHAPES = {
  jet: new Path2D('M0,-1 C0.08,-1 0.1,-0.86 0.1,-0.7 L0.1,-0.22 L0.96,0.24 L0.96,0.38 L0.1,0.14 L0.08,0.64 L0.36,0.84 L0.36,0.95 L0,0.88 L-0.36,0.95 L-0.36,0.84 L-0.08,0.64 L-0.1,0.14 L-0.96,0.38 L-0.96,0.24 L-0.1,-0.22 L-0.1,-0.7 C-0.1,-0.86 -0.08,-1 0,-1 Z'),
  bizjet: new Path2D('M0,-1 C0.07,-1 0.08,-0.86 0.08,-0.7 L0.08,-0.05 L0.74,0.3 L0.74,0.4 L0.08,0.25 L0.07,0.56 L0.2,0.52 L0.22,0.68 L0.07,0.72 L0.3,0.92 L0.3,1 L0,0.95 L-0.3,1 L-0.3,0.92 L-0.07,0.72 L-0.22,0.68 L-0.2,0.52 L-0.07,0.56 L-0.08,0.25 L-0.74,0.4 L-0.74,0.3 L-0.08,-0.05 L-0.08,-0.7 C-0.08,-0.86 -0.07,-1 0,-1 Z'),
  prop: new Path2D('M0,-0.95 L0.08,-0.85 L0.08,-0.36 L0.96,-0.3 L0.96,-0.12 L0.08,-0.1 L0.06,0.6 L0.36,0.7 L0.36,0.82 L0,0.8 L-0.36,0.82 L-0.36,0.7 L-0.06,0.6 L-0.08,-0.1 L-0.96,-0.12 L-0.96,-0.3 L-0.08,-0.36 L-0.08,-0.85 Z'),
  delta: new Path2D('M0,-1 L0.12,-0.55 L0.15,-0.1 L0.86,0.55 L0.86,0.7 L0.15,0.6 L0.12,0.84 L0.32,0.98 L-0.32,0.98 L-0.12,0.84 L-0.15,0.6 L-0.86,0.7 L-0.86,0.55 L-0.15,-0.1 L-0.12,-0.55 Z'),
  heli: new Path2D('M0,-0.55 C0.22,-0.55 0.25,-0.2 0.22,0.05 C0.18,0.25 0.08,0.3 0.04,0.3 L0.03,0.9 L0.2,0.95 L0.2,1 L-0.2,1 L-0.2,0.95 L-0.03,0.9 L-0.04,0.3 C-0.08,0.3 -0.18,0.25 -0.22,0.05 C-0.25,-0.2 -0.22,-0.55 0,-0.55 Z'),
  glider: new Path2D('M0,-0.7 L0.05,-0.6 L0.05,-0.3 L1,-0.25 L1,-0.17 L0.05,-0.15 L0.03,0.75 L0.25,0.8 L0.25,0.88 L-0.25,0.88 L-0.25,0.8 L-0.03,0.75 L-0.05,-0.15 L-1,-0.17 L-1,-0.25 L-0.05,-0.3 L-0.05,-0.6 Z'),
  ground: new Path2D('M-0.32,-0.55 L0.32,-0.55 L0.32,0.55 L-0.32,0.55 Z'),
};
const ROTOR = new Path2D('M0.8,0 A0.8,0.8 0 1 1 -0.8,0 A0.8,0.8 0 1 1 0.8,0');
const BASE_PX = 11;
const FRAME_MS = 33;

export class AircraftLayer {
  constructor(map, store, ctx) {
    this.map = map;
    this.store = store;
    this.ctx = ctx; // { filters, settings, selected(), follow }
    this.drawn = [];
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ac-canvas';
    map.getContainer().appendChild(this.canvas);
    this.g = this.canvas.getContext('2d');
    this.lastFrame = 0;
    this.resize();
    map.on('resize', () => this.resize());
    map.on('zoomstart', () => this.canvas.classList.add('zooming'));
    map.on('zoomend', () => this.canvas.classList.remove('zooming'));
    const loop = (t) => {
      if (t - this.lastFrame >= FRAME_MS && !document.hidden) {
        this.lastFrame = t;
        this.draw();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  resize() {
    const { x, y } = this.map.getSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = x * dpr;
    this.canvas.height = y * dpr;
    this.canvas.style.width = `${x}px`;
    this.canvas.style.height = `${y}px`;
    this.dpr = dpr;
    this.w = x;
    this.h = y;
  }

  colorOf(ac) {
    return this.ctx.settings.colorMode === 'class' ? CLASSES[ac.cls].color : altColor(ac.alt, ac.gnd);
  }

  draw() {
    const { g, map, store, dpr } = this;
    const { filters, settings } = this.ctx;
    const selectedHex = this.ctx.selected();
    const now = Date.now();
    const zoom = map.getZoom();
    const scale = zoom < 5 ? 0.7 : zoom < 7 ? 0.85 : zoom > 10 ? 1.2 : 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);

    const drawn = [];
    let selected = null;
    for (const ac of store.values()) {
      if (!filters.match(ac) && ac.hex !== selectedHex) continue;
      const pos = store.position(ac, now);
      const pt = map.latLngToContainerPoint([pos.lat, pos.lon]);
      ac.pos = pos;
      if (ac.hex === selectedHex) selected = ac;
      if (pt.x < -30 || pt.y < -30 || pt.x > this.w + 30 || pt.y > this.h + 30) continue;
      ac.sx = pt.x;
      ac.sy = pt.y;
      drawn.push(ac);
    }
    this.drawn = drawn;
    this.visibleCount = drawn.length;

    if (settings.allTrails) for (const ac of drawn) this.drawTrail(ac, 0.35, 1.2, false);
    if (selected) this.drawTrail(selected, 1, 3, true);

    drawn.sort((a, b) => (a.alt ?? 0) - (b.alt ?? 0));
    const labels = settings.labels && (zoom >= 7 || drawn.length < 250);
    g.font = '600 11px Inter, system-ui, sans-serif';
    g.textBaseline = 'middle';
    for (const ac of drawn) if (ac !== selected) this.drawAircraft(ac, scale, false, now);
    const selectedVisible = selected && drawn.includes(selected);
    if (selectedVisible) this.drawAircraft(selected, scale, true, now);

    // Beschriftungen ohne Überlappung: ausgewählter Flug zuerst, dann von oben nach unten.
    const placed = [];
    if (selectedVisible) placed.push(this.drawLabel(selected, scale, true));
    if (labels) {
      for (let i = drawn.length - 1; i >= 0; i--) {
        const ac = drawn[i];
        if (ac === selected) continue;
        const box = this.labelBox(ac, scale);
        if (placed.some((p) => box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y)) continue;
        placed.push(this.drawLabel(ac, scale, false, box));
      }
    }
    if (selected && this.ctx.follow()) {
      const c = map.latLngToContainerPoint([selected.pos.lat, selected.pos.lon]);
      if (Math.hypot(c.x - this.w / 2, c.y - this.h / 2) > 2) map.panTo([selected.pos.lat, selected.pos.lon], { animate: false });
    }
  }

  drawTrail(ac, alpha, width, byAltitude) {
    const { g, map } = this;
    const pts = ac.trail;
    if (pts.length < 1) return;
    g.save();
    g.globalAlpha = alpha;
    g.lineWidth = width;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    let prev = map.latLngToContainerPoint([pts[0][0], pts[0][1]]);
    if (!byAltitude) {
      g.strokeStyle = CLASSES[ac.cls].color;
      g.beginPath();
      g.moveTo(prev.x, prev.y);
    }
    for (let i = 1; i <= pts.length; i++) {
      const p = i < pts.length ? pts[i] : [ac.pos.lat, ac.pos.lon, ac.gnd ? 0 : ac.alt];
      const pt = map.latLngToContainerPoint([p[0], p[1]]);
      if (byAltitude) {
        g.strokeStyle = altColor(p[2]);
        g.beginPath();
        g.moveTo(prev.x, prev.y);
        g.lineTo(pt.x, pt.y);
        g.stroke();
      } else g.lineTo(pt.x, pt.y);
      prev = pt;
    }
    if (!byAltitude) g.stroke();
    g.restore();
  }

  drawAircraft(ac, scale, selected, now) {
    const { g } = this;
    const cls = CLASSES[ac.cls];
    const size = BASE_PX * cls.size * scale * (selected ? 1.25 : 1);
    const emergency = isEmergencySquawk(ac.sq) || ac.em;
    g.save();
    g.translate(ac.sx, ac.sy);
    if (selected || emergency) {
      const pulse = emergency ? 0.5 + 0.5 * Math.sin(now / 220) : 1;
      g.beginPath();
      g.arc(0, 0, size * 1.9, 0, Math.PI * 2);
      g.fillStyle = emergency ? `rgba(239,68,68,${0.18 + 0.22 * pulse})` : 'rgba(56,189,248,0.22)';
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = emergency ? '#ef4444' : '#38bdf8';
      g.stroke();
    }
    g.rotate((((ac.trk ?? 0) * Math.PI) / 180));
    g.scale(size, size);
    g.lineWidth = 1.6 / size;
    g.strokeStyle = 'rgba(2,6,23,0.85)';
    g.fillStyle = this.colorOf(ac);
    const shape = SHAPES[cls.shape];
    g.stroke(shape);
    g.fill(shape);
    if (cls.shape === 'heli') {
      g.lineWidth = 1.2 / size;
      g.strokeStyle = this.colorOf(ac);
      g.globalAlpha = 0.55;
      g.stroke(ROTOR);
    }
    if (ac.flags & 1 && this.ctx.settings.colorMode !== 'class') {
      // Militär im Höhenmodus zusätzlich markieren
      g.globalAlpha = 1;
      g.lineWidth = 2.2 / size;
      g.strokeStyle = '#ef4444';
      g.stroke(shape);
    }
    g.restore();
  }

  labelText(ac) {
    const text = ac.cs || ac.reg || ac.hex.toUpperCase();
    const sub = ac.gnd ? 'GND' : ac.alt != null ? `FL${String(Math.round(ac.alt / 100)).padStart(3, '0')}` : '';
    return [text, sub];
  }

  labelBox(ac, scale) {
    const [text, sub] = this.labelText(ac);
    const w = Math.max(this.g.measureText(text).width, this.g.measureText(sub).width) + 10;
    return { x: ac.sx + 13 * scale + 4, y: ac.sy - 15, w, h: 30 };
  }

  drawLabel(ac, scale, selected, box = this.labelBox(ac, scale)) {
    const { g } = this;
    const [text, sub] = this.labelText(ac);
    g.fillStyle = selected ? 'rgba(14,116,144,0.92)' : 'rgba(2,6,23,0.72)';
    g.beginPath();
    g.roundRect(box.x, box.y, box.w, box.h, 5);
    g.fill();
    g.fillStyle = '#f8fafc';
    g.fillText(text, box.x + 5, box.y + 9);
    g.fillStyle = '#94a3b8';
    g.fillText(sub, box.x + 5, box.y + 22);
    return box;
  }

  hitTest(x, y, radius = 16) {
    let best = null;
    let bestD = radius;
    for (const ac of this.drawn) {
      const d = Math.hypot(ac.sx - x, ac.sy - y);
      if (d < bestD) {
        bestD = d;
        best = ac;
      }
    }
    return best;
  }
}
