// Einstiegspunkt: verbindet Karte, Datenabfragen, Ebenen und Bedienoberfläche.

import { api } from './api.js';
import { Alerts, WATCH_KINDS } from './alerts.js';
import { CLASSES, GROUPS } from './classify.js';
import { Filters } from './filters.js';
import { distanceNm, escapeHtml, fmtAlt, fmtSpeed, nightPolygon } from './geo.js';
import { AircraftLayer } from './layer.js';
import { Panel } from './panel.js';
import * as prefs from './prefs.js';
import { PushClient } from './push.js';
import { labelPoint } from './overfly.js';
import { Store } from './store.js';

const AREA_INTERVAL = 3000;
const MIL_INTERVAL = 10000;
const WATCH_INTERVAL = 20000;
const MAX_RADIUS_NM = 250;
const WORLD_INTERVAL = 20000;

const $ = (sel) => document.querySelector(sel);
const saved = prefs.load();

const settings = {
  basemap: 'dark',
  labels: false,
  allTrails: false,
  night: true,
  weather: false,
  milGlobal: false,
  airports: true,
  world: true,
  rings: true,
  colorMode: 'alt',
  units: 'aviation',
  ...saved.settings,
};

const state = { selected: null, follow: false, demo: false, lastOk: 0, error: null, capped: false, world: null, worldPolled: 0 };
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

// Kartenstile ohne API-Schlüssel. labels = separate Beschriftungsebene darüber.
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const BASEMAPS = {
  dark: {
    label: 'Dunkel',
    url: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    attr: 'Karte © Esri, HERE, Garmin, © OpenStreetMap-Mitwirkende',
    maxNative: 16,
  },
  light: {
    label: 'Hell',
    url: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    attr: 'Karte © Esri, HERE, Garmin, © OpenStreetMap-Mitwirkende',
    maxNative: 16,
  },
  satellite: {
    label: 'Satellit',
    url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
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
// Eigene Ebenen: Länderumrisse liegen UNTER den Kacheln (Ersatz, falls ein Kartendienst
// ausfällt), Beschriftungs-Kacheln ÜBER den Kartenkacheln, aber unter den Flugzeugen.
map.createPane('world').style.zIndex = 150;
map.createPane('labels').style.zIndex = 350;
map.getPane('labels').style.pointerEvents = 'none';

// Eigenständige Variante (ohne Kachelserver): Länderumrisse als Vektorkarte.
const STATIC = globalThis.AEROTRACK_STATIC || null;
if (STATIC) document.body.classList.add('is-static');

// Ländernamen; kleine Länder erst bei stärkerem Zoom, damit nichts überlappt.
function addWorld(world) {
  return L.geoJSON(world, {
    pane: 'world',
    style: { color: '#4a6290', weight: 1.1, fillColor: '#13203d', fillOpacity: 1 },
    interactive: false,
    attribution: 'Grenzen: Natural Earth',
  }).addTo(map);
}

function addCountryLabels(world, pane) {
  const labels = world.features
    .map((f) => ({ name: f.properties?.name, pt: labelPoint(f) }))
    .filter((l) => l.name && l.pt)
    .map(({ name, pt }) => ({
      minZoom: pt[2] > 60 ? 3 : pt[2] > 8 ? 5 : 7,
      marker: L.marker([pt[0], pt[1]], {
        interactive: false,
        keyboard: false,
        pane,
        icon: L.divIcon({ className: 'country-label', html: `<span>${escapeHtml(name)}</span>`, iconSize: null }),
      }),
    }));
  const sync = () => {
    const z = map.getZoom();
    for (const l of labels) {
      const show = z >= l.minZoom;
      if (show && !map.hasLayer(l.marker)) l.marker.addTo(map);
      else if (!show && map.hasLayer(l.marker)) map.removeLayer(l.marker);
    }
  };
  map.on('zoomend', sync);
  sync();
}

function setBasemap(key) {
  if (STATIC) {
    if (!baseLayer) {
      baseLayer = addWorld(STATIC.world);
      addCountryLabels(STATIC.world, 'markerPane');
    }
    settings.basemap = 'dark';
    return;
  }
  settings.basemap = BASEMAPS[key] ? key : 'dark';
  const b = BASEMAPS[settings.basemap];
  if (baseLayer) map.removeLayer(baseLayer);
  const opts = { maxZoom: 19, maxNativeZoom: b.maxNative || 19 };
  baseLayer = L.layerGroup([L.tileLayer(b.url, { ...opts, attribution: b.attr })]);
  if (b.labels) baseLayer.addLayer(L.tileLayer(b.labels, { ...opts, pane: 'labels' }));
  baseLayer.addTo(map);
  document.body.dataset.basemap = settings.basemap;
}
setBasemap(settings.basemap);

// Live-Variante: Länderdaten nachladen (Ersatzkarte und Anzeige des überflogenen Landes).
async function loadWorld() {
  if (STATIC) return;
  try {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/topojson/topojson-client.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.append(s);
    });
    const topo = await fetch('/vendor/world/countries-50m.json').then((r) => r.json());
    const world = topojson.feature(topo, topo.objects.countries);
    globalThis.AEROTRACK_WORLD = world;
    addWorld(world);
    addCountryLabels(world, 'world');
    panel.update(state);
  } catch {
    // ohne Länderdaten fehlt nur die Ersatzkarte und die Zeile „Überfliegt“
  }
}

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

// ---------- Flugplätze ----------

const airportLayer = L.layerGroup();
const AP_STYLE = {
  3: { radius: 6, color: '#e2e8f0', weight: 2, fillColor: '#0b1222', fillOpacity: 1 },
  2: { radius: 4.5, color: '#94a3b8', weight: 1.5, fillColor: '#0b1222', fillOpacity: 1 },
  1: { radius: 3, color: '#64748b', weight: 1, fillColor: '#0b1222', fillOpacity: 1 },
  0: { radius: 2.5, color: '#64748b', weight: 1, fillColor: '#334155', fillOpacity: 1 },
};
const AP_TYPE = { 3: 'Großflughafen', 2: 'Regionalflughafen', 1: 'Flugplatz', 0: 'Hubschrauberlandeplatz' };
let airportSeq = 0;

function airportPopup(a) {
  let ground = 0;
  let vehicles = 0;
  for (const ac of store.values()) {
    if (!ac.gnd || distanceNm(a.lat, a.lon, ac.lat, ac.lon) > 2) continue;
    if (ac.cls === 'ground') vehicles++;
    else ground++;
  }
  const codes = [a.iata, a.icao].filter(Boolean).join(' · ');
  return `<div class="ap-pop"><b>${escapeHtml(a.name)}</b>
    <span>${escapeHtml(codes)}</span>
    <span>${escapeHtml([a.city, a.country].filter(Boolean).join(', '))}</span>
    <span>${AP_TYPE[a.size]}${a.elev != null ? ` · ${fmtAlt(a.elev, settings.units)} Höhe` : ''}</span>
    <span>Am Boden: ${ground} Luftfahrzeug(e), ${vehicles} Fahrzeug(e)</span></div>`;
}

async function loadAirports() {
  if (!settings.airports) {
    airportLayer.clearLayers();
    map.removeLayer(airportLayer);
    return;
  }
  const seq = ++airportSeq;
  try {
    const { airports } = await api.airports(boundsQuery(), map.getZoom());
    if (seq !== airportSeq) return;
    airportLayer.clearLayers();
    const z = map.getZoom();
    for (const a of airports) {
      const m = L.circleMarker([a.lat, a.lon], { ...AP_STYLE[a.size], bubblingMouseEvents: false });
      m.on('click', (e) => {
        // Steht ein Flugzeug auf dem Platz, hat es beim Klick Vorrang
        const ac = layer.hitTest(e.containerPoint.x, e.containerPoint.y, 14);
        if (ac) return select(ac.hex);
        L.popup({ className: 'ap-popup' }).setLatLng([a.lat, a.lon]).setContent(airportPopup(a)).openOn(map);
      });
      const code = a.iata || a.icao;
      if (code && (a.size === 3 ? z >= 6 : a.size === 2 ? z >= 8 : z >= 11)) {
        m.bindTooltip(code, { permanent: true, direction: 'right', className: 'ap-label', offset: [6, 0] });
      }
      airportLayer.addLayer(m);
    }
    airportLayer.addTo(map);
  } catch {
    // Flugplätze sind optional
  }
}

// ---------- Kernkomponenten ----------

const layer = new AircraftLayer(map, store, {
  filters,
  settings,
  selected: () => state.selected,
  follow: () => state.follow,
  offsetY: () => viewOffsetY(),
  route: (hex) => panel.routeFor(hex),
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
    if (pan && ac) centerOn([ac.lat, ac.lon], Math.max(map.getZoom(), 8));
    else if (ac && viewOffsetY()) centerOn([ac.pos?.lat ?? ac.lat, ac.pos?.lon ?? ac.lon], map.getZoom());
  }
  updateHash();
}

// Auf dem Handy liegt das Panel unten über der Karte. Der sichtbare Kartenbereich ist dann
// der Streifen zwischen Schnellfilter-Leiste und Panel; dessen Mitte ist der Zielpunkt.
function viewOffsetY() {
  if (innerWidth > 760 || $('#panel').hidden) return 0;
  const top = $('#quickbar').getBoundingClientRect().bottom;
  const bottom = $('#panel').getBoundingClientRect().top;
  if (bottom <= top) return 0;
  return (top + bottom) / 2 - map.getSize().y / 2;
}

function centerOn(latlng, zoom) {
  const p = map.project(latlng, zoom).subtract([0, viewOffsetY()]);
  map.setView(map.unproject(p, zoom), zoom);
}

function panelAction(act, hex) {
  const ac = store.get(hex);
  if (!ac) return;
  if (act === 'follow') {
    state.follow = !state.follow;
    panel.update(state);
  } else if (act === 'zoom') {
    centerOn([ac.pos?.lat ?? ac.lat, ac.pos?.lon ?? ac.lon], 11);
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
    if (state.capped && settings.world && Date.now() - state.worldPolled > WORLD_INTERVAL) pollWorld();
    state.lastOk = Date.now();
    state.error = null;
    alerts.check(data.ac.map((a) => store.get(a.hex)).filter(Boolean));
    if (fresh.length && state.selected == null && pendingHex) trySelectPending();
  } catch (err) {
    state.error = err.message;
  } finally {
    areaBusy = false;
    const keep = new Set([state.selected, ...watchHits].filter(Boolean));
    store.prune(keep, 60_000, (state.world?.interval || 900_000) + 180_000);
    afterTick();
    areaTimer = setTimeout(pollArea, AREA_INTERVAL);
  }
}

// Weltübersicht: nur wenn der Kartenausschnitt größer ist als eine Bereichsabfrage.
function boundsQuery() {
  const b = map.getBounds();
  const r = (v) => Math.round(v * 100) / 100;
  return { s: r(Math.max(-90, b.getSouth())), n: r(Math.min(90, b.getNorth())), w: r(b.getWest()), e: r(b.getEast()) };
}

async function pollWorld() {
  state.worldPolled = Date.now();
  try {
    const data = await api.world(boundsQuery());
    store.ingest(data.ac);
    state.world = data;
    afterTick();
  } catch (err) {
    state.world = { error: err.message, ac: [] };
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
  loadAirports();
  if (state.capped && settings.world && Date.now() - state.worldPolled > 3000) pollWorld();
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
  renderCoverage();
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

function renderCoverage() {
  const el = $('#coverage');
  el.hidden = !state.capped;
  if (!state.capped) return;
  const w = state.world;
  el.classList.toggle('warn', !settings.world || !w?.asOf);
  if (!settings.world) {
    el.textContent = 'Live nur 460 km um die Kartenmitte · Weltübersicht aus';
  } else if (w?.asOf) {
    const min = Math.max(0, Math.round((Date.now() - w.asOf) / 60000));
    el.textContent = `Weltübersicht (${w.source}) · Stand ${min ? `vor ${min} min` : 'gerade eben'} · live nur 460 km um die Mitte`;
    el.title = w.error || 'Hineinzoomen für Live-Daten im Sekundentakt';
  } else {
    el.textContent = w?.error ? `Weltübersicht nicht verfügbar: ${w.error}` : 'Weltübersicht wird geladen …';
  }
}

function updateHash() {
  const c = map.getCenter();
  const h = `#${map.getZoom()}/${c.lat.toFixed(4)}/${c.lng.toFixed(4)}${state.selected ? `/${state.selected}` : ''}`;
  if (location.hash === h) return;
  try {
    history.replaceState(null, '', h);
  } catch {
    // eingebettete Ansichten können den Verlauf sperren
  }
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

// ---------- Schnellfilter ----------
// Klick schaltet eine Gruppe an/aus, Doppelklick (oder langes Drücken) zeigt NUR diese Gruppe.

const quickbar = $('#quickbar');
quickbar.innerHTML =
  `<button class="qchip all" data-q="all">Alle</button>` +
  GROUPS.map((g) => `<button class="qchip" data-q="${g.key}" title="Klick: an/aus · Doppelklick: nur diese"><i style="background:${g.color}"></i>${g.label}</button>`).join('') +
  `<span class="qsep"></span>
   <button class="qchip layer" data-q="ground-on" title="Rollende und geparkte Luftfahrzeuge">Am Boden</button>
   <button class="qchip layer" data-q="airports" title="Flugplätze anzeigen">Flugplätze</button>`;

function groupOn(g) {
  return g.classes.every((c) => filters.classes.includes(c));
}

function syncQuickbar() {
  for (const b of quickbar.querySelectorAll('[data-q]')) {
    const g = GROUPS.find((x) => x.key === b.dataset.q);
    let on;
    if (g) on = groupOn(g);
    else if (b.dataset.q === 'all') on = GROUPS.every(groupOn);
    else if (b.dataset.q === 'ground-on') on = !filters.hideGround;
    else if (b.dataset.q === 'airports') on = settings.airports;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
  }
}

function setClasses(classes) {
  filters.set({ classes });
  syncFilterUi();
  syncQuickbar();
  afterTick();
  persist();
}

function quickAction(key, solo) {
  const g = GROUPS.find((x) => x.key === key);
  if (g) {
    if (solo) return setClasses([...g.classes]);
    const on = groupOn(g);
    const set = new Set(filters.classes);
    for (const c of g.classes) on ? set.delete(c) : set.add(c);
    return setClasses([...set]);
  }
  if (key === 'all') return setClasses(Object.keys(CLASSES));
  if (key === 'ground-on') {
    filters.set({ hideGround: !filters.hideGround });
    syncFilterUi();
  } else if (key === 'airports') {
    settings.airports = !settings.airports;
    syncLayerUi();
    loadAirports();
  }
  syncQuickbar();
  afterTick();
  persist();
}

let clickTimer = null;
let pressTimer = null;
let longPressed = false;
quickbar.addEventListener('click', (e) => {
  const b = e.target.closest('[data-q]');
  if (!b || longPressed) return;
  // kurz warten, ob ein Doppelklick folgt
  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => quickAction(b.dataset.q, false), 220);
});
quickbar.addEventListener('dblclick', (e) => {
  const b = e.target.closest('[data-q]');
  if (!b) return;
  clearTimeout(clickTimer);
  quickAction(b.dataset.q, true);
});
quickbar.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('[data-q]');
  longPressed = false;
  if (!b || e.pointerType === 'mouse') return;
  pressTimer = setTimeout(() => {
    longPressed = true;
    quickAction(b.dataset.q, true);
  }, 550);
});
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) quickbar.addEventListener(ev, () => clearTimeout(pressTimer));

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
  syncQuickbar();
  afterTick();
  persist();
}

$('[data-pane="filters"]').addEventListener('input', onFilterChange);
$('#filter-reset').addEventListener('click', () => {
  filters.reset();
  syncFilterUi();
  syncQuickbar();
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
  $('#opt-airports').checked = settings.airports;
  $('#opt-world').checked = settings.world;
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
  'opt-airports': ['airports', () => (loadAirports(), syncQuickbar())],
  'opt-world': ['world', () => (settings.world ? pollWorld() : renderCoverage())],
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
syncQuickbar();
loadAirports();
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
loadWorld();
pollArea();
pollMil();
setTimeout(pollWatch, 2000);
if (pendingHex) setTimeout(trySelectPending, 1500);
