// Einstiegspunkt: verbindet Karte, Datenabfragen, Ebenen und Bedienoberfläche.

import { api } from './api.js';
import { Alerts, WATCH_KINDS } from './alerts.js';
import { CLASSES } from './classify.js';
import { Filters } from './filters.js';
import { distanceNm, escapeHtml, fmtAlt, fmtSpeed, nightPolygon } from './geo.js';
import { AircraftLayer } from './layer.js';
import { Panel } from './panel.js';
import * as prefs from './prefs.js';
import { PushClient } from './push.js';
import { Store } from './store.js';

const AREA_INTERVAL = 3000;
const MIL_INTERVAL = 10000;
const WATCH_INTERVAL = 20000;
const MAX_RADIUS_NM = 250;

const $ = (sel) => document.querySelector(sel);
const saved = prefs.load();

const settings = {
  basemap: 'dark',
  labels: false,
  allTrails: false,
  night: true,
  weather: false,
  milGlobal: false,
  rings: true,
  colorMode: 'alt',
  units: 'aviation',
  ...saved.settings,
};

const state = { selected: null, follow: false, demo: false, lastOk: 0, error: null, capped: false };
const store = new Store();
const filters = new Filters(saved.filters);
const alerts = new Alerts(saved.alerts, { notify });

const push = new PushClient();
let lastRules = JSON.stringify(alerts.toJSON());

function persist() {
  const c = map.getCenter();
  prefs.save({ settings, filters: filters.toJSON(), alerts: alerts.toJSON(), view: [c.lat, c.lng, map.getZoom()] });
  const rules = JSON.stringify(alerts.toJSON());
  if (rules !== lastRules) {
    lastRules = rules;
    push.sync(alerts.toJSON());
  }
}

// ---------- Karte ----------

const BASEMAPS = {
  dark: {
    label: 'Dunkel',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attr: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>',
  },
  light: {
    label: 'Hell',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attr: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>',
  },
  satellite: {
    label: 'Satellit',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: 'Bilder © Esri, Maxar, Earthstar Geographics',
  },
  osm: {
    label: 'OSM',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attr: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
  },
};

function initialView() {
  const m = location.hash.match(/^#(\d{1,2})\/(-?[\d.]+)\/(-?[\d.]+)(?:\/([0-9a-f~]{6,7}))?/i);
  if (m) return { zoom: +m[1], center: [+m[2], +m[3]], hex: m[4]?.toLowerCase() };
  const ac = location.hash.match(/^#ac\/([0-9a-f~]{6,7})$/i)?.[1]?.toLowerCase();
  if (saved.view) return { zoom: saved.view[2], center: [saved.view[0], saved.view[1]], hex: ac };
  return { zoom: 7, center: [50.6, 9.5], hex: ac };
}

const view = initialView();
const map = L.map('map', {
  center: view.center,
  zoom: view.zoom,
  minZoom: 3,
  maxZoom: 16,
  zoomControl: false,
  worldCopyJump: true,
  preferCanvas: true,
});
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.control.scale({ position: 'bottomright', imperial: false }).addTo(map);
map.attributionControl.setPrefix(false);

let baseLayer = null;
function setBasemap(key) {
  settings.basemap = BASEMAPS[key] ? key : 'dark';
  const b = BASEMAPS[settings.basemap];
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = L.tileLayer(b.url, { attribution: b.attr, maxZoom: 19, subdomains: 'abcd', detectRetina: false }).addTo(map);
  document.body.dataset.basemap = settings.basemap;
}
setBasemap(settings.basemap);

let nightLayer = null;
function updateNight() {
  if (nightLayer) map.removeLayer(nightLayer);
  nightLayer = null;
  if (!settings.night) return;
  nightLayer = L.polygon(nightPolygon(), {
    stroke: false,
    fillColor: '#000814',
    fillOpacity: settings.basemap === 'light' ? 0.18 : 0.32,
    interactive: false,
  }).addTo(map);
}

let weatherLayer = null;
async function updateWeather() {
  if (weatherLayer) map.removeLayer(weatherLayer);
  weatherLayer = null;
  if (!settings.weather) return;
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    const frame = data.radar?.past?.at(-1);
    if (!frame || !settings.weather) throw new Error('keine Radardaten');
    weatherLayer = L.tileLayer(`${data.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, {
      opacity: 0.55,
      maxNativeZoom: 7,
      maxZoom: 19,
      attribution: 'Radar © <a href="https://www.rainviewer.com">RainViewer</a>',
    }).addTo(map);
  } catch {
    toast({ level: 'warn', title: 'Niederschlagsradar nicht verfügbar', body: 'RainViewer hat nicht geantwortet.' });
  }
}

let zoneLayer = null;
function updateZone() {
  if (zoneLayer) map.removeLayer(zoneLayer);
  zoneLayer = null;
  const z = alerts.zone;
  if (z.lat == null) return;
  zoneLayer = L.layerGroup().addTo(map);
  L.circle([z.lat, z.lon], {
    radius: z.km * 1000,
    color: z.enabled ? '#38bdf8' : '#64748b',
    weight: 1.5,
    dashArray: z.enabled ? null : '6 6',
    fillOpacity: z.enabled ? 0.06 : 0.02,
    interactive: false,
  }).addTo(zoneLayer);
  L.circleMarker([z.lat, z.lon], { radius: 4, color: '#38bdf8', fillOpacity: 1, interactive: false }).addTo(zoneLayer);
  if (settings.rings) {
    for (const nm of [25, 50, 100, 150]) {
      L.circle([z.lat, z.lon], { radius: nm * 1852, color: '#94a3b8', weight: 0.8, opacity: 0.45, fill: false, interactive: false }).addTo(zoneLayer);
    }
  }
}

// ---------- Kernkomponenten ----------

const layer = new AircraftLayer(map, store, {
  filters,
  settings,
  selected: () => state.selected,
  follow: () => state.follow,
});

const panel = new Panel($('#panel'), {
  store,
  settings,
  onClose: () => select(null),
  onAction: panelAction,
});

function select(hex, { pan = false } = {}) {
  state.selected = hex;
  state.follow = false;
  if (!hex) {
    panel.close();
    document.body.classList.remove('has-panel');
  } else {
    document.body.classList.add('has-panel');
    panel.open(hex);
    const ac = store.get(hex);
    if (pan && ac) map.setView([ac.lat, ac.lon], Math.max(map.getZoom(), 8));
  }
  updateHash();
}

function panelAction(act, hex) {
  const ac = store.get(hex);
  if (!ac) return;
  if (act === 'follow') {
    state.follow = !state.follow;
    panel.update(state);
  } else if (act === 'zoom') {
    map.setView([ac.pos?.lat ?? ac.lat, ac.pos?.lon ?? ac.lon], 11);
  } else if (act === 'watch') {
    const [kind, value] = ac.reg ? ['reg', ac.reg] : ['hex', ac.hex];
    if (alerts.addWatch(kind, value, ac.cs || '')) {
      toast({ level: 'info', title: 'Zur Watchlist hinzugefügt', body: `${WATCH_KINDS[kind]} ${value.toUpperCase()}` });
      renderWatch();
      persist();
    } else toast({ level: 'warn', title: 'Nicht hinzugefügt', body: 'Bereits vorhanden oder Liste voll.' });
  } else if (act === 'share') {
    updateHash();
    navigator.clipboard?.writeText(location.href).then(
      () => toast({ level: 'info', title: 'Link kopiert', body: 'Der Link öffnet genau diesen Flug.' }),
      () => toast({ level: 'warn', title: 'Kopieren nicht möglich', body: location.href }),
    );
  }
}

// ---------- Daten ----------

function viewRadiusNm() {
  const b = map.getBounds();
  const c = map.getCenter();
  return distanceNm(c.lat, c.lng, b.getNorth(), b.getEast());
}

let areaTimer = null;
let areaBusy = false;
async function pollArea() {
  clearTimeout(areaTimer);
  if (document.hidden) {
    areaTimer = setTimeout(pollArea, AREA_INTERVAL);
    return;
  }
  if (areaBusy) return;
  areaBusy = true;
  try {
    const c = map.getCenter();
    const r = viewRadiusNm();
    const data = await api.area(c.lat, ((c.lng + 540) % 360) - 180, Math.min(r, 5000));
    const fresh = store.ingest(data.ac);
    state.capped = data.capped || r > MAX_RADIUS_NM;
    state.lastOk = Date.now();
    state.error = null;
    alerts.check(data.ac.map((a) => store.get(a.hex)).filter(Boolean));
    if (fresh.length && state.selected == null && pendingHex) trySelectPending();
  } catch (err) {
    state.error = err.message;
  } finally {
    areaBusy = false;
    const keep = new Set([state.selected, ...watchHits].filter(Boolean));
    store.prune(keep);
    afterTick();
    areaTimer = setTimeout(pollArea, AREA_INTERVAL);
  }
}

async function pollMil() {
  if (settings.milGlobal && !document.hidden) {
    try {
      const data = await api.mil();
      store.ingest(data.ac);
    } catch {
      // nächster Versuch beim nächsten Intervall
    }
  }
  setTimeout(pollMil, MIL_INTERVAL);
}

const watchHits = new Set();
async function pollWatch() {
  const queries = alerts.watch.filter((w) => w.kind !== 'type');
  for (const w of queries) {
    if (document.hidden) break;
    try {
      const data = await api.search(w.value);
      const matches = data.ac.filter((a) => alerts.watchMatch({ ...a, cls: 'other' }));
      store.ingest(matches);
      for (const a of matches) watchHits.add(a.hex);
      alerts.check(matches.map((a) => store.get(a.hex)).filter(Boolean));
    } catch {
      // einzelne Fehlschläge ignorieren
    }
  }
  setTimeout(pollWatch, WATCH_INTERVAL);
}

let pendingHex = view.hex || null;
async function trySelectPending() {
  if (!pendingHex) return;
  const hex = pendingHex;
  if (!store.get(hex)) {
    try {
      store.ingest((await api.search(hex)).ac.filter((a) => a.hex === hex));
    } catch {
      return;
    }
  }
  if (store.get(hex)) {
    pendingHex = null;
    select(hex, { pan: true });
  }
}

map.on('moveend', () => {
  updateHash();
  persist();
  clearTimeout(areaTimer);
  areaTimer = setTimeout(pollArea, 250);
});
map.on('dragstart', () => {
  if (state.follow) {
    state.follow = false;
    panel.update(state);
  }
});

// ---------- Oberfläche ----------

function afterTick() {
  const total = store.ac.size;
  const visible = layer.visibleCount ?? 0;
  $('#count-chip').textContent = `${visible.toLocaleString('de-DE')} sichtbar · ${total.toLocaleString('de-DE')} geladen`;
  $('#filter-chip').hidden = !filters.active;
  $('#coverage').hidden = !state.capped;
  const dot = $('#status-dot');
  const text = $('#status-text');
  if (state.error && Date.now() - state.lastOk > 10000) {
    dot.className = 'dot err';
    text.textContent = `Keine Verbindung zur Datenquelle (${state.error})`;
  } else if (state.lastOk) {
    dot.className = state.demo ? 'dot demo' : 'dot live';
    text.textContent = state.demo ? 'DEMO · simulierte Daten' : 'LIVE · adsb.lol';
  }
  if (state.selected) {
    if (store.get(state.selected)) panel.update(state);
    else {
      toast({ level: 'warn', title: 'Signal verloren', body: 'Das ausgewählte Luftfahrzeug sendet nicht mehr.' });
      select(null);
    }
  }
  if (!$('#drawer').hidden && activeTab === 'stats') renderStats();
}

function updateHash() {
  const c = map.getCenter();
  const h = `#${map.getZoom()}/${c.lat.toFixed(4)}/${c.lng.toFixed(4)}${state.selected ? `/${state.selected}` : ''}`;
  if (location.hash !== h) history.replaceState(null, '', h);
}

// Tooltip und Auswahl per Klick auf die Canvas-Ebene
const tip = $('#tooltip');
map.on('mousemove', (e) => {
  const ac = layer.hitTest(e.containerPoint.x, e.containerPoint.y);
  map.getContainer().style.cursor = ac ? 'pointer' : '';
  if (!ac) {
    tip.hidden = true;
    return;
  }
  tip.hidden = false;
  tip.innerHTML = `<b>${escapeHtml(ac.cs || ac.reg || ac.hex.toUpperCase())}</b> <span>${escapeHtml(ac.type || '')}</span><br>
    <span>${fmtAlt(ac.alt, settings.units, ac.gnd)} · ${fmtSpeed(ac.gs, settings.units)}</span>`;
  tip.style.transform = `translate(${e.originalEvent.clientX + 14}px, ${e.originalEvent.clientY + 14}px)`;
});
map.on('mouseout', () => (tip.hidden = true));
map.on('click', (e) => {
  const ac = layer.hitTest(e.containerPoint.x, e.containerPoint.y, 22);
  select(ac ? ac.hex : null);
});

// ---------- Suche ----------

const searchInput = $('#search');
const searchBox = $('#search-results');
let searchSeq = 0;

function resultRow(ac) {
  const c = CLASSES[ac.cls || 'other'];
  return `<button class="result" role="option" data-hex="${escapeHtml(ac.hex)}">
    <i class="swatch" style="background:${c.color}"></i>
    <b>${escapeHtml(ac.cs || ac.reg || ac.hex.toUpperCase())}</b>
    <span>${escapeHtml([ac.reg, ac.type].filter(Boolean).join(' · '))}</span>
    <em>${fmtAlt(ac.alt, settings.units, ac.gnd)}</em>
  </button>`;
}

function localMatches(q) {
  const s = q.toUpperCase().replace(/[\s-]/g, '');
  const out = [];
  for (const ac of store.values()) {
    const hay = [ac.cs, ac.reg?.replace('-', ''), ac.hex.toUpperCase(), ac.type].filter(Boolean);
    if (hay.some((h) => h.toUpperCase().startsWith(s))) out.push(ac);
    if (out.length >= 8) break;
  }
  return out;
}

function showResults(html) {
  searchBox.innerHTML = html;
  searchBox.hidden = !html;
}

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  if (q.length < 2) return showResults('');
  const local = localMatches(q);
  showResults(
    (local.length ? `<div class="result-head">Im geladenen Bereich</div>${local.map(resultRow).join('')}` : '') +
      `<button class="result global" data-global="1">Weltweit suchen nach „${escapeHtml(q)}“ <kbd>Enter</kbd></button>`,
  );
});

async function globalSearch(q) {
  const seq = ++searchSeq;
  showResults('<div class="result-head">Suche weltweit …</div>');
  try {
    const data = await api.search(q);
    if (seq !== searchSeq) return;
    store.ingest(data.ac);
    const list = data.ac.map((a) => store.get(a.hex)).filter(Boolean);
    if (list.length === 1) {
      showResults('');
      searchInput.blur();
      return select(list[0].hex, { pan: true });
    }
    showResults(
      list.length
        ? `<div class="result-head">${list.length} Treffer weltweit</div>${list.slice(0, 40).map(resultRow).join('')}`
        : '<div class="result-head">Nichts gefunden. Das Luftfahrzeug sendet gerade nicht oder nutzt eine anonyme Adresse (PIA).</div>',
    );
  } catch (err) {
    if (seq === searchSeq) showResults(`<div class="result-head">Suche fehlgeschlagen: ${escapeHtml(err.message)}</div>`);
  }
}

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') globalSearch(searchInput.value.trim());
  if (e.key === 'Escape') {
    showResults('');
    searchInput.blur();
  }
});
searchBox.addEventListener('click', (e) => {
  const row = e.target.closest('.result');
  if (!row) return;
  if (row.dataset.global) return globalSearch(searchInput.value.trim());
  showResults('');
  select(row.dataset.hex, { pan: true });
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search')) showResults('');
});

// ---------- Drawer ----------

const drawer = $('#drawer');
let activeTab = 'filters';

function openDrawer(tab) {
  if (!drawer.hidden && activeTab === tab) return closeDrawer();
  activeTab = tab;
  drawer.hidden = false;
  document.body.classList.add('has-drawer');
  drawer.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab));
  drawer.querySelectorAll('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== tab));
  document.querySelectorAll('[data-drawer]').forEach((b) => b.classList.toggle('on', b.dataset.drawer === tab));
  if (tab === 'stats') renderStats();
  if (tab === 'alerts') {
    $('#alert-badge').hidden = true;
    renderNotifState();
  }
}

function closeDrawer() {
  drawer.hidden = true;
  document.body.classList.remove('has-drawer');
  document.querySelectorAll('[data-drawer]').forEach((b) => b.classList.remove('on'));
}

document.querySelectorAll('[data-drawer]').forEach((b) => b.addEventListener('click', () => openDrawer(b.dataset.drawer)));
drawer.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => openDrawer(b.dataset.tab)));
$('#drawer-close').addEventListener('click', closeDrawer);

// Filter
const classBox = $('#class-filter');
classBox.innerHTML = Object.entries(CLASSES)
  .map(([k, c]) => `<label class="class-chip"><input type="checkbox" value="${k}"><i style="background:${c.color}"></i>${c.label}</label>`)
  .join('');

function syncFilterUi() {
  classBox.querySelectorAll('input').forEach((i) => (i.checked = filters.classes.includes(i.value)));
  $('#alt-min').value = filters.altMin;
  $('#alt-max').value = filters.altMax;
  $('#spd-min').value = filters.spdMin;
  $('#text-filter').value = filters.text;
  $('#hide-ground').checked = filters.hideGround;
  $('#only-emergency').checked = filters.onlyEmergency;
  $('#alt-label').textContent = `${fmtAlt(filters.altMin, settings.units)} – ${filters.altMax >= 50000 ? 'unbegrenzt' : fmtAlt(filters.altMax, settings.units)}`;
  $('#spd-label').textContent = filters.spdMin ? fmtSpeed(filters.spdMin, settings.units) : 'keine';
}

function onFilterChange() {
  let altMin = +$('#alt-min').value;
  let altMax = +$('#alt-max').value;
  if (altMin > altMax) [altMin, altMax] = [altMax, altMin];
  filters.set({
    classes: [...classBox.querySelectorAll('input:checked')].map((i) => i.value),
    altMin,
    altMax,
    spdMin: +$('#spd-min').value,
    text: $('#text-filter').value,
    hideGround: $('#hide-ground').checked,
    onlyEmergency: $('#only-emergency').checked,
  });
  syncFilterUi();
  afterTick();
  persist();
}

$('[data-pane="filters"]').addEventListener('input', onFilterChange);
$('#filter-reset').addEventListener('click', () => {
  filters.reset();
  syncFilterUi();
  afterTick();
  persist();
});

// Karte & Ebenen
$('#basemap').innerHTML = Object.entries(BASEMAPS).map(([k, b]) => `<button data-v="${k}">${b.label}</button>`).join('');

function syncSeg(id, value) {
  document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === value));
}

function syncLayerUi() {
  syncSeg('basemap', settings.basemap);
  syncSeg('color-mode', settings.colorMode);
  syncSeg('units', settings.units);
  $('#opt-labels').checked = settings.labels;
  $('#opt-trails').checked = settings.allTrails;
  $('#opt-night').checked = settings.night;
  $('#opt-weather').checked = settings.weather;
  $('#opt-mil').checked = settings.milGlobal;
  $('#opt-rings').checked = settings.rings;
  document.body.classList.toggle('color-class', settings.colorMode === 'class');
}

$('#basemap').addEventListener('click', (e) => {
  const v = e.target.closest('button')?.dataset.v;
  if (!v) return;
  setBasemap(v);
  updateNight();
  syncLayerUi();
  persist();
});
$('#color-mode').addEventListener('click', (e) => {
  const v = e.target.closest('button')?.dataset.v;
  if (!v) return;
  settings.colorMode = v;
  syncLayerUi();
  persist();
});
$('#units').addEventListener('click', (e) => {
  const v = e.target.closest('button')?.dataset.v;
  if (!v) return;
  settings.units = v;
  syncLayerUi();
  syncFilterUi();
  syncAlertUi();
  panel.update(state);
  persist();
});

const toggles = {
  'opt-labels': ['labels'],
  'opt-trails': ['allTrails'],
  'opt-night': ['night', updateNight],
  'opt-weather': ['weather', updateWeather],
  'opt-mil': ['milGlobal'],
  'opt-rings': ['rings', updateZone],
};
for (const [id, [key, fn]] of Object.entries(toggles)) {
  $(`#${id}`).addEventListener('change', (e) => {
    settings[key] = e.target.checked;
    fn?.();
    persist();
  });
}

// Alarme
$('#watch-kind').innerHTML = Object.entries(WATCH_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
$('#zone-cls').innerHTML =
  '<option value="all">Alle Luftfahrzeuge</option>' + Object.entries(CLASSES).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join('');

function renderWatch() {
  const list = $('#watch-list');
  list.innerHTML = alerts.watch.length
    ? alerts.watch
        .map((w, i) => {
          const hit = [...store.values()].find((ac) => alerts.watchMatch(ac) === w);
          return `<li><span><b>${escapeHtml(w.value)}</b> <span class="muted small">${WATCH_KINDS[w.kind]}${w.label ? ` · ${escapeHtml(w.label)}` : ''}</span></span>
            <span class="row-actions">${hit ? `<button class="pill live" data-show="${hit.hex}">aktiv · anzeigen</button>` : '<span class="pill">nicht aktiv</span>'}
            <button class="icon-btn sm" data-remove="${i}" aria-label="Entfernen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></span></li>`;
        })
        .join('')
    : '<li class="muted small">Leer. Füge Kennzeichen, Rufzeichen, ICAO-Hex oder Typ hinzu.</li>';
}

$('#watch-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const ok = alerts.addWatch($('#watch-kind').value, $('#watch-value').value, $('#watch-label').value);
  if (!ok) return toast({ level: 'warn', title: 'Nicht hinzugefügt', body: 'Leer, doppelt oder Liste voll (max. 25).' });
  $('#watch-value').value = '';
  $('#watch-label').value = '';
  renderWatch();
  persist();
  pollWatchOnce();
});
$('#watch-list').addEventListener('click', (e) => {
  const rm = e.target.closest('[data-remove]');
  const show = e.target.closest('[data-show]');
  if (rm) {
    alerts.removeWatch(+rm.dataset.remove);
    renderWatch();
    persist();
  } else if (show) select(show.dataset.show, { pan: true });
});

async function pollWatchOnce() {
  const w = alerts.watch.at(-1);
  if (!w || w.kind === 'type') return;
  try {
    const data = await api.search(w.value);
    const matches = data.ac.filter((a) => alerts.watchMatch({ ...a }));
    store.ingest(matches);
    matches.forEach((a) => watchHits.add(a.hex));
    alerts.check(matches.map((a) => store.get(a.hex)).filter(Boolean));
    renderWatch();
  } catch {
    // nächster regulärer Durchlauf versucht es erneut
  }
}

function syncAlertUi() {
  const z = alerts.zone;
  $('#zone-on').checked = z.enabled;
  $('#zone-km').value = z.km;
  $('#zone-km-label').textContent = `${z.km} km`;
  $('#zone-cls').value = z.cls;
  $('#zone-pos').textContent = z.lat == null ? 'Noch kein Mittelpunkt gesetzt.' : `Mittelpunkt: ${z.lat.toFixed(4)}, ${z.lon.toFixed(4)}`;
  $('#squawk-on').checked = alerts.squawk;
}

function setZoneCenter(lat, lon) {
  alerts.zone.lat = lat;
  alerts.zone.lon = lon;
  alerts.zone.enabled = true;
  syncAlertUi();
  updateZone();
  persist();
}

$('#zone-on').addEventListener('change', (e) => {
  alerts.zone.enabled = e.target.checked;
  if (alerts.zone.enabled && alerts.zone.lat == null) {
    const c = map.getCenter();
    return setZoneCenter(c.lat, c.lng);
  }
  updateZone();
  persist();
});
$('#zone-center').addEventListener('click', () => {
  const c = map.getCenter();
  setZoneCenter(c.lat, c.lng);
});
$('#zone-geo').addEventListener('click', () => {
  if (!navigator.geolocation) return toast({ level: 'warn', title: 'Standort nicht verfügbar', body: 'Der Browser unterstützt keine Ortung.' });
  navigator.geolocation.getCurrentPosition(
    (p) => {
      setZoneCenter(p.coords.latitude, p.coords.longitude);
      map.setView([p.coords.latitude, p.coords.longitude], 9);
    },
    (err) => toast({ level: 'warn', title: 'Standort nicht ermittelt', body: err.message }),
    { enableHighAccuracy: false, timeout: 10000 },
  );
});
$('#zone-km').addEventListener('input', (e) => {
  alerts.zone.km = +e.target.value;
  syncAlertUi();
  updateZone();
  persist();
});
$('#zone-cls').addEventListener('change', (e) => {
  alerts.zone.cls = e.target.value;
  persist();
});
$('#squawk-on').addEventListener('change', (e) => {
  alerts.squawk = e.target.checked;
  persist();
});

const PUSH_TEXT = {
  on: 'Push ist <b>aktiv</b>: Alarme aus Watchlist und Zone kommen auch bei geschlossenem Tab, solange der AeroTrack-Server läuft.',
  off: 'Push ist aus. Ohne Push meldet die App nur, solange dieser Tab geöffnet ist.',
  denied: 'Benachrichtigungen sind im Browser blockiert. Erlaube sie in den Website-Einstellungen.',
  install: 'Auf iPhone/iPad funktioniert Push nur, wenn AeroTrack über „Teilen → Zum Home-Bildschirm“ installiert und von dort geöffnet wird.',
  unsupported: 'Dieser Browser unterstützt kein Web-Push. Alarme erscheinen nur in der App.',
  insecure: 'Push braucht HTTPS (oder localhost). Aktuell nicht verfügbar.',
};

function renderNotifState() {
  const st = push.state;
  const btn = st === 'on'
    ? '<div class="row"><button class="btn sm" id="push-test">Test senden</button><button class="btn sm ghost" id="push-off">Deaktivieren</button></div>'
    : st === 'off' ? '<div class="row"><button class="btn sm" id="push-on">Push auf diesem Gerät aktivieren</button></div>' : '';
  $('#notif-state').innerHTML = `<div>${PUSH_TEXT[st]}</div>${btn}`;
  $('#notif-state').classList.toggle('ok', st === 'on');
  $('#push-on')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await push.enable(alerts.toJSON());
      lastRules = JSON.stringify(alerts.toJSON());
      toast({ level: 'info', title: 'Push aktiviert', body: 'Du wirst auch bei geschlossenem Tab benachrichtigt.' });
    } catch (err) {
      toast({ level: 'warn', title: 'Push nicht aktiviert', body: err.message });
    }
    renderNotifState();
  });
  $('#push-off')?.addEventListener('click', async () => {
    await push.disable();
    renderNotifState();
  });
  $('#push-test')?.addEventListener('click', () =>
    push.test().then(
      () => toast({ level: 'info', title: 'Test gesendet', body: 'Die Meldung sollte gleich erscheinen.' }),
      (err) => toast({ level: 'warn', title: 'Test fehlgeschlagen', body: err.message }),
    ));
}

function renderLog() {
  const fmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  $('#alert-log').innerHTML = alerts.log.length
    ? alerts.log
        .map((e) => `<li class="lvl-${e.level}"><button class="log-row" data-show="${escapeHtml(e.hex)}"><b>${escapeHtml(e.title)}</b><span>${escapeHtml(e.body)}</span><time>${fmt.format(e.t)}</time></button></li>`)
        .join('')
    : '<li class="muted small">Noch keine Ereignisse.</li>';
}
$('#alert-log').addEventListener('click', (e) => {
  const row = e.target.closest('[data-show]');
  if (row && store.get(row.dataset.show)) select(row.dataset.show, { pan: true });
});

function notify(entry) {
  toast(entry);
  renderLog();
  renderWatch();
  if (drawer.hidden || activeTab !== 'alerts') $('#alert-badge').hidden = false;
  if (push.state !== 'on' && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
    try {
      const n = new Notification(entry.title, { body: entry.body, tag: entry.hex });
      n.onclick = () => {
        window.focus();
        select(entry.hex, { pan: true });
      };
    } catch {
      // manche mobilen Browser erlauben Notifications nur über einen Service Worker
    }
  }
}

function toast({ level = 'info', title, body, hex }) {
  const el = document.createElement('div');
  el.className = `toast lvl-${level}`;
  el.innerHTML = `<b>${escapeHtml(title)}</b><span>${escapeHtml(body || '')}</span>`;
  if (hex) {
    el.classList.add('clickable');
    el.addEventListener('click', () => store.get(hex) && select(hex, { pan: true }));
  }
  $('#toasts').prepend(el);
  setTimeout(() => el.classList.add('out'), level === 'danger' ? 12000 : 6000);
  setTimeout(() => el.remove(), level === 'danger' ? 12600 : 6600);
}

// Analyse
function renderStats() {
  const vis = layer.drawn || [];
  $('#st-visible').textContent = vis.length.toLocaleString('de-DE');
  $('#st-total').textContent = store.ac.size.toLocaleString('de-DE');
  const airborne = vis.filter((a) => !a.gnd && a.alt != null);
  $('#st-avgalt').textContent = airborne.length ? fmtAlt(Math.round(airborne.reduce((s, a) => s + a.alt, 0) / airborne.length / 100) * 100, settings.units) : '–';

  const bars = (entries, colorOf) => {
    const max = Math.max(1, ...entries.map((e) => e[1]));
    return entries
      .map(([k, n]) => `<div class="bar"><span>${escapeHtml(k)}</span><i style="width:${(n / max) * 100}%;background:${colorOf(k)}"></i><b>${n}</b></div>`)
      .join('') || '<div class="muted small">Keine Daten</div>';
  };
  const byClass = {};
  const byType = {};
  for (const a of vis) {
    byClass[a.cls] = (byClass[a.cls] || 0) + 1;
    if (a.type) byType[a.type] = (byType[a.type] || 0) + 1;
  }
  $('#st-classes').innerHTML = bars(
    Object.entries(byClass).sort((a, b) => b[1] - a[1]).map(([k, n]) => [CLASSES[k].label, n]),
    (label) => Object.values(CLASSES).find((c) => c.label === label)?.color || '#94a3b8',
  );
  $('#st-types').innerHTML = bars(Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 8), () => 'var(--accent)');
  const row = (a, val) => `<li><button class="log-row" data-show="${escapeHtml(a.hex)}"><b>${escapeHtml(a.cs || a.reg || a.hex.toUpperCase())}</b><span>${escapeHtml(a.type || '')}</span><time>${val}</time></button></li>`;
  $('#st-high').innerHTML = [...airborne].sort((a, b) => b.alt - a.alt).slice(0, 5).map((a) => row(a, fmtAlt(a.alt, settings.units))).join('');
  $('#st-fast').innerHTML = vis.filter((a) => a.gs != null).sort((a, b) => b.gs - a.gs).slice(0, 5).map((a) => row(a, fmtSpeed(a.gs, settings.units))).join('');
}
for (const id of ['#st-high', '#st-fast']) {
  $(id).addEventListener('click', (e) => {
    const r = e.target.closest('[data-show]');
    if (r) select(r.dataset.show, { pan: true });
  });
}

// Tastatur
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  if (e.key === '/') {
    e.preventDefault();
    searchInput.focus();
  } else if (e.key === 'Escape') {
    if (!drawer.hidden) closeDrawer();
    else select(null);
  } else if (e.key === 'l' || e.key === 'L') {
    settings.labels = !settings.labels;
    syncLayerUi();
    persist();
  } else if (e.key === 't' || e.key === 'T') {
    settings.allTrails = !settings.allTrails;
    syncLayerUi();
    persist();
  } else if ((e.key === 'f' || e.key === 'F') && state.selected) {
    state.follow = !state.follow;
    panel.update(state);
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) pollArea();
});

// ---------- Start ----------

syncFilterUi();
syncLayerUi();
syncAlertUi();
renderWatch();
updateNight();
updateWeather();
updateZone();
setInterval(updateNight, 5 * 60_000);
setInterval(afterTick, 1000);

push.init().then(renderNotifState, () => {});
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type !== 'select' || !e.data.hex) return;
  pendingHex = e.data.hex;
  trySelectPending();
});

api.meta().then((m) => {
  state.demo = !!m.demo;
  document.body.classList.toggle('is-demo', state.demo);
}).catch(() => {});
pollArea();
pollMil();
setTimeout(pollWatch, 2000);
if (pendingHex) setTimeout(trySelectPending, 1500);
