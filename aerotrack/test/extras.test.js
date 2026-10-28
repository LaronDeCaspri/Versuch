import test from 'node:test';
import assert from 'node:assert/strict';
import { notable, topNotable, airlineOf } from '../public/js/notable.js';
import { normalizeMetar } from '../lib/metar.js';
import { searchAirports } from '../public/js/airportsearch.js';

test('Auffällige Flüge: Notfall vor Militär vor Normalflug', () => {
  const list = [
    { hex: 'a', cls: 'airliner', type: 'A320', sq: '1000', flags: 0, alt: 35000 },
    { hex: 'b', cls: 'mil', type: 'A400', sq: '1000', flags: 1, alt: 20000 },
    { hex: 'c', cls: 'airliner', type: 'A320', sq: '7700', flags: 0, alt: 9000 },
    { hex: 'd', cls: 'heavy', type: 'A388', flags: 0, alt: 39000 },
  ];
  const top = topNotable(list);
  assert.deepEqual(top.map((x) => x.ac.hex), ['c', 'b', 'd']);
  assert.ok(notable(list[1]).reasons.includes('Militär'));
  assert.equal(notable(list[0]).score, 0);
  assert.equal(airlineOf('DLH4KX'), 'DLH');
  assert.equal(airlineOf('DCGFA'), null);
});

test('METAR wird vereinheitlicht', () => {
  const m = normalizeMetar({ icaoId: 'EDDF', obsTime: 1700000000, temp: 12.3, dewp: 8, wdir: 240, wspd: 9, wgst: 19, visib: '10+', wxString: '-RA', clouds: [{ cover: 'BKN', base: 2500 }], fltCat: 'VFR', rawOb: 'EDDF ...' });
  assert.equal(m.icao, 'EDDF');
  assert.equal(m.time, 1700000000000);
  assert.equal(m.visSm, 10);
  assert.equal(m.visPlus, true);
  assert.equal(m.wgst, 19);
  assert.equal(normalizeMetar(null), null);
});

test('Flughafensuche: Code exakt, dann Name/Ort, große bevorzugt', () => {
  const aps = [
    { name: 'Frankfurt Hahn', iata: 'HHN', icao: 'EDFH', city: 'Lautzenhausen', size: 2, sched: true },
    { name: 'Frankfurt am Main', iata: 'FRA', icao: 'EDDF', city: 'Frankfurt', size: 3, sched: true },
    { name: 'Egelsbach', iata: null, icao: 'EDFE', city: 'Egelsbach', size: 1, sched: false },
  ];
  assert.equal(searchAirports(aps, 'fra')[0].iata, 'FRA');
  assert.equal(searchAirports(aps, 'eddf')[0].iata, 'FRA');
  assert.deepEqual(searchAirports(aps, 'frankfurt').map((a) => a.iata), ['FRA', 'HHN']);
  assert.equal(searchAirports(aps, 'x').length, 0);
});
