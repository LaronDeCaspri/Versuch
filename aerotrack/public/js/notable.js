// „Auffällige Flüge“: bewertet Luftfahrzeuge nach Merkmalen, die man sich ansehen möchte.
// Ersatz für „Most tracked“ bei Flightradar24 (dessen Zuschauerzahlen gibt es nicht frei).

import { FLAG, isEmergencySquawk, SQUAWK_TEXT } from './classify.js';

// Seltene oder besondere Muster (ICAO-Typcodes)
const RARE = {
  A388: 'Airbus A380', B748: 'Boeing 747-8', B744: 'Boeing 747-400', A124: 'Antonov An-124', A225: 'Antonov An-225',
  BLCF: 'Boeing Dreamlifter', A3ST: 'Airbus Beluga', A337: 'Airbus BelugaXL', C5M: 'C-5 Galaxy', C17: 'C-17 Globemaster',
  A400: 'Airbus A400M', E3TF: 'AWACS', E3CF: 'AWACS', K35R: 'KC-135 Tanker', A332: null, CONC: 'Concorde', IL76: 'Iljuschin Il-76',
};
const STATE_OP = /government|air force|luftwaffe|bundeswehr|navy|army|ministry|royal|state of|presiden|regierung|flugbereitschaft/i;

export function notable(ac) {
  const reasons = [];
  let score = 0;
  const add = (pts, text) => {
    score += pts;
    reasons.push(text);
  };
  if (isEmergencySquawk(ac.sq) || ac.em) add(100, SQUAWK_TEXT[ac.sq] || 'Notfall');
  if (ac.cls === 'drone') add(60, 'Drohne');
  if (ac.flags & FLAG.MIL) add(40, 'Militär');
  if (ac.op && STATE_OP.test(ac.op)) add(30, 'Staatlich');
  if (ac.flags & FLAG.INTERESTING) add(30, 'Besonderes Luftfahrzeug');
  if (RARE[ac.type]) add(25, RARE[ac.type]);
  if (ac.cls === 'bizjet' && ac.flags & (FLAG.LADD | FLAG.PIA)) add(15, 'Privatjet (anonymisiert)');
  if (!ac.gnd && ac.alt >= 45000) add(10, 'Sehr hoch');
  return { score, reasons };
}

export function topNotable(list, n = 15) {
  return list
    .map((ac) => ({ ac, ...notable(ac) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.ac.alt ?? 0) - (a.ac.alt ?? 0))
    .slice(0, n);
}

// Airline-Präfix aus dem Rufzeichen (DLH123 → DLH)
export const airlineOf = (cs) => (/^[A-Z]{3}\d/.test(cs || '') ? cs.slice(0, 3) : null);
