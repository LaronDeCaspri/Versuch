import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeState } from '../lib/opensky.js';
import { parseCsv, toAirports } from '../lib/airports.js';
import { greatCircle, distanceNm } from '../public/js/geo.js';
import { classify, GROUPS, CLASSES } from '../public/js/classify.js';
import { Filters } from '../public/js/filters.js';
import { Store } from '../public/js/store.js';

test('OpenSky-Zustandsvektor wird umgerechnet', () => {
  const a = normalizeState(['3c6444', 'DLH400  ', 'Germany', 1000, 1001, 8.5, 50.0, 10000, false, 250, 90, 5, null, 10100, '1000', false, 0, 6], 1010);
  assert.equal(a.hex, '3c6444');
  assert.equal(a.cs, 'DLH400');
  assert.equal(a.alt, 32808);
  assert.equal(a.gs, 486);
  assert.equal(a.vr, 984);
  assert.equal(a.cat, 'A5');
  assert.equal(a.seen, 10);
  assert.equal(a.world, true);
  assert.equal(normalizeState(['abc', null, '', 0, 0, null, null], 0), null);
});

test('CSV-Parser und Flugplatzliste', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi"""\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  const csv = 'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,iso_country,municipality,scheduled_service,gps_code,iata_code\n' +
    '1,EDDF,large_airport,Frankfurt,50.03,8.57,364,DE,Frankfurt,yes,EDDF,FRA\n' +
    '2,EDFE,small_airport,Egelsbach,49.96,8.64,384,DE,Egelsbach,no,EDFE,\n' +
    '3,XXXX,closed,Alt,1,1,,DE,,no,,\n';
  const list = toAirports(csv);
  assert.equal(list.length, 2);
  assert.equal(list[0].iata, 'FRA');
  assert.equal(list[0].size, 3);
  assert.equal(list[1].iata, null);
});

test('Großkreis: Endpunkte stimmen, Datumsgrenze ohne Sprung', () => {
  const pts = greatCircle(50.03, 8.57, 40.64, -73.78, 32);
  assert.ok(distanceNm(...pts[0], 50.03, 8.57) < 0.1);
  assert.ok(distanceNm(...pts.at(-1), 40.64, -73.78) < 0.1);
  const pac = greatCircle(35.55, 139.78, 37.62, -122.38, 32); // Tokio → San Francisco
  for (let i = 1; i < pac.length; i++) assert.ok(Math.abs(pac[i][1] - pac[i - 1][1]) < 20);
});

test('Drohnen und Gruppen', () => {
  assert.equal(classify({ cat: 'B6' }), 'drone');
  assert.equal(classify({ type: 'Q9', flags: 1 }), 'drone');
  const all = GROUPS.flatMap((g) => g.classes).sort();
  assert.deepEqual(all, Object.keys(CLASSES).sort(), 'jede Klasse genau einer Gruppe zugeordnet');
});

test('Gespeicherte Filter ohne neue Klasse schalten Drohnen ein', () => {
  const f = new Filters({ classes: ['mil', 'airliner'] });
  assert.ok(f.classes.includes('drone'));
  const g = new Filters({ classes: ['mil'], known: Object.keys(CLASSES) });
  assert.ok(!g.classes.includes('drone'), 'bewusst abgewählt bleibt aus');
});

test('Weltübersicht überschreibt Typ und Militär-Flag nicht', () => {
  const s = new Store();
  s.ingest([{ hex: 'a1', lat: 50, lon: 8, type: 'A400', reg: '54+01', flags: 1, seen: 5 }]);
  s.ingest([{ hex: 'a1', lat: 50.1, lon: 8, type: null, reg: null, flags: 0, seen: 0, world: true }]);
  const ac = s.get('a1');
  assert.equal(ac.type, 'A400');
  assert.equal(ac.flags & 1, 1);
  assert.equal(ac.cls, 'mil');
});
