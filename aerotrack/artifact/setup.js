// Läuft vor main.js: stellt die Länderumrisse für die Vektorkarte bereit.

import { feature } from 'topojson-client';
import world from 'world-atlas/countries-50m.json';

globalThis.AEROTRACK_STATIC = { world: feature(world, world.objects.countries) };
