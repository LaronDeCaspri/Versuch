// Engine test suite: node --test bot/server/test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, syntheticCandles } from "./load.mjs";

const calls = [];
globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET" });
    return { ok: true, status: 200, json: async () => ({}) };
};
const TB = loadEngine();
const P = TB.pro;

test("demo guard blocks every write or private call to exchanges", async () => {
    const blocked = [
        ["https://api.binance.com/api/v3/order", { method: "POST" }],
        ["https://fapi.binance.com/fapi/v1/order", { method: "DELETE" }],
        ["https://api.binance.com/api/v3/account", {}],
        ["https://api.binance.com/sapi/v1/capital/withdraw/apply", {}],
        ["https://api.binance.com/api/v3/klines?symbol=BTCUSDT", { headers: { "X-MBX-APIKEY": "abc" } }],
        ["https://api.bybit.com/v5/order/create", { method: "POST" }],
        ["https://api.hyperliquid.xyz/exchange", { method: "POST" }],
    ];
    for (const [url, init] of blocked) {
        await assert.rejects(fetch(url, init), /DEMO-SPERRE/, url);
    }
    const before = calls.length;
    await fetch("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m");
    await fetch("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT");
    await fetch("https://ntfy.sh/topic", { method: "POST" });
    assert.equal(calls.length, before + 3, "public reads and notifications must pass");
});

test("paper broker charges fees and slippage on both sides", () => {
    const b = new TB.PaperBroker(10000, { isolated: true });
    b.submit("BTC/USDT", "long", 0.1, 30000, { stop: 29000 });
    const r = b.close("BTC/USDT", 30000, 1);
    // 3 bps slippage + 7.5 bps fee on entry and exit
    assert.ok(Math.abs(r.pnl - -6.3) < 1e-6, `long round trip pnl ${r.pnl}`);
    assert.ok(Math.abs(b.cash - (10000 - 6.3)) < 1e-6, `cash ${b.cash}`);
    const s = new TB.PaperBroker(10000, { isolated: true });
    s.submit("ETH/USDT", "short", 1, 2000, { stop: 2100 });
    const r2 = s.close("ETH/USDT", 2000, 1);
    assert.ok(r2.pnl < 0 && Math.abs(s.cash - (10000 + r2.pnl)) < 1e-6, "short round trip loses exactly the costs");
});

test("statistics helpers are numerically sane", () => {
    assert.ok(Math.abs(P.normInv(P.normCdf(1.2)) - 1.2) < 1e-3);
    assert.ok(Math.abs(P.normCdf(0) - 0.5) < 1e-9);
    const good = Array.from({ length: 200 }, (_, i) => 0.01 + (i % 2 ? 0.002 : -0.002));
    assert.ok(P.probabilisticSharpe(good) > 0.99);
    const flat = Array.from({ length: 200 }, (_, i) => (i % 2 ? 0.01 : -0.01));
    const psr = P.probabilisticSharpe(flat);
    assert.ok(psr > 0.3 && psr < 0.7, `zero-mean PSR ${psr}`);
});

test("simulator enters at the next open, never on the signal bar", () => {
    const candles = syntheticCandles(400, { seed: 3 });
    const pre = new Array(candles.length).fill(null);
    const quiet = { long: { score: 0, families: 0, signals: [] }, short: { score: 0, families: 0, signals: [] }, atr: 100 };
    for (let i = 250; i < candles.length; i++) pre[i] = quiet;
    pre[300] = { ...quiet, long: { score: 5, families: 3, signals: [{ family: "trend" }] } };
    const r = P.simulate(candles, pre, { minScore: 1, agreement: 1, atrStopMult: 2 }, { from: 250, confirmBars: 0 });
    assert.ok(r.trades.length >= 1);
    assert.equal(r.trades[0].entryIdx, 301);
    assert.ok(Math.abs(r.trades[0].entry - candles[301].open * 1.0003) < 1e-6);
});

const candles = syntheticCandles(1400, { seed: 11, vol: 0.006 });
let prepared;
test("precomputed signals use only past data (no lookahead)", async () => {
    prepared = await P.precompute(candles);
    for (const i of [prepared.first + 5, 900, 1300]) {
        const truncated = candles.slice(0, i + 1);
        const solo = P.evaluateBar(truncated.slice(-P.WINDOW), false);
        assert.equal(solo.long.score, prepared.pre[i].long.score, `bar ${i} long`);
        assert.equal(solo.short.score, prepared.pre[i].short.score, `bar ${i} short`);
        assert.equal(solo.regime, prepared.pre[i].regime);
    }
});

test("costs strictly reduce results", () => {
    const params = { minScore: 1.0, agreement: 1, atrStopMult: 2 };
    const a = P.simulate(candles, prepared.pre, params, { from: prepared.first, feeBps: 0, slipBps: 0 });
    const b = P.simulate(candles, prepared.pre, params, { from: prepared.first });
    assert.ok(a.trades.length > 0, "needs trades to compare");
    assert.ok(b.equity[b.equity.length - 1] < a.equity[a.equity.length - 1]);
    assert.ok(b.feesPaid > 0 && b.slipPaid > 0);
});

test("live engine takes exactly the trades the backtest takes", () => {
    const params = { minScore: 1.0, agreement: 1, atrStopMult: 2 };
    const from = prepared.first;
    const sim = P.simulate(candles, prepared.pre, params, { from });
    const hasPos = (i) => sim.trades.some((t) => t.entryIdx <= i && i < t.exitIdx);
    const live = new P.LiveEngine({ paramsFor: () => params, warmReplay: false });
    const liveEntries = [];
    for (let i = from; i < candles.length - 1; i++) {
        const d = live.onCandles("SYN/USDT", candles.slice(0, i + 1), hasPos(i), candles[i].ts + 900e3 + 1000);
        if (d) liveEntries.push(i + 1);
    }
    const simEntries = sim.trades.map((t) => t.entryIdx);
    assert.ok(simEntries.length > 0, "needs trades to compare");
    assert.deepEqual(liveEntries, simEntries);
});

test("walk-forward on a random walk does not claim an edge", async () => {
    const hourly = syntheticCandles(24 * 75 + 499, { seed: 7, tfMs: 3600e3, vol: 0.008 });
    const prep = await P.precompute(hourly);
    const wf = P.walkForward(hourly, prep, { interval: "1h", symbol: "RND/USDT" });
    assert.ok(!wf.error, wf.error);
    assert.ok(wf.folds.length >= 3);
    assert.notEqual(wf.verdict.code, "EDGE", `random walk verdict ${wf.verdict.label}`);
    for (const k of ["sharpe", "psr", "dsr", "maxDD", "totalReturn"]) assert.ok(Number.isFinite(wf.stats[k]), k);
    const port = P.portfolioSummary([wf]);
    assert.ok(port && Number.isFinite(port.stats.sharpe));
});
