// Loads the browser engine (lib.js + pro.js) into Node with a file-backed
// localStorage, so the server runs exactly the code the app runs.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const APP_DIR = path.resolve(here, "../mobile/standalone");

function fileStorage(file) {
    let data = {};
    try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { data = {}; }
    const flush = () => {
        const tmp = file + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(data));
        fs.renameSync(tmp, file);
    };
    return {
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); flush(); },
        removeItem: (k) => { delete data[k]; flush(); },
        clear: () => { data = {}; flush(); },
        key: (i) => Object.keys(data)[i] ?? null,
        get length() { return Object.keys(data).length; },
    };
}

export function loadEngine({ storageFile = null } = {}) {
    globalThis.window = globalThis;
    if (storageFile) {
        fs.mkdirSync(path.dirname(storageFile), { recursive: true });
        globalThis.localStorage = fileStorage(storageFile);
    } else if (!globalThis.localStorage) {
        const mem = {};
        globalThis.localStorage = {
            getItem: (k) => (k in mem ? mem[k] : null),
            setItem: (k, v) => { mem[k] = String(v); },
            removeItem: (k) => { delete mem[k]; },
        };
    }
    for (const f of ["lib.js", "pro.js"]) {
        vm.runInThisContext(fs.readFileSync(path.join(APP_DIR, f), "utf8"), { filename: f });
    }
    return globalThis.TB;
}

// Deterministic synthetic market (geometric random walk with optional drift)
export function syntheticCandles(n, { seed = 1, start = 30000, drift = 0, vol = 0.004, tfMs = 900e3, endTs = Date.now() } = {}) {
    let a = seed >>> 0;
    const rnd = () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
    const out = [];
    let p = start;
    const t0 = Math.floor(endTs / tfMs) * tfMs - n * tfMs;
    for (let i = 0; i < n; i++) {
        const open = p;
        const close = open * Math.exp(drift + vol * gauss());
        const high = Math.max(open, close) * (1 + Math.abs(vol * 0.6 * gauss()));
        const low = Math.min(open, close) * (1 - Math.abs(vol * 0.6 * gauss()));
        out.push({ ts: t0 + i * tfMs, open, high, low, close, volume: 100 + 50 * rnd() });
        p = close;
    }
    return out;
}
