// Registrierungsland aus der ICAO-24-Bit-Adresse (Blockzuteilung nach ICAO Annex 10).
// Bewusst nur die größeren Blöcke; unbekannte Adressen liefern null.

const BLOCKS = [
  [0x008000, 0x00ffff, 'ZA', 'Südafrika'],
  [0x010000, 0x017fff, 'EG', 'Ägypten'],
  [0x06a000, 0x06a3ff, 'QA', 'Katar'],
  [0x0d0000, 0x0d7fff, 'MX', 'Mexiko'],
  [0x100000, 0x1fffff, 'RU', 'Russland'],
  [0x300000, 0x33ffff, 'IT', 'Italien'],
  [0x340000, 0x37ffff, 'ES', 'Spanien'],
  [0x380000, 0x3bffff, 'FR', 'Frankreich'],
  [0x3c0000, 0x3fffff, 'DE', 'Deutschland'],
  [0x400000, 0x43ffff, 'GB', 'Vereinigtes Königreich'],
  [0x440000, 0x447fff, 'AT', 'Österreich'],
  [0x448000, 0x44ffff, 'BE', 'Belgien'],
  [0x450000, 0x457fff, 'BG', 'Bulgarien'],
  [0x458000, 0x45ffff, 'DK', 'Dänemark'],
  [0x460000, 0x467fff, 'FI', 'Finnland'],
  [0x468000, 0x46ffff, 'GR', 'Griechenland'],
  [0x470000, 0x477fff, 'HU', 'Ungarn'],
  [0x478000, 0x47ffff, 'NO', 'Norwegen'],
  [0x480000, 0x487fff, 'NL', 'Niederlande'],
  [0x488000, 0x48ffff, 'PL', 'Polen'],
  [0x490000, 0x497fff, 'PT', 'Portugal'],
  [0x498000, 0x49ffff, 'CZ', 'Tschechien'],
  [0x4a0000, 0x4a7fff, 'RO', 'Rumänien'],
  [0x4a8000, 0x4affff, 'SE', 'Schweden'],
  [0x4b0000, 0x4b7fff, 'CH', 'Schweiz'],
  [0x4b8000, 0x4bffff, 'TR', 'Türkei'],
  [0x4ca000, 0x4cafff, 'IE', 'Irland'],
  [0x4cc000, 0x4ccfff, 'IS', 'Island'],
  [0x4d0000, 0x4d03ff, 'LU', 'Luxemburg'],
  [0x508000, 0x50ffff, 'UA', 'Ukraine'],
  [0x710000, 0x717fff, 'SA', 'Saudi-Arabien'],
  [0x718000, 0x71ffff, 'KR', 'Südkorea'],
  [0x730000, 0x737fff, 'IR', 'Iran'],
  [0x738000, 0x73ffff, 'IL', 'Israel'],
  [0x740000, 0x747fff, 'JO', 'Jordanien'],
  [0x750000, 0x757fff, 'MY', 'Malaysia'],
  [0x760000, 0x767fff, 'PK', 'Pakistan'],
  [0x768000, 0x76ffff, 'SG', 'Singapur'],
  [0x780000, 0x7bffff, 'CN', 'China'],
  [0x7c0000, 0x7fffff, 'AU', 'Australien'],
  [0x800000, 0x83ffff, 'IN', 'Indien'],
  [0x840000, 0x87ffff, 'JP', 'Japan'],
  [0x880000, 0x887fff, 'TH', 'Thailand'],
  [0x896000, 0x896fff, 'AE', 'Vereinigte Arabische Emirate'],
  [0x8a0000, 0x8a7fff, 'ID', 'Indonesien'],
  [0xa00000, 0xafffff, 'US', 'USA'],
  [0xc00000, 0xc3ffff, 'CA', 'Kanada'],
  [0xc80000, 0xc87fff, 'NZ', 'Neuseeland'],
  [0xe00000, 0xe3ffff, 'AR', 'Argentinien'],
  [0xe40000, 0xe7ffff, 'BR', 'Brasilien'],
];

const flag = (iso) => String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

export function countryOf(hex) {
  if (!hex || hex.startsWith('~')) return null;
  const n = parseInt(hex, 16);
  if (Number.isNaN(n)) return null;
  for (const [lo, hi, iso, name] of BLOCKS) {
    if (n >= lo && n <= hi) return { iso, name, flag: flag(iso) };
  }
  return null;
}
