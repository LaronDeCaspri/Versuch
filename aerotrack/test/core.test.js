import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../lib/adsb.js';
import { Simulator } from '../lib/sim.js';
import { classify, isAirlineCallsign } from '../public/js/classify.js';
import { countryOf } from '../public/js/country.js';
import { altColor, destination, distanceNm, nightPolygon } from '../public/js/geo.js';
import { Filters } from '../public/js/filters.js';
import { Alerts } from '../public/js/alerts.js';

test('distanceNm: Frankfurt–Berlin ca. 233 NM', () => {
  const d = distanceNm(50.033, 8.57, 52.362, 13.501);
  assert.ok(d > 225 && d < 240, String(d));
});

test('destination ist Umkehrung von distanceNm', () => {
  const [lat, lon] = destination(50, 8, 73, 100);
  assert.ok(Math.abs(distanceNm(50, 8, lat, lon) - 100) < 0.01);
});

test('altColor interpoliert und behandelt Boden', () => {
  assert.equal(altColor(0, true), 'rgb(148,163,184)');
  assert.equal(altColor(0), 'rgb(249,115,22)');
  assert.equal(altColor(99999), 'rgb(236,72,153)');
});

test('normalize: readsb-Objekt → kompaktes Format', () => {
  const a = normalize({ hex: '3C6444', flight: 'DLH400  ', r: 'D-AIMA', t: 'A388', lat: 50, lon: 8, alt_baro: 'ground', gs: 12, track: 90, dbFlags: 1, squawk: '1000' });
  assert.equal(a.hex, '3c6444');
  assert.equal(a.cs, 'DLH400');
  assert.equal(a.gnd, true);
  assert.equal(a.alt, 0);
  assert.equal(a.flags, 1);
  assert.equal(normalize({ hex: 'abc123' }), null, 'ohne Position verworfen');
});

test('classify', () => {
  assert.equal(classify({ flags: 1, type: 'A388' }), 'mil');
  assert.equal(classify({ type: 'GLF6', cat: 'A2' }), 'bizjet');
  assert.equal(classify({ type: 'XXXX', cat: 'A2', cs: 'DCGFA' }), 'bizjet');
  assert.equal(classify({ type: 'A320', cat: 'A3', cs: 'DLH4KX' }), 'airliner');
  assert.equal(classify({ type: 'A359' }), 'heavy');
  assert.equal(classify({ type: 'EC35' }), 'heli');
  assert.equal(classify({ cat: 'A1' }), 'light');
  assert.equal(classify({ cat: 'C1' }), 'ground');
  assert.ok(isAirlineCallsign('RYR12AB'));
  assert.ok(!isAirlineCallsign('N123AB'));
});

test('countryOf', () => {
  assert.equal(countryOf('3c6444').iso, 'DE');
  assert.equal(countryOf('a12345').iso, 'US');
  assert.equal(countryOf('~123456'), null);
});

test('nightPolygon liefert geschlossenen Ring', () => {
  const p = nightPolygon(new Date('2026-06-21T12:00:00Z'));
  assert.equal(p[0][0], -90, 'Juni: Südpol im Dunkeln');
  assert.ok(p.every(([lat]) => lat >= -90 && lat <= 90));
});

test('Filters', () => {
  const f = new Filters();
  const ac = { cls: 'bizjet', alt: 41000, gs: 450, hex: 'abc', type: 'GLF6' };
  assert.ok(f.match(ac));
  f.set({ classes: ['airliner'] });
  assert.ok(!f.match(ac));
  f.reset();
  f.set({ text: 'glf' });
  assert.ok(f.match(ac));
  f.set({ text: '', altMax: 30000 });
  assert.ok(!f.match(ac));
});

test('Alerts: Watchlist, Zone, Squawk mit Abklingzeit', () => {
  const events = [];
  const a = new Alerts({}, { notify: (e) => events.push(e) });
  assert.ok(a.addWatch('reg', 'd-aima'));
  assert.ok(!a.addWatch('reg', 'D-AIMA'), 'keine Duplikate');
  a.zone = { enabled: true, lat: 50, lon: 8, km: 20, cls: 'mil' };
  const plane = { hex: 'x1', reg: 'D-AIMA', cls: 'mil', lat: 50.05, lon: 8.05, sq: '7700' };
  a.check([plane]);
  a.check([plane]);
  assert.equal(events.length, 3, events.map((e) => e.title).join(' | '));
});

test('Simulator liefert gültige Daten', () => {
  const s = new Simulator();
  const area = s.area(50.5, 9, 250);
  assert.ok(area.ac.length > 50);
  for (const a of area.ac) assert.ok(Number.isFinite(a.lat) && Number.isFinite(a.lon) && a.hex);
  assert.ok(s.military().ac.every((a) => a.flags & 1));
});

test('countryAt: Land unter einer Position', async () => {
  const { countryAt } = await import('../public/js/overfly.js');
  const { feature } = await import('topojson-client');
  const { default: topo } = await import('world-atlas/countries-50m.json', { with: { type: 'json' } });
  const world = feature(topo, topo.objects.countries);
  assert.equal(countryAt(50.1, 8.7, world), 'Germany');
  assert.equal(countryAt(48.86, 2.35, world), 'France');
  assert.equal(countryAt(54.5, 3.0, world), 'Über dem Meer');
  assert.equal(countryAt(50, 8, null), null);
});
