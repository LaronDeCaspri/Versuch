// Persistente Einstellungen im localStorage. Jeder Zugriff ist abgesichert,
// weil Speicher in privaten Fenstern fehlen oder blockiert sein kann.

const KEY = 'aerotrack:v1';

export function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Speicher nicht verfügbar – Einstellungen gelten dann nur für diese Sitzung.
  }
}
