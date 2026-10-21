// 24/7 paper-trading server. Runs the exact engine the app runs (lib.js + pro.js),
// serves the app, and exposes a read-only status API. It never places real orders:
// it holds no exchange credentials and every write call to an exchange is blocked.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEngine, APP_DIR, syntheticCandles } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const STATE_DIR = path.resolve(env.TB_STATE_DIR || path.join(here, "state"));
const PORT = Number(env.PORT || 8787);
const HOST = env.TB_HOST || "127.0.0.1";
const SYMBOLS = (env.TB_SYMBOLS || "BTC/USDT,ETH/USDT,SOL/USDT,BNB/USDT").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const INTERVAL = "15m";
const MOCK = env.TB_MOCK === "1";
const STRICT = env.TB_STRICT === "1";
const RESEARCH_DAYS = Number(env.TB_RESEARCH_DAYS || 180);
const SCAN_MS = 30e3;
const MAX_POSITIONS = 6;
const MAX_NOTIONAL_PCT = 12;
const BASE_RISK_PCT = 0.5;
const INCUBATION = 0.25;
const DAILY_LOSS_LIMIT_PCT = 3;

// ---- demo-only: refuse to run next to exchange credentials -------------------
const credVars = Object.keys(env).filter((k) => /(BINANCE|BYBIT|KRAKEN|COINBASE|OKX|KUCOIN|BITGET|EXCHANGE).*(KEY|SECRET|PASSPHRASE)/i.test(k));
if (credVars.length) {
    console.error(`[demo] Abbruch: Börsen-Zugangsdaten in der Umgebung gefunden (${credVars.join(", ")}). Dieser Server handelt ausschließlich auf Papier und startet nicht neben echten Schlüsseln.`);
    process.exit(2);
}

fs.mkdirSync(STATE_DIR, { recursive: true });
const EVENTS = path.join(STATE_DIR, "events.log");
const log = (kind, msg, extra = {}) => {
    const line = JSON.stringify({ t: new Date().toISOString(), kind, msg, ...extra });
    console.log(line);
    try { fs.appendFileSync(EVENTS, line + "\n"); } catch (e) { /* disk full: keep running */ }
};

if (MOCK) installMockExchange();
const TB = loadEngine({ storageFile: path.join(STATE_DIR, "storage.json") });
const P = TB.pro;

// ---- state -------------------------------------------------------------------
const broker = new TB.PaperBroker(10000);
const prices = {};
const deriv = {};
const rejects = [];
let research = null;
try { research = JSON.parse(localStorage.getItem("tb_pro_research_v1") || "null"); } catch (e) { research = null; }
let researchRunning = false, researchProgress = null;
const startedAt = Date.now();
let lastScanAt = null, scans = 0;

const resultFor = (s) => research && Array.isArray(research.results) ? research.results.find((r) => r.symbol === s && !r.error) || null : null;
const validated = (s) => { const r = resultFor(s); return !!(r && r.live && r.live.params && (r.verdict.code === "EDGE" || r.verdict.code === "PROMISING")); };
const paramsFor = (s) => { const r = resultFor(s); if (r && r.live && r.live.params) return r.live.params; return STRICT ? null : { ...P.DEFAULT_PARAMS }; };
let engine = new P.LiveEngine({ interval: INTERVAL, paramsFor });

const onTick = (symbol, price) => {
    if (!(price > 0)) return;
    prices[symbol] = price;
    for (const ev of broker.onPrice(symbol, price) || []) {
        if (ev.kind === "sl" || ev.kind === "tp") log("close", `${symbol} ${ev.kind === "sl" ? "Stop" : "Target"} @ ${price}`, { symbol, pnl: ev.pnl, fees: ev.fees });
        else if (ev.kind === "trail") log("trail", `${symbol} Stop nachgezogen auf ${ev.newStop}`, { symbol });
    }
};
const micro = new P.MicroStream(SYMBOLS, { onTrade: onTick });
broker.slipModel = (s, side, n, isExit) => P.slippageBps(micro, s, side, n, isExit);
if (!MOCK && typeof globalThis.WebSocket === "function") micro.start();

function realizedToday() {
    const day = new Date().toISOString().slice(0, 10);
    return broker.journal.filter((j) => j.kind === "close" && String(j.ts).startsWith(day)).reduce((s, j) => s + (j.pnl || 0), 0);
}

function reject(symbol, why) {
    rejects.unshift({ symbol, why, at: Date.now() });
    if (rejects.length > 30) rejects.length = 30;
    log("reject", `${symbol}: ${why}`, { symbol });
}

function tryEnter(symbol, d, candles, price) {
    if (broker.positions[symbol]) return;
    if (Object.keys(broker.positions).length >= MAX_POSITIONS) return reject(symbol, `bereits ${MAX_POSITIONS} Positionen offen`);
    const equity = broker.equity(prices);
    if (realizedToday() <= -equity * DAILY_LOSS_LIMIT_PCT / 100) return reject(symbol, `Tagesverlust-Limit ${DAILY_LOSS_LIMIT_PCT}% erreicht`);
    const ctl = P.liveControls(d.side, micro.metrics(symbol), deriv[symbol] || null);
    if (!ctl.ok) return reject(symbol, ctl.reasons.join(" · "));
    const isValid = validated(symbol);
    if (STRICT && !isValid) return reject(symbol, "keine validierte Edge (strenger Modus)");
    const riskPct = BASE_RISK_PCT * (isValid ? 1 : INCUBATION);
    const plan = TB.planTrade(d.side, price, d.atr, equity, {
        riskPctPerTrade: riskPct, atrStopMult: d.params.atrStopMult,
        maxNotionalPctPerPosition: MAX_NOTIONAL_PCT, tpMultiples: P.DEFAULT_SIM.tpMultiples,
    });
    if (!plan || plan.size <= 0) return;
    const strategy = `pro:${d.signals.map((s) => s.family).join("+")}`;
    const pos = broker.submit(symbol, d.side, plan.size, price, { stop: plan.stop, take_profits: plan.take_profits, strategy });
    if (pos) log("open", `${symbol} ${d.side.toUpperCase()} ${isValid ? "VALIDIERT" : "INKUBATION"} @ ${pos.entry.toFixed(4)} Stop ${plan.stop.toFixed(4)}`, { symbol, side: d.side, riskPct, regime: d.regime, score: d.score });
}

async function scanOnce() {
    for (const symbol of SYMBOLS) {
        try {
            const candles = await TB.fetchKlines(symbol, INTERVAL, 500);
            const price = candles[candles.length - 1].close;
            onTick(symbol, price);
            const d = engine.onCandles(symbol, candles, !!broker.positions[symbol]);
            if (d && d.stale) log("skip", `${symbol}: Signal verspätet erkannt — ausgelassen`, { symbol });
            else if (d) tryEnter(symbol, d, candles, price);
        } catch (e) {
            log("error", `${symbol}: ${e.message}`, { symbol });
        }
    }
    lastScanAt = Date.now();
    scans++;
}

async function refreshDerivs() {
    for (const s of SYMBOLS) deriv[s] = await P.fetchDerivatives(s);
}

function researchStale() {
    if (!research || !research.computedAt) return true;
    if (Date.now() - research.computedAt > 24 * 3600e3) return true;
    return (research.results || []).map((r) => r.symbol).join(",") !== SYMBOLS.join(",");
}

async function runResearch() {
    if (researchRunning) return;
    researchRunning = true;
    log("research", `Walk-Forward startet (${RESEARCH_DAYS} Tage, ${SYMBOLS.length} Symbole)`);
    try {
        const res = await P.runResearch(SYMBOLS, {
            days: RESEARCH_DAYS, interval: INTERVAL,
            sim: { riskPct: BASE_RISK_PCT, maxNotionalPct: MAX_NOTIONAL_PCT },
        }, (p) => { researchProgress = p; });
        research = res;
        localStorage.setItem("tb_pro_research_v1", JSON.stringify(res));
        engine = new P.LiveEngine({ interval: INTERVAL, paramsFor });
        const p = res.portfolio;
        log("research", p ? `Walk-Forward fertig: ${p.verdict.label}, Sharpe ${p.stats.sharpe.toFixed(2)}, ${p.stats.trades} Trades` : "Walk-Forward fertig: keine auswertbaren Symbole");
    } catch (e) {
        log("error", `Walk-Forward: ${e.message}`);
    } finally {
        researchRunning = false;
        researchProgress = null;
    }
}

// ---- status API + static app -------------------------------------------------
function status() {
    const equity = broker.equity(prices);
    const closes = broker.journal.filter((j) => j.kind === "close");
    const slim = (r) => r.error ? { symbol: r.symbol, error: r.error } : {
        symbol: r.symbol, verdict: r.verdict, stats: r.stats, bench: { sharpe: r.bench.sharpe, totalReturn: r.bench.totalReturn },
        live: r.live, folds: r.folds.length,
    };
    return {
        demo: true,
        dataSource: MOCK ? "synthetisch (TB_MOCK=1)" : "Binance Live-Daten",
        startedAt, lastScanAt, scans, uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        equity, cash: broker.cash, startingBalance: broker.startingBalance,
        realizedPnl: broker.realizedPnl(),
        feesPaid: closes.reduce((s, j) => s + (j.fees || 0), 0) + broker.journal.filter((j) => j.kind === "open").reduce((s, j) => s + (j.fee || 0), 0),
        positions: Object.values(broker.positions).map((p) => ({
            symbol: p.symbol, side: p.side, qty: p.qty, entry: p.entry, stop: p.stop, mark: prices[p.symbol] || p.entry,
            unrealized: ((prices[p.symbol] || p.entry) - p.entry) * p.qty * (p.side === "long" ? 1 : -1),
            strategy: p.meta && p.meta.strategy, openedAt: p.opened_at,
        })),
        recentTrades: closes.slice(-50).reverse(),
        engine: SYMBOLS.map((s) => {
            const st = engine.status(s);
            return { symbol: s, regime: st && st.lastPre ? st.lastPre.regime : null, watch: st ? st.watch : null, validated: validated(s) };
        }),
        market: SYMBOLS.map((s) => ({ symbol: s, price: prices[s] || null, micro: micro.metrics(s), deriv: deriv[s] || null })),
        research: research ? { computedAt: research.computedAt, days: research.days, portfolio: research.portfolio, results: (research.results || []).map(slim) } : null,
        researchRunning, researchProgress,
        rejects: rejects.slice(0, 10),
    };
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const ROOT = path.resolve(APP_DIR);

const server = http.createServer((req, res) => {
    const send = (code, body, type = "text/plain; charset=utf-8", extra = {}) => {
        res.writeHead(code, { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", ...extra });
        res.end(req.method === "HEAD" ? undefined : body);
    };
    if (req.method !== "GET" && req.method !== "HEAD") return send(405, "Nur lesender Zugriff.", undefined, { Allow: "GET, HEAD" });
    let url;
    try { url = new URL(req.url, "http://localhost"); } catch (e) { return send(400, "Ungültige URL"); }
    if (url.pathname === "/api/status") return send(200, JSON.stringify(status()), "application/json");
    if (url.pathname === "/api/health") return send(200, JSON.stringify({ ok: true, lastScanAt, scans }), "application/json");
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch (e) { return send(400, "Ungültige URL"); }
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.resolve(ROOT, "." + rel);
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return send(404, "Nicht gefunden");
    fs.stat(file, (err, st) => {
        if (err || !st.isFile()) return send(404, "Nicht gefunden");
        fs.readFile(file, (e2, buf) => e2 ? send(500, "Lesefehler") : send(200, buf, MIME[path.extname(file)] || "application/octet-stream"));
    });
});

server.listen(PORT, HOST, () => {
    log("start", `Paper-Trading-Server läuft auf http://${HOST}:${PORT} · ${SYMBOLS.join(", ")} · Daten: ${MOCK ? "synthetisch" : "Binance live"} · Zustand: ${STATE_DIR}`);
});

let scanning = false;
const tick = async () => {
    if (scanning) return;
    scanning = true;
    try { await scanOnce(); } finally { scanning = false; }
};
tick();
const timers = [
    setInterval(tick, SCAN_MS),
    setInterval(() => refreshDerivs().catch(() => {}), 5 * 60e3),
    setInterval(() => { if (researchStale()) runResearch(); }, 3600e3),
];
refreshDerivs().catch(() => {});
setTimeout(() => { if (researchStale()) runResearch(); }, 5000);

const shutdown = (sig) => {
    log("stop", `Beende (${sig})`);
    timers.forEach(clearInterval);
    micro.stop();
    broker.save();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ---- synthetic exchange for offline runs and CI --------------------------------
function installMockExchange() {
    const TF = 900e3;
    const days = Math.max(RESEARCH_DAYS, 30) + 10;
    const n = days * 96 + 600;
    const endTs = Date.now() + 2 * 86400e3;
    const series = {};
    SYMBOLS.forEach((s, i) => {
        series[s.replace("/", "")] = syntheticCandles(n, { seed: 101 + i, start: [68000, 3400, 165, 580][i] || 100, vol: 0.0035, endTs });
    });
    const visible = (sym) => (series[sym] || []).filter((c) => c.ts <= Date.now());
    const asKline = (c) => [c.ts, String(c.open), String(c.high), String(c.low), String(c.close), String(c.volume), c.ts + TF - 1, "0", 1, "0", "0", "0"];
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    globalThis.fetch = async (input) => {
        const u = new URL(String(input));
        const sym = u.searchParams.get("symbol") || "";
        if (u.pathname.endsWith("/klines")) {
            const all = visible(sym);
            const limit = Math.min(1000, Number(u.searchParams.get("limit") || 500));
            const st = u.searchParams.get("startTime");
            if (st) { const i = all.findIndex((c) => c.ts >= Number(st)); return ok(i < 0 ? [] : all.slice(i, i + limit).map(asKline)); }
            return ok(all.slice(-limit).map(asKline));
        }
        if (u.pathname.endsWith("/ticker/price")) { const all = visible(sym); return ok({ symbol: sym, price: String(all.at(-1).close) }); }
        if (u.pathname.includes("premiumIndex")) { const px = visible(sym).at(-1).close; return ok({ markPrice: String(px), indexPrice: String(px), lastFundingRate: "0.0001", nextFundingTime: Date.now() + 3600e3 }); }
        if (u.pathname.includes("fundingRate")) return ok(Array.from({ length: 50 }, (_, i) => ({ fundingRate: String(0.0001 + 0.00003 * Math.sin(i)) })));
        if (u.pathname.includes("openInterestHist")) return ok(Array.from({ length: 13 }, (_, i) => ({ sumOpenInterest: String(1000 + i) })));
        return { ok: false, status: 404, json: async () => ({}) };
    };
}
