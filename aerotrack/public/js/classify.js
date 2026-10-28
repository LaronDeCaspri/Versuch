// Einordnung von Luftfahrzeugen in Klassen anhand von dbFlags, ADS-B-Emitterkategorie
// und ICAO-Typcode. Kein DOM, damit testbar.

const BIZJET = new Set([
  'GLF2', 'GLF3', 'GLF4', 'GLF5', 'GLF6', 'GLEX', 'GL5T', 'GL6T', 'GL7T', 'GL8T', 'G150', 'G280', 'GALX', 'ASTR',
  'CL30', 'CL35', 'CL60', 'C25A', 'C25B', 'C25C', 'C25M', 'C500', 'C501', 'C510', 'C525', 'C550', 'C55B', 'C560',
  'C56X', 'C650', 'C680', 'C68A', 'C700', 'C750', 'E50P', 'E55P', 'E545', 'E550', 'E35L', 'FA10', 'FA20', 'FA50',
  'FA6X', 'FA7X', 'FA8X', 'F2TH', 'F900', 'LJ31', 'LJ35', 'LJ40', 'LJ45', 'LJ60', 'LJ70', 'LJ75', 'H25A', 'H25B',
  'H25C', 'HA4T', 'BE40', 'PRM1', 'PC24', 'SF50', 'EA50', 'HDJT', 'WW24',
]);

const HELI = new Set([
  'EC20', 'EC25', 'EC30', 'EC35', 'EC45', 'EC55', 'EC75', 'H145', 'H160', 'H175', 'AS50', 'AS55', 'AS65', 'AS32',
  'A109', 'A119', 'A139', 'A169', 'A189', 'B06', 'B407', 'B412', 'B429', 'B505', 'R22', 'R44', 'R66', 'S76', 'S92',
  'H60', 'H47', 'H64', 'UH1', 'NH90', 'TIGR', 'MI8', 'BK17', 'EH10', 'H53', 'V22',
]);

// Unbemannte Luftfahrzeuge mit Transponder (meist militärisch). Kleine Drohnen senden kein ADS-B.
const DRONE = new Set(['Q1', 'Q4', 'Q9', 'Q25', 'GLHK', 'RQ4', 'MQ4C', 'MQ9', 'HRON', 'HERN', 'TB2', 'TRIT']);

const HEAVY = new Set([
  'A306', 'A30B', 'A310', 'A332', 'A333', 'A338', 'A339', 'A342', 'A343', 'A345', 'A346', 'A359', 'A35K', 'A388',
  'B741', 'B742', 'B743', 'B744', 'B748', 'B74S', 'B762', 'B763', 'B764', 'B772', 'B773', 'B77L', 'B77W', 'B778',
  'B779', 'B788', 'B789', 'B78X', 'MD11', 'DC10', 'IL76', 'A124', 'C17', 'C5M',
]);

export const CLASSES = {
  airliner: { label: 'Linienflug', color: '#38bdf8', shape: 'jet', size: 1 },
  heavy: { label: 'Großraum', color: '#818cf8', shape: 'jet', size: 1.3 },
  bizjet: { label: 'Business-Jet', color: '#f472b6', shape: 'bizjet', size: 0.9 },
  light: { label: 'Kleinflugzeug', color: '#a3e635', shape: 'prop', size: 0.75 },
  heli: { label: 'Hubschrauber', color: '#fb923c', shape: 'heli', size: 0.85 },
  mil: { label: 'Militär', color: '#ef4444', shape: 'delta', size: 1.05 },
  drone: { label: 'Drohne (UAV)', color: '#facc15', shape: 'drone', size: 1 },
  glider: { label: 'Segelflug', color: '#e2e8f0', shape: 'glider', size: 0.8 },
  ground: { label: 'Flughafenfahrzeug', color: '#94a3b8', shape: 'ground', size: 0.8 },
  other: { label: 'Sonstige', color: '#cbd5e1', shape: 'jet', size: 0.85 },
};

export const isAirlineCallsign = (cs) => /^[A-Z]{3}\d[0-9A-Z]{0,4}$/.test(cs || '');

export function classify(ac) {
  const t = ac.type || '';
  const cat = ac.cat || '';
  if (cat === 'B6' || DRONE.has(t)) return 'drone';
  if (ac.flags & 1) return 'mil';
  if (cat === 'A7' || HELI.has(t)) return 'heli';
  if (cat.startsWith('C')) return 'ground';
  if (cat === 'B1') return 'glider';
  if (BIZJET.has(t)) return 'bizjet';
  if (HEAVY.has(t) || cat === 'A5') return 'heavy';
  if (cat === 'A1' || cat === 'B4') return 'light';
  if (cat === 'A2' && ac.cs && !isAirlineCallsign(ac.cs)) return 'bizjet';
  if (cat === 'A2' || cat === 'A3' || cat === 'A4') return 'airliner';
  if (isAirlineCallsign(ac.cs)) return 'airliner';
  return 'other';
}

export const isEmergencySquawk = (sq) => sq === '7500' || sq === '7600' || sq === '7700';

export const SQUAWK_TEXT = {
  7500: 'Entführung (7500)',
  7600: 'Funkausfall (7600)',
  7700: 'Luftnotfall (7700)',
};

// Bitfelder von dbFlags (readsb / adsb.lol)
export const FLAG = { MIL: 1, INTERESTING: 2, PIA: 4, LADD: 8 };

// Gruppen für die Schnellfilter-Leiste (eine Gruppe kann mehrere Klassen umfassen).
export const GROUPS = [
  { key: 'pax', label: 'Passagier', classes: ['airliner', 'heavy'], color: '#38bdf8' },
  { key: 'bizjet', label: 'Business-Jet', classes: ['bizjet'], color: '#f472b6' },
  { key: 'light', label: 'Kleinflugzeug', classes: ['light', 'glider'], color: '#a3e635' },
  { key: 'heli', label: 'Hubschrauber', classes: ['heli'], color: '#fb923c' },
  { key: 'mil', label: 'Militär', classes: ['mil'], color: '#ef4444' },
  { key: 'drone', label: 'Drohne', classes: ['drone'], color: '#facc15' },
  { key: 'ground', label: 'Flughafenfahrzeug', classes: ['ground'], color: '#94a3b8' },
  { key: 'other', label: 'Sonstige', classes: ['other'], color: '#cbd5e1' },
];
