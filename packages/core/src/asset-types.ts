export interface AssetTypeDef {
  readonly key: string;
  readonly en: string;
  readonly ar: string;
  readonly aliases: readonly string[];
}

export const ASSET_TYPES: readonly AssetTypeDef[] = [
  { key: "fire_pump", en: "Fire pump", ar: "مضخة الحريق", aliases: ["firepump", "jockey pump", "مضخة اطفاء"] },
  { key: "fire_alarm_panel", en: "Fire alarm panel", ar: "لوحة إنذار الحريق", aliases: ["fire alarm", "facp", "لوحة انذار"] },
  { key: "sprinkler_system", en: "Sprinkler system", ar: "نظام الرشاشات", aliases: ["sprinkler", "رشاشات"] },
  { key: "fire_extinguisher", en: "Fire extinguisher", ar: "طفاية الحريق", aliases: ["extinguisher", "طفاية"] },
  { key: "emergency_lighting", en: "Emergency lighting", ar: "إنارة الطوارئ", aliases: ["emergency light", "exit light", "انارة طوارئ"] },
  { key: "elevator", en: "Elevator", ar: "مصعد", aliases: ["lift", "مصاعد"] },
  { key: "escalator", en: "Escalator", ar: "سلم كهربائي", aliases: ["moving stairs", "سلالم متحركة"] },
  { key: "diesel_generator", en: "Diesel generator", ar: "مولد الديزل", aliases: ["generator", "genset", "مولد", "ديزل"] },
  { key: "lv_switchgear", en: "LV switchgear", ar: "لوحة توزيع الجهد المنخفض", aliases: ["low voltage switchgear", "lv panel"] },
  { key: "hv_switchgear", en: "HV switchgear", ar: "لوحة توزيع الجهد العالي", aliases: ["high voltage switchgear", "hv panel"] },
  { key: "distribution_board", en: "Distribution board", ar: "لوحة التوزيع", aliases: ["db", "sub main db", "smdb", "لوحة توزيع"] },
  { key: "ups", en: "UPS", ar: "مزود طاقة غير منقطع", aliases: ["uninterruptible power supply", "يو بي اس"] },
  { key: "chiller", en: "Chiller", ar: "مبرد", aliases: ["مبردات"] },
  { key: "ahu", en: "AHU", ar: "وحدة مناولة الهواء", aliases: ["air handling unit", "fahu", "مناولة هواء"] },
  { key: "cooling_tower", en: "Cooling tower", ar: "برج التبريد", aliases: ["برج تبريد"] },
  { key: "pressure_vessel", en: "Pressure vessel", ar: "وعاء الضغط", aliases: ["air receiver", "وعاء ضغط"] },
  { key: "lifting_equipment", en: "Lifting equipment", ar: "معدات الرفع", aliases: ["crane", "hoist", "رافعة"] },
  { key: "earthing_system", en: "Earthing system", ar: "نظام التأريض", aliases: ["grounding", "earth pit", "تأريض"] },
  { key: "lightning_protection", en: "Lightning protection", ar: "الحماية من الصواعق", aliases: ["lps", "مانعة صواعق"] },
];

const BY_KEY = new Map(ASSET_TYPES.map((t) => [t.key, t] as const));

export function isAssetTypeKey(key: string): boolean {
  return BY_KEY.has(key);
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[ً-ٰٟ]/g, "") // Arabic diacritics
    .replace(/[إأآا]/g, "ا")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase()
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((curr[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n] ?? 0;
}

export interface AssetTypeMatch {
  readonly key: string;
  readonly exact: boolean;
}

/**
 * Forgiving match for messy import data: exact on key/label/alias, else the
 * nearest label within a small edit distance. Returns null when nothing is
 * close enough, so the caller can report the row rather than silently drop it.
 */
export function matchAssetType(raw: string): AssetTypeMatch | null {
  const q = normalize(raw);
  if (q === "") return null;

  for (const t of ASSET_TYPES) {
    const candidates = [t.key, t.en, t.ar, ...t.aliases].map(normalize);
    if (candidates.includes(q)) return { key: t.key, exact: true };
  }

  let best: { key: string; dist: number } | null = null;
  for (const t of ASSET_TYPES) {
    for (const cand of [t.en, t.ar, ...t.aliases].map(normalize)) {
      const dist = levenshtein(q, cand);
      const threshold = Math.max(1, Math.floor(cand.length * 0.34));
      if (dist <= threshold && (best === null || dist < best.dist)) best = { key: t.key, dist };
    }
  }
  return best === null ? null : { key: best.key, exact: false };
}
