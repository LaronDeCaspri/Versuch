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

test("pause in the background: missed entries are counted, entries before the pause match", () => {
    const params = { minScore: 1.0, agreement: 1, atrStopMult: 2 };
    const from = prepared.first;
    const sim = P.simulate(candles, prepared.pre, params, { from });
    const hasPos = (i) => sim.trades.some((t) => t.entryIdx <= i && i < t.exitIdx);
    const anchor = sim.trades[Math.min(2, sim.trades.length - 1)].entryIdx;
    const g0 = Math.max(from + 5, anchor - 15), g1 = g0 + 40;   // app paused for 40 bars (10 h) around a known entry
    const live = new P.LiveEngine({ paramsFor: () => params, warmReplay: false });
    const executed = [];
    for (let i = from; i < g0; i++) {
        const d = live.onCandles("SYN/USDT", candles.slice(0, i + 1), hasPos(i), candles[i].ts + 900e3 + 1000);
        if (d) executed.push(i + 1);
    }
    assert.deepEqual(executed, sim.trades.map((t) => t.entryIdx).filter((e) => e - 1 < g0), "identical before the pause");
    // back in the foreground: a missed signal never became a position
    live.onCandles("SYN/USDT", candles.slice(0, g1 + 1), false, candles[g1].ts + 900e3 + 1000);
    const inGap = sim.trades.filter((t) => t.entryIdx - 1 >= g0 && t.entryIdx - 1 < g1).length;
    assert.ok(inGap > 0, "gap must contain at least one backtest entry");
    assert.ok((live.status("SYN/USDT").missed || 0) >= inGap, `missed ${live.status("SYN/USDT").missed} >= ${inGap}`);
});

test("timeframe choice follows the documented rule", () => {
    const pf = (code, dsr, sharpe) => ({ portfolio: { verdict: { code }, stats: { dsr, sharpe } } });
    assert.equal(P.chooseTimeframe({ "15m": pf("NONE", 0.2, 1.5), "1h": pf("NONE", 0.1, 0.4) }), "1h", "no edge anywhere → longer, cheaper timeframe");
    assert.equal(P.chooseTimeframe({ "15m": pf("PROMISING", 0.85, 1.2), "1h": pf("NONE", 0.3, 2.0) }), "15m", "verdict beats raw Sharpe");
    assert.equal(P.chooseTimeframe({ "15m": pf("PROMISING", 0.81, 2.5), "1h": pf("PROMISING", 0.9, 1.1) }), "1h", "same verdict → higher Deflated Sharpe");
    assert.equal(P.chooseTimeframe({ "15m": pf("EDGE", 0.96, 1.0), "1h": pf("PROMISING", 0.94, 3.0) }), "15m");
    assert.equal(P.chooseTimeframe({ "15m": { portfolio: null } }), null);
    assert.equal(new P.LiveEngine({ interval: "1h" }).opts.maxDelayMs, 288000, "late tolerance scales with the bar");
    assert.equal(new P.LiveEngine({ interval: "15m" }).opts.maxDelayMs, 120000);
});

test("multi-timeframe research runs both timeframes and picks one", async () => {
    const r = await P.runResearchMulti(["RND/USDT"], {
        days: 45, intervals: ["15m", "1h"],
        candlesFor: async (s, interval) => syntheticCandles(interval === "1h" ? 45 * 24 + 499 : 45 * 96 + 499, { seed: 5, vol: interval === "1h" ? 0.007 : 0.0035, tfMs: interval === "1h" ? 3600e3 : 900e3 }),
    });
    assert.ok(r.byTf["15m"] && r.byTf["1h"], "both timeframes present");
    assert.ok(["15m", "1h"].includes(r.chosen));
    assert.equal(r.byTf["1h"].interval, "1h");
});

test("attention radar: mentions, scoring, levels and safe logos", () => {
    const R = TB.radar;
    const now = Date.UTC(2026, 9, 23, 12);
    const news = [
        { title: "Bitcoin ETF inflows hit record", ts: now - 3600e3 },
        { title: "$SOL rallies as Solana DEX volume jumps", ts: now - 2 * 3600e3 },
        { title: "Ethena launches new product", ts: now - 3600e3 },
        { title: "Old Bitcoin story", ts: now - 3 * 86400e3 },
    ];
    assert.equal(R.countMentions(news, "BTC", "Bitcoin", now - 86400e3), 1, "only fresh headlines count");
    assert.equal(R.countMentions(news, "SOL", "Solana", now - 86400e3), 1);
    assert.equal(R.countMentions(news, "ETH", "Ethereum", now - 86400e3), 0, "ETH must not match Ethena");

    const out = R.computeAttention({
        tracked: [
            { symbol: "BTC", volRatio: 1.0, change24h: 0.4, fundingZ: 0.2, oiChange1h: 0.01 },
            { symbol: "SOL", volRatio: 3.2, change24h: 14, fundingZ: 2.8, oiChange1h: 0.09 },
        ],
        trending: [
            { id: "solana", symbol: "SOL", name: "Solana", image: "https://coin-images.coingecko.com/coins/images/4128/large/solana.png" },
            { id: "pepe", symbol: "PEPE", name: "Pepe", image: "javascript:alert(1)", change24h: 22 },
        ],
        markets: [], news,
    }, now);
    const sol = out.find((c) => c.symbol === "SOL"), btc = out.find((c) => c.symbol === "BTC"), pepe = out.find((c) => c.symbol === "PEPE");
    assert.equal(out[0].symbol, "SOL", "hottest coin ranks first");
    assert.equal(sol.level, "HYPE");
    assert.match(sol.advice, /Rückschlag/);
    assert.equal(btc.level, "RUHIG");
    assert.ok(btc.tracked && !pepe.tracked);
    assert.equal(pepe.image, "https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/pepe.svg", "unsafe logo replaced by the pinned static icon");
    assert.equal(R.safeImage("http://coin-images.coingecko.com/x.png"), null, "https only");
    assert.equal(R.safeImage("https://evil.example/x.png"), null, "unknown hosts rejected");
    assert.equal(R.safeImage("https://cdn.jsdelivr.net/npm/other-pkg/x.svg"), null, "only the pinned icon package on jsDelivr");
    assert.equal(sol.imageAlt, "https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/sol.svg", "CoinGecko logo keeps a static fallback");
    assert.ok(sol.image.startsWith("https://coin-images.coingecko.com/"));
    assert.ok(pepe.score > 0 && pepe.score <= 100, "missing components are re-weighted, not zeroed");

    const hist = [{ t: now - 3600e3, scores: { SOL: 40 } }, { t: now - 600e3, scores: { SOL: 70 } }];
    assert.equal(R.trendFor(hist, "SOL", sol.score, now), sol.score - 40, "trend compares with ~1 h ago");
});

test("BTC memory: merge, drawdowns, cycle, analogs and a risk context that only ever reduces", () => {
    const B = TB.btcBrain, DAY = 86400e3;
    const now = Date.parse("2026-10-23T00:00:00Z");
    // Steady uptrend with a little wave, plus one clean 60 % crash and full recovery.
    const n = 5000, mid = 3000, t0 = Math.floor(now / DAY) * DAY - n * DAY, raw = [];
    let lc = 0;
    for (let i = 0; i < n; i++) {
        let r = 0.002 + 0.01 * Math.sin(i / 9) * Math.sin(i / 31);
        if (i > mid && i <= mid + 200) r = Math.log(0.4) / 200;
        else if (i > mid + 200 && i <= mid + 400) r = Math.log(2.5 * 1.05) / 200;
        lc += r;
        const c = Math.exp(lc);
        raw.push({ t: t0 + i * DAY, o: c, h: c * 1.01, l: c * 0.99, c, v: 1 });
    }
    const daily = B.mergeDaily(raw.slice(0, 10), raw, [{ t: raw[5].t + 3600e3, c: 999 }]);
    assert.equal(daily.length, raw.length, "one row per UTC day");
    assert.ok(daily.every((k, i) => !i || k.t > daily[i - 1].t), "sorted, no duplicates");
    assert.notEqual(daily[5].c, 999, "earlier sources win for the same day");

    const dds = B.drawdowns(daily, 30);
    const crash = dds.slice().sort((x, y) => x.depth - y.depth)[0];
    assert.ok(crash && crash.depth <= -58 && crash.depth >= -66, `the 60 % crash is found (${crash && crash.depth})`);
    assert.ok(crash.recoveryDays > 150 && crash.recoveryDays < 260, "and its recovery");

    const cyc = B.cycleInfo(daily, B.HALVINGS[3] + 100 * DAY);
    assert.equal(cyc.halvingIndex, 4);
    assert.equal(cyc.daysSince, 100);
    assert.match(cyc.phase, /früh nach dem Halving/);

    const a = B.analyze(daily, now);
    assert.ok(a && a.days === daily.length && a.price === daily[daily.length - 1].c);
    assert.ok(a.context.score >= -1 && a.context.score <= 1);
    assert.ok(a.riskMult.long <= 1 && a.riskMult.short <= 1 && a.riskMult.long >= 0.5 && a.riskMult.short >= 0.5, "risk is never increased");
    assert.ok(a.analogs.rows.length > 0);
    const last = daily.length - 1;
    for (const r of a.analogs.rows) {
        const idx = daily.findIndex((k) => k.t === r.t);
        assert.ok(idx + 90 < last - 60, "analogue outcomes come from the past, never overlap today's window");
    }
    assert.match(B.summary(a), /Ich kenne Bitcoin seit/);
    assert.match(B.answer(a, "Wann war das letzte Halving?"), /Halving/);
    assert.match(B.answer(a, "größter Crash"), /Einbrüche/);

    const hourly = syntheticCandles(24 * 120, { seed: 3, start: 30000, vol: 0.004, tfMs: 3600e3, endTs: now })
        .map((k) => ({ t: k.ts, o: k.open, h: k.high, l: k.low, c: k.close, v: k.volume }));
    const I = B.intraday(hourly);
    assert.equal(I.byHour.length, 24);
    assert.equal(I.byWeekday.length, 7);
    assert.equal(I.busiest.length, 3);
});

test("integrity manifest matches the shipped app files (run node bot/tools/integrity.mjs)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { buildManifest, APP_DIR } = await import("../tools/integrity.mjs");
    const shipped = JSON.parse(fs.readFileSync(path.join(APP_DIR, "integrity.json"), "utf8"));
    assert.deepEqual(shipped, buildManifest());
});

test("security: CSP present, no inline scripts or inline event handlers in the app", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { APP_DIR } = await import("../tools/integrity.mjs");
    const html = fs.readFileSync(path.join(APP_DIR, "index.html"), "utf8");
    assert.match(html, /http-equiv="Content-Security-Policy"/);
    const scriptSrc = /script-src([^;"]*)/.exec(html)[1];
    assert.doesNotMatch(scriptSrc, /'unsafe-inline'|'unsafe-eval'|\s\*/, "scripts must not allow inline code, eval or any host");
    assert.equal((html.match(/<script>/g) || []).length, 0, "no inline <script> blocks");
    for (const f of ["app.js", "jarvis.js", "radar.js", "lib.js", "pro.js", "btc-brain.js", "boot.js", "vault.js"]) {
        const src = fs.readFileSync(path.join(APP_DIR, f), "utf8");
        assert.doesNotMatch(src, /\son(click|error|load|change|input|submit|mouseover|keydown)="/, `${f}: inline event handler`);
        assert.doesNotMatch(src, /\beval\(|new Function\(/, `${f}: eval`);
    }
});
