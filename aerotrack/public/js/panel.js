// Detailpanel für das ausgewählte Luftfahrzeug: Live-Werte, Route mit Fortschritt,
// Höhen-/Geschwindigkeitsprofil aus der Spur, Foto und Aktionen.

import { api } from './api.js';
import { CLASSES, FLAG, SQUAWK_TEXT } from './classify.js';
import { countryOf } from './country.js';
import { distanceNm, escapeHtml, fmtAlt, fmtDist, fmtDuration, fmtSpeed, fmtVr } from './geo.js';

const routeCache = new Map();
const photoCache = new Map();

export class Panel {
  constructor(el, { store, settings, onClose, onAction }) {
    this.el = el;
    this.store = store;
    this.settings = settings;
    this.onClose = onClose;
    this.onAction = onAction;
    this.hex = null;
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      if (btn.dataset.act === 'close') this.onClose();
      else this.onAction(btn.dataset.act, this.hex);
    });
  }

  open(hex) {
    this.hex = hex;
    this.route = null;
    const ac = this.store.get(hex);
    if (!ac) return;
    this.el.hidden = false;
    this.el.innerHTML = this.skeleton(ac);
    this.update();
    this.loadRoute(ac);
    this.loadPhoto(ac);
  }

  close() {
    this.hex = null;
    this.route = null;
    this.el.hidden = true;
    this.el.innerHTML = '';
  }

  skeleton(ac) {
    const c = CLASSES[ac.cls];
    const country = countryOf(ac.hex);
    const badges = [
      `<span class="badge" style="--c:${c.color}">${c.label}</span>`,
      ac.flags & FLAG.PIA ? '<span class="badge" style="--c:#fbbf24" title="Privacy ICAO Address: wechselnde, anonymisierte Adresse">PIA</span>' : '',
      ac.flags & FLAG.LADD ? '<span class="badge" style="--c:#fbbf24" title="Steht auf der FAA-LADD-Sperrliste; viele kommerzielle Tracker blenden es aus">LADD</span>' : '',
      ac.flags & FLAG.INTERESTING ? '<span class="badge" style="--c:#a78bfa">Interessant</span>' : '',
    ].join('');
    return `
      <div class="panel-head">
        <div>
          <div class="panel-title" data-f="title"></div>
          <div class="panel-sub">${escapeHtml(ac.desc || ac.type || 'Typ unbekannt')}${ac.op ? ` · ${escapeHtml(ac.op)}` : ''}</div>
          <div class="badges">${badges}</div>
        </div>
        <button class="icon-btn" data-act="close" aria-label="Schließen" title="Schließen (Esc)">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="photo" data-f="photo"><div class="photo-empty">Kein Foto</div></div>
      <div class="route" data-f="route"><div class="muted small">Route wird gesucht …</div></div>
      <div class="emergency" data-f="emergency" hidden></div>
      <div class="grid">
        <div class="cell"><label>Höhe (baro)</label><b data-f="alt"></b></div>
        <div class="cell"><label>Steigrate</label><b data-f="vr"></b></div>
        <div class="cell"><label>Geschwindigkeit</label><b data-f="gs"></b></div>
        <div class="cell"><label>Kurs</label><b data-f="trk"></b></div>
        <div class="cell"><label>Squawk</label><b data-f="sq"></b></div>
        <div class="cell"><label>Höhe (GNSS)</label><b data-f="galt"></b></div>
      </div>
      <div class="chart-wrap">
        <div class="chart-head"><span>Höhenprofil</span><span class="muted small" data-f="span"></span></div>
        <canvas class="chart" data-f="chart" width="320" height="90"></canvas>
      </div>
      <dl class="facts">
        <dt>Kennzeichen</dt><dd>${escapeHtml(ac.reg || '–')}</dd>
        <dt>ICAO-Hex</dt><dd class="mono">${escapeHtml(ac.hex.toUpperCase())}</dd>
        <dt>Registriert in</dt><dd>${country ? `${country.flag} ${country.name}` : '–'}</dd>
        <dt>Baujahr</dt><dd>${escapeHtml(ac.year || '–')}</dd>
        <dt>Position</dt><dd class="mono" data-f="pos"></dd>
        <dt>Datenquelle</dt><dd data-f="src"></dd>
        <dt>Letztes Signal</dt><dd data-f="seen"></dd>
      </dl>
      <div class="actions">
        <button class="btn" data-act="follow" data-f="follow">Folgen</button>
        <button class="btn" data-act="watch">Zur Watchlist</button>
        <button class="btn" data-act="share">Link kopieren</button>
        <button class="btn" data-act="zoom">Heranzoomen</button>
      </div>`;
  }

  f(name) {
    return this.el.querySelector(`[data-f="${name}"]`);
  }

  update(state = {}) {
    if (!this.hex) return;
    const ac = this.store.get(this.hex);
    if (!ac) return;
    const u = this.settings.units;
    const title = ac.cs || ac.reg || ac.hex.toUpperCase();
    this.f('title').textContent = title;
    this.f('alt').textContent = fmtAlt(ac.alt, u, ac.gnd);
    this.f('galt').textContent = fmtAlt(ac.galt, u);
    this.f('vr').textContent = fmtVr(ac.vr, u);
    this.f('gs').textContent = fmtSpeed(ac.gs, u);
    this.f('trk').textContent = ac.trk != null ? `${Math.round(ac.trk)}°` : '–';
    this.f('sq').textContent = ac.sq || '–';
    const p = ac.pos || ac;
    this.f('pos').textContent = `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`;
    this.f('src').textContent = srcLabel(ac.src);
    const age = Math.round((Date.now() - ac.fixT) / 1000);
    this.f('seen').textContent = age <= 1 ? 'gerade eben' : `vor ${age} s`;
    this.f('follow').classList.toggle('on', !!state.follow);
    const em = this.f('emergency');
    const emText = SQUAWK_TEXT[ac.sq] || (ac.em ? `Notfallstatus: ${ac.em}` : '');
    em.hidden = !emText;
    em.textContent = emText;
    this.drawChart(ac);
    this.updateRouteProgress(ac);
  }

  drawChart(ac) {
    const cv = this.f('chart');
    const pts = ac.trail.filter((p) => p[2] != null);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth || 320;
    const h = 90;
    if (cv.width !== w * dpr) {
      cv.width = w * dpr;
      cv.height = h * dpr;
    }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const spanEl = this.f('span');
    if (pts.length < 2) {
      spanEl.textContent = 'sammle Daten …';
      return;
    }
    const t0 = pts[0][3];
    const t1 = pts.at(-1)[3];
    spanEl.textContent = `letzte ${Math.max(1, Math.round((t1 - t0) / 60000))} min`;
    const maxAlt = Math.max(1000, ...pts.map((p) => p[2]));
    const maxGs = Math.max(100, ...pts.map((p) => p[4] || 0));
    const x = (t) => 4 + ((t - t0) / Math.max(1, t1 - t0)) * (w - 8);
    const yA = (a) => h - 6 - (a / maxAlt) * (h - 16);
    const yS = (s) => h - 6 - (s / maxGs) * (h - 16);
    const css = getComputedStyle(document.documentElement);
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(x(p[3]), yA(p[2])) : g.moveTo(x(p[3]), yA(p[2]))));
    g.lineTo(x(t1), h - 6);
    g.lineTo(x(t0), h - 6);
    g.closePath();
    g.fillStyle = 'rgba(56,189,248,0.15)';
    g.fill();
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(x(p[3]), yA(p[2])) : g.moveTo(x(p[3]), yA(p[2]))));
    g.strokeStyle = css.getPropertyValue('--accent').trim() || '#38bdf8';
    g.lineWidth = 2;
    g.stroke();
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(x(p[3]), yS(p[4] || 0)) : g.moveTo(x(p[3]), yS(p[4] || 0))));
    g.strokeStyle = '#f472b6';
    g.lineWidth = 1.2;
    g.setLineDash([4, 3]);
    g.stroke();
    g.setLineDash([]);
  }

  async loadRoute(ac) {
    const hex = ac.hex;
    const el = () => (this.hex === hex ? this.f('route') : null);
    if (!ac.cs) {
      el() && (el().innerHTML = '<div class="muted small">Kein Rufzeichen – Route unbekannt</div>');
      return;
    }
    let route = routeCache.get(ac.cs);
    if (route === undefined) {
      try {
        const res = await api.routes([{ cs: ac.cs, lat: ac.lat, lon: ac.lon }]);
        route = res[ac.cs] || null;
      } catch {
        route = null;
      }
      routeCache.set(ac.cs, route);
    }
    const target = el();
    if (!target) return;
    if (!route) {
      target.innerHTML = '<div class="muted small">Route nicht in der Datenbank</div>';
      return;
    }
    const [from, to] = [route.airports[0], route.airports.at(-1)];
    const ap = (a) => `
      <div class="ap">
        <div class="ap-code">${escapeHtml(a.iata || a.icao || '?')}</div>
        <div class="ap-name">${escapeHtml(a.city || a.name || '')}</div>
      </div>`;
    target.innerHTML = `
      <div class="route-row">${ap(from)}<div class="route-line"><div class="route-bar"><i data-f="progress"></i></div><div class="route-eta muted small" data-f="eta"></div></div>${ap(to)}</div>
      ${route.plausible ? '' : '<div class="muted small warn-text">Route laut Datenbank unsicher</div>'}`;
    this.route = { hex, from, to };
    this.updateRouteProgress(ac);
  }

  updateRouteProgress(ac) {
    if (!this.route || this.route.hex !== ac.hex) return;
    const bar = this.f('progress');
    const eta = this.f('eta');
    if (!bar) return;
    const { from, to } = this.route;
    const p = ac.pos || ac;
    const done = distanceNm(from.lat, from.lon, p.lat, p.lon);
    const left = distanceNm(p.lat, p.lon, to.lat, to.lon);
    const pct = Math.max(0, Math.min(100, (done / (done + left)) * 100));
    bar.style.width = `${pct}%`;
    const mins = ac.gs > 50 ? (left / ac.gs) * 60 : null;
    eta.textContent = `${fmtDist(left, this.settings.units)} verbleibend${mins ? ` · ca. ${fmtDuration(mins)}` : ''}`;
  }

  async loadPhoto(ac) {
    const hex = ac.hex;
    let photo = photoCache.get(hex);
    if (photo === undefined) {
      try {
        photo = await api.photo(hex);
      } catch {
        photo = null;
      }
      photoCache.set(hex, photo);
    }
    if (this.hex !== hex || !photo?.src) return;
    const box = this.f('photo');
    box.innerHTML = `<img alt="Foto ${escapeHtml(ac.reg || hex)}" referrerpolicy="no-referrer">
      <a class="photo-credit" target="_blank" rel="noopener" href="${escapeHtml(photo.link)}">© ${escapeHtml(photo.by || 'Unbekannt')} · Planespotters.net</a>`;
    box.querySelector('img').src = photo.src;
  }
}

function srcLabel(src) {
  if (!src) return '–';
  if (src.startsWith('adsb')) return 'ADS-B';
  if (src.startsWith('mlat')) return 'MLAT (Multilateration)';
  if (src.startsWith('tisb')) return 'TIS-B';
  if (src.startsWith('adsr')) return 'ADS-R';
  if (src.startsWith('mode_s')) return 'Mode S';
  return src;
}
