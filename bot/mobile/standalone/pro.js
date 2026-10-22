/* =====================================================================
 * Trading Bot — v32 Pro-Engine
 * DOM-free. Runs identically in the browser, a Web Worker and Node.
 * The same SignalMachine drives the backtest and live trading, so the
 * bot trades exactly what it tested. Paper trading only.
 * ===================================================================== */
(function (root) {
"use strict";
const TB = root.TB;
if (!TB) throw new Error("pro.js requires lib.js (window.TB)");

// ---------------------------------------------------------------------
// 0. Demo guard — blocks every write/private call to any exchange
// ---------------------------------------------------------------------
const EXCHANGE_HOST_RE = /(^|\.)(binance\.(com|us|vision)|binancefuture\.com|bybit\.com|kraken\.com|coinbase\.com|okx\.com|kucoin\.com|bitget\.com|gate\.io|mexc\.com|hyperliquid\.xyz|bitfinex\.com|deribit\.com|bitstamp\.net)$/i;
const PRIVATE_PATH_RE = /\/(order|orders|openOrders|allOrders|myTrades|account|balance|userDataStream|listenKey|sapi|private|brokerage|AddOrder|CancelOrder|withdraw|transfer|leverage|positionSide)(\/|$)/i;
const KEY_HEADER_RE = /^(x-mbx-apikey|cb-access-key|api-key|ok-access-key|x-bapi-api-key|kc-api-key|authorization)$/i;

function _headerNames(h) {
    if (!h) return [];
    try {
        if (typeof h.keys === "function") return Array.from(h.keys());
        if (Array.isArray(h)) return h.map((x) => x[0]);
        return Object.keys(h);
    } catch (e) { return []; }
}

function isBlockedRequest(url, method, headers) {
    let host = "", path = "";
    try {
        const u = new URL(String(url), root.location && root.location.href ? root.location.href : "http://localhost/");
        host = u.hostname; path = u.pathname;
    } catch (e) { return false; }
    if (!EXCHANGE_HOST_RE.test(host)) return false;
    if ((method || "GET").toUpperCase() !== "GET") return true;
    if (PRIVATE_PATH_RE.test(path)) return true;
    return _headerNames(headers).some((n) => KEY_HEADER_RE.test(n));
}

function installDemoGuard() {
    if (root.__tbProGuard || typeof root.fetch !== "function") return;
    const orig = root.fetch.bind(root);
    root.fetch = function (input, init) {
        const url = typeof input === "string" ? input : (input && input.url) || String(input);
        const method = (init && init.method) || (input && input.method) || "GET";
        const headers = (init && init.headers) || (input && input.headers);
        if (isBlockedRequest(url, method, headers)) {
            return Promise.reject(new Error(`DEMO-SPERRE: ${String(method).toUpperCase()} ${url} blockiert — dieser Bot handelt ausschließlich auf Papier.`));
        }
        return orig(input, init);
    };
    root.__tbProGuard = true;
}
installDemoGuard();

// ---------------------------------------------------------------------
// 1. Math helpers
// ---------------------------------------------------------------------
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
function std(a) {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
}
function skewKurt(a) {
    const n = a.length;
    if (n < 3) return { skew: 0, kurt: 3 };
    const m = mean(a);
    let m2 = 0, m3 = 0, m4 = 0;
    for (const x of a) { const d = x - m; m2 += d * d; m3 += d * d * d; m4 += d * d * d * d; }
    m2 /= n; m3 /= n; m4 /= n;
    if (m2 <= 0) return { skew: 0, kurt: 3 };
    return { skew: m3 / Math.pow(m2, 1.5), kurt: m4 / (m2 * m2) };
}
function normCdf(x) {
    // Abramowitz-Stegun 7.1.26 via erf
    const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
    return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
function normInv(p) {
    // Acklam's rational approximation
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.3577518672690, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const pl = 0.02425, ph = 1 - pl;
    let q, r;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > ph) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const yieldNow = () => new Promise((r) => setTimeout(r, 0));

// Probabilistic Sharpe Ratio (Bailey & López de Prado 2012), per-period returns
function probabilisticSharpe(rets, srBenchmark = 0) {
    const n = rets.length;
    const sd = std(rets);
    if (n < 5 || sd === 0) return 0;
    const sr = mean(rets) / sd;
    const { skew, kurt } = skewKurt(rets);
    const denom = Math.sqrt(Math.max(1e-12, 1 - skew * sr + ((kurt - 1) / 4) * sr * sr));
    return normCdf(((sr - srBenchmark) * Math.sqrt(n - 1)) / denom);
}
// Expected max Sharpe under N independent trials with zero true skill,
// given the cross-sectional variance of the trial Sharpes.
function expectedMaxSharpeFromVar(variance, N) {
    if (!(N >= 2) || !(variance > 0)) return 0;
    const g = 0.5772156649;
    return Math.sqrt(variance) * ((1 - g) * normInv(1 - 1 / N) + g * normInv(1 - 1 / (N * Math.E)));
}
function expectedMaxSharpe(trialSharpes, N = trialSharpes.length) {
    if (trialSharpes.length < 2) return 0;
    return expectedMaxSharpeFromVar(Math.pow(std(trialSharpes), 2), N);
}

// ---------------------------------------------------------------------
// 2. Strategy families + regime routing (signal de-duplication)
// ---------------------------------------------------------------------
// Correlated indicators are grouped; each family casts at most ONE vote.
const FAMILIES = {
    ema_cross: "trend", macd_trend: "trend", weinstein_stages: "trend", mega_confluence: "trend",
    donchian_breakout: "breakout", bollinger_squeeze: "breakout", livermore_pivot: "breakout",
    soros_reflexivity: "momentum", mmcrypto_style: "momentum", ackman_conviction: "momentum",
    rsi_meanrev: "meanrev", templeton_pessimism: "meanrev", buffett_value: "meanrev",
    ptj_crash: "meanrev", paulson_bubble: "meanrev",
    dalio_allweather: "macro",
};
const FAMILY_LABELS = { trend: "Trend", breakout: "Breakout", momentum: "Momentum", meanrev: "Mean-Reversion", macro: "Makro", other: "Sonstige" };
// Trend regime: trend-followers on, mean reversion off. Range: the opposite.
const REGIME_WEIGHTS = {
    trend: { trend: 1.0, breakout: 1.0, momentum: 1.0, meanrev: 0.0, macro: 0.5, other: 0.5 },
    range: { trend: 0.0, breakout: 0.5, momentum: 0.0, meanrev: 1.0, macro: 0.5, other: 0.5 },
    mixed: { trend: 0.6, breakout: 0.8, momentum: 0.6, meanrev: 0.6, macro: 0.5, other: 0.5 },
};
const REGIME_LABELS = { trend: "TREND", range: "SEITWÄRTS", mixed: "GEMISCHT" };

function regimeOf(candles) {
    const h = TB.highs(candles), l = TB.lows(candles), c = TB.closes(candles);
    const adxArr = TB.adx(h, l, c, 14).adx;
    const adx = adxArr[adxArr.length - 1];
    const atrArr = TB.atr(h, l, c, 14);
    const atr = atrArr[atrArr.length - 1];
    let volPct = 0.5;
    const look = Math.min(200, atrArr.length);
    if (look > 20 && Number.isFinite(atr)) {
        const cur = atr / c[c.length - 1];
        let below = 0, cnt = 0;
        for (let i = atrArr.length - look; i < atrArr.length; i++) {
            const v = atrArr[i] / c[i];
            if (!Number.isFinite(v)) continue;
            cnt++; if (v <= cur) below++;
        }
        volPct = cnt ? below / cnt : 0.5;
    }
    const regime = !Number.isFinite(adx) ? "mixed" : adx >= 25 ? "trend" : adx < 20 ? "range" : "mixed";
    return { regime, adx: Number.isFinite(adx) ? adx : null, atr: Number.isFinite(atr) ? atr : null, volPct };
}

// Full evaluation of one closed-bar window. withReasons=false keeps backtests lean.
function evaluateBar(candles, withReasons = true) {
    const reg = regimeOf(candles);
    const w = REGIME_WEIGHTS[reg.regime];
    const best = { long: {}, short: {} };
    const dirs = new Int8Array(TB.STRATEGIES.length);
    TB.STRATEGIES.forEach((s, idx) => {
        let r = null;
        try { r = s.fn(candles); } catch (e) { r = null; }
        if (!r || (r.side !== "long" && r.side !== "short")) return;
        dirs[idx] = r.side === "long" ? 1 : -1;
        const fam = FAMILIES[s.name] || "other";
        const strength = Number.isFinite(r.strength) ? r.strength : 1;
        const contrib = s.weight * strength * (w[fam] ?? 0.5);
        if (contrib <= 0) return;
        const slot = best[r.side][fam];
        if (!slot || contrib > slot.w) {
            best[r.side][fam] = { w: contrib, strategy: s.name, reason: withReasons ? (r.reason || "") : "" };
        }
    });
    const side = (k) => {
        const fams = Object.keys(best[k]);
        return {
            score: fams.reduce((s, f) => s + best[k][f].w, 0),
            families: fams.length,
            signals: fams.map((f) => ({ strategy: best[k][f].strategy, family: f, reason: best[k][f].reason, side: k, strength: best[k][f].w })),
        };
    };
    return { long: side("long"), short: side("short"), regime: reg.regime, adx: reg.adx, atr: reg.atr, volPct: reg.volPct, dirs };
}

function signalFrom(pre, params) {
    if (!pre || !params) return null;
    const L = pre.long.score, S = pre.short.score;
    if (L === S) return null;
    const side = L > S ? "long" : "short";
    const s = pre[side];
    if (s.score < params.minScore || s.families < params.agreement) return null;
    return { side, score: s.score, families: s.families, signals: s.signals };
}

// ---------------------------------------------------------------------
// 3. Signal state machine — single source of truth (backtest == live)
// ---------------------------------------------------------------------
const DEFAULT_PARAMS = { minScore: 1.5, agreement: 2, atrStopMult: 2.0 };
// Lern-Modus: looser but still inside the walk-forward grid, so it stays testable
const LEARN_PARAMS = { minScore: 1.0, agreement: 1, atrStopMult: 2.0 };
const DEFAULT_SIM = {
    feeBps: 7.5,            // Binance taker incl. BNB discount, per side
    slipBps: 3.0,           // conservative for majors when no live book
    riskPct: 0.5,           // % equity at risk per trade
    maxNotionalPct: 20,
    tpMultiples: [1.5, 2.5, 4.0],
    confirmBars: 2,         // pre-entry watcher: close beyond trigger within N bars
    confirmBuf: 0.0015,
    allowShorts: true,      // shorts are simulated as perp shorts (no funding credit)
};

class SignalMachine {
    constructor(params, opts) {
        this.params = params || null;
        this.opts = { ...DEFAULT_SIM, ...(opts || {}) };
        this.watch = null;
    }
    reset() { this.watch = null; }
    // Called at the close of every bar. Returns {side, signal} to enter at the next open.
    onBarClose(pre, close, hasPosition) {
        if (hasPosition || !this.params) { this.watch = null; return null; }
        if (this.watch) {
            const w = this.watch;
            const ok = w.side === "long" ? close >= w.trigger : close <= w.trigger;
            if (ok) { this.watch = null; return { side: w.side, signal: w.signal }; }
            w.barsLeft -= 1;
            if (w.barsLeft <= 0) this.watch = null;
            return null;
        }
        const sig = signalFrom(pre, this.params);
        if (!sig) return null;
        if (sig.side === "short" && !this.opts.allowShorts) return null;
        if (this.opts.confirmBars <= 0) return { side: sig.side, signal: sig };
        const dir = sig.side === "long" ? 1 : -1;
        this.watch = { side: sig.side, trigger: close * (1 + dir * this.opts.confirmBuf), barsLeft: this.opts.confirmBars, signal: sig };
        return null;
    }
}

// ---------------------------------------------------------------------
// 4. Historical data + precompute
// ---------------------------------------------------------------------
const TF_MS = { "1m": 60e3, "5m": 300e3, "15m": 900e3, "1h": 3600e3, "4h": 14400e3, "1d": 86400e3 };
const WINDOW = 499;   // live uses 500 klines of which the last is still forming

async function fetchKlinesRange(symbol, interval, days, onProgress) {
    const tf = TF_MS[interval] || 900e3;
    const sym = symbol.replace("/", "");
    const end = Date.now();
    let start = end - days * 86400e3 - WINDOW * tf;
    const out = [];
    const expected = Math.ceil((end - start) / tf);
    let guard = 0;
    while (start < end && guard++ < 400) {
        const url = `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&startTime=${start}&limit=1000`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Binance ${res.status} für ${symbol}`);
        const raw = await res.json();
        if (!Array.isArray(raw) || !raw.length) break;
        for (const k of raw) {
            out.push({ ts: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] });
        }
        start = raw[raw.length - 1][0] + tf;
        if (onProgress) onProgress(Math.min(1, out.length / expected));
        if (raw.length < 1000) break;
    }
    // drop the still-forming bar
    while (out.length && out[out.length - 1].ts + tf > Date.now()) out.pop();
    return out;
}

async function precompute(candles, onProgress, window = WINDOW) {
    const n = candles.length;
    const pre = new Array(n).fill(null);
    const first = Math.max(window - 1, 260);
    for (let i = first; i < n; i++) {
        pre[i] = evaluateBar(candles.slice(i - Math.min(window, i + 1) + 1, i + 1), false);
        if ((i - first) % 120 === 0) {
            if (onProgress) onProgress((i - first) / Math.max(1, n - first));
            await yieldNow();
        }
    }
    if (onProgress) onProgress(1);
    return { pre, first };
}

// ---------------------------------------------------------------------
// 5. Event-driven simulator (bar level, pessimistic intrabar ordering)
// ---------------------------------------------------------------------
function simulate(candles, pre, params, o = {}) {
    const opt = { ...DEFAULT_SIM, ...o };
    const from = Math.max(opt.from ?? 0, 1), to = Math.min(opt.to ?? candles.length, candles.length);
    const fee = opt.feeBps / 1e4, slip = opt.slipBps / 1e4;
    let cash = opt.equity0 ?? 10000;
    let pos = null, enterNext = null;
    const machine = new SignalMachine(params, opt);
    const equity = new Float64Array(Math.max(0, to - from));
    const trades = [];
    let feesPaid = 0, slipPaid = 0, barsInMarket = 0, turnover = 0;

    const mark = (px) => {
        if (!pos) return cash;
        return pos.side === "long" ? cash + pos.qty * px : cash - pos.qty * px;
    };
    const fillPart = (qty, rawPx, reason, i) => {
        const px = pos.side === "long" ? rawPx * (1 - slip) : rawPx * (1 + slip);
        const exitFee = qty * px * fee;
        const openFeePart = pos.openFee * (qty / pos.qty);
        pos.openFee -= openFeePart;
        const gross = pos.side === "long" ? (px - pos.entry) * qty : (pos.entry - px) * qty;
        if (pos.side === "long") cash += qty * px - exitFee; else cash -= qty * px + exitFee;
        feesPaid += exitFee; slipPaid += Math.abs(rawPx - px) * qty; turnover += qty * px;
        pos.realized += gross - exitFee - openFeePart;
        pos.fees += exitFee + openFeePart;
        pos.qty -= qty;
        pos.lastReason = reason;
        if (pos.qty <= pos.qty0 * 1e-9) {
            trades.push({
                side: pos.side, entryIdx: pos.entryIdx, exitIdx: i, entry: pos.entry, exit: px,
                qty: pos.qty0, pnl: pos.realized, fees: pos.fees,
                R: pos.risk0 > 0 ? pos.realized / pos.risk0 : 0,
                bars: i - pos.entryIdx + 1, reason, families: pos.families,
            });
            pos = null;
        }
    };

    for (let i = from; i < to; i++) {
        const bar = candles[i];
        // 1) enter at the open if the previous close confirmed a setup
        if (enterNext && !pos) {
            const side = enterNext.side;
            const px = side === "long" ? bar.open * (1 + slip) : bar.open * (1 - slip);
            const eq = cash;
            const plan = TB.planTrade(side, px, enterNext.atr, eq, {
                riskPctPerTrade: opt.riskPct, atrStopMult: params.atrStopMult,
                maxNotionalPctPerPosition: opt.maxNotionalPct, tpMultiples: opt.tpMultiples,
            });
            if (plan && plan.size > 0) {
                let qty = plan.size;
                if (side === "long") qty = Math.min(qty, (cash * 0.99) / (px * (1 + fee)));
                if (qty > 0) {
                    const openFee = qty * px * fee;
                    if (side === "long") cash -= qty * px + openFee; else cash += qty * px - openFee;
                    feesPaid += openFee; slipPaid += Math.abs(px - bar.open) * qty; turnover += qty * px;
                    pos = {
                        side, qty, qty0: qty, entry: px, stop: plan.stop, origStop: plan.stop, peak: px,
                        tps: plan.take_profits.map((t) => ({ price: t.price, qty: qty * t.fraction })),
                        openFee, fees: openFee, realized: 0, entryIdx: i,
                        risk0: Math.abs(px - plan.stop) * qty,
                        families: (enterNext.signal && enterNext.signal.signals || []).map((s) => s.family),
                    };
                }
            }
            enterNext = null;
        }
        // 2) manage the open position inside this bar — stop first (pessimistic)
        if (pos) {
            barsInMarket++;
            if (pos.side === "long") {
                if (bar.low <= pos.stop) fillPart(pos.qty, Math.min(bar.open, pos.stop), "sl", i);
                else {
                    for (const tp of pos.tps) {
                        if (!pos || tp.done) continue;
                        if (bar.high >= tp.price) { tp.done = true; fillPart(Math.min(tp.qty, pos.qty), Math.max(bar.open, tp.price), "tp", i); }
                    }
                    if (pos) {
                        pos.tps = pos.tps.filter((t) => !t.done);
                        pos.peak = Math.max(pos.peak, bar.high);
                        const r = Math.abs(pos.entry - pos.origStop);
                        const profitR = r > 0 ? (pos.peak - pos.entry) / r : 0;
                        if (profitR >= 1) pos.stop = Math.max(pos.stop, Math.min(pos.entry + (profitR - 1) * r * 0.5, pos.peak - r * 0.5));
                    }
                }
            } else {
                if (bar.high >= pos.stop) fillPart(pos.qty, Math.max(bar.open, pos.stop), "sl", i);
                else {
                    for (const tp of pos.tps) {
                        if (!pos || tp.done) continue;
                        if (bar.low <= tp.price) { tp.done = true; fillPart(Math.min(tp.qty, pos.qty), Math.min(bar.open, tp.price), "tp", i); }
                    }
                    if (pos) {
                        pos.tps = pos.tps.filter((t) => !t.done);
                        pos.peak = Math.min(pos.peak, bar.low);
                        const r = Math.abs(pos.entry - pos.origStop);
                        const profitR = r > 0 ? (pos.entry - pos.peak) / r : 0;
                        if (profitR >= 1) pos.stop = Math.min(pos.stop, Math.max(pos.entry - (profitR - 1) * r * 0.5, pos.peak + r * 0.5));
                    }
                }
            }
        }
        // 3) end of range: flatten at the close
        if (i === to - 1 && pos) fillPart(pos.qty, bar.close, "eod", i);
        equity[i - from] = mark(bar.close);
        // 4) signal logic at the close (identical to live)
        if (i < to - 1 && pre[i]) {
            const res = machine.onBarClose(pre[i], bar.close, !!pos);
            if (res) enterNext = { side: res.side, atr: pre[i].atr, signal: res.signal };
        }
    }
    return { equity, trades, feesPaid, slipPaid, turnover, exposure: (to - from) ? barsInMarket / (to - from) : 0, from, to };
}

// ---------------------------------------------------------------------
// 6. Statistics + tear sheet
// ---------------------------------------------------------------------
function dailyReturns(candles, equity, from, equity0) {
    const days = [];
    let lastDay = null, lastEq = equity0;
    for (let k = 0; k < equity.length; k++) {
        const day = Math.floor(candles[from + k].ts / 86400e3);
        if (lastDay === null) lastDay = day;
        if (day !== lastDay) { days.push(lastEq); lastDay = day; }
        lastEq = equity[k];
    }
    days.push(lastEq);
    const rets = [];
    let prev = equity0;
    for (const e of days) { rets.push(prev > 0 ? e / prev - 1 : 0); prev = e; }
    return rets;
}

function bootstrapSharpeCI(rets, iters = 1000, seed = 42) {
    if (rets.length < 10) return null;
    const rnd = mulberry32(seed);
    const out = [];
    const n = rets.length;
    for (let b = 0; b < iters; b++) {
        const s = new Array(n);
        for (let i = 0; i < n; i++) s[i] = rets[Math.floor(rnd() * n)];
        const sd = std(s);
        out.push(sd > 0 ? (mean(s) / sd) * Math.sqrt(365) : 0);
    }
    out.sort((a, b) => a - b);
    return { lo: out[Math.floor(iters * 0.025)], hi: out[Math.floor(iters * 0.975)] };
}

function tearSheet(rets, trades, extra = {}) {
    const sd = std(rets);
    const downs = rets.filter((r) => r < 0);
    const dsd = downs.length > 1 ? Math.sqrt(downs.reduce((s, r) => s + r * r, 0) / downs.length) : 0;
    let eq = 1, peak = 1, maxDD = 0;
    for (const r of rets) { eq *= 1 + r; peak = Math.max(peak, eq); maxDD = Math.min(maxDD, eq / peak - 1); }
    const totalReturn = eq - 1;
    const years = rets.length / 365;
    const cagr = years > 0 && eq > 0 ? Math.pow(eq, 1 / years) - 1 : 0;
    const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl <= 0);
    const grossWin = wins.reduce((s, t) => s + t.pnl, 0), grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    return {
        days: rets.length,
        totalReturn, cagr, maxDD,
        sharpe: sd > 0 ? (mean(rets) / sd) * Math.sqrt(365) : 0,
        sortino: dsd > 0 ? (mean(rets) / dsd) * Math.sqrt(365) : 0,
        calmar: maxDD < 0 ? cagr / Math.abs(maxDD) : 0,
        psr: probabilisticSharpe(rets, 0),
        sharpeCI: bootstrapSharpeCI(rets),
        trades: trades.length,
        winRate: trades.length ? wins.length / trades.length : 0,
        profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
        expectancyR: trades.length ? mean(trades.map((t) => t.R)) : 0,
        avgBars: trades.length ? mean(trades.map((t) => t.bars)) : 0,
        ...extra,
    };
}

function downsample(arr, n = 240) {
    if (arr.length <= n) return Array.from(arr);
    const out = [];
    for (let k = 0; k < n; k++) out.push(arr[Math.floor((k * (arr.length - 1)) / (n - 1))]);
    return out;
}

function strategyCorrelationMatrix(pre, first) {
    const names = TB.STRATEGIES.map((s) => s.name);
    const series = names.map(() => []);
    for (let i = first; i < pre.length; i++) {
        if (!pre[i]) continue;
        for (let k = 0; k < names.length; k++) series[k].push(pre[i].dirs[k]);
    }
    const pairs = [];
    for (let a = 0; a < names.length; a++) {
        for (let b = a + 1; b < names.length; b++) {
            const x = series[a], y = series[b];
            const mx = mean(x), my = mean(y);
            let num = 0, sx = 0, sy = 0;
            for (let i = 0; i < x.length; i++) { const dx = x[i] - mx, dy = y[i] - my; num += dx * dy; sx += dx * dx; sy += dy * dy; }
            const c = sx > 0 && sy > 0 ? num / Math.sqrt(sx * sy) : 0;
            pairs.push({ a: names[a], b: names[b], corr: c, sameFamily: FAMILIES[names[a]] === FAMILIES[names[b]] });
        }
    }
    pairs.sort((p, q) => Math.abs(q.corr) - Math.abs(p.corr));
    const avg = (f) => { const s = pairs.filter(f).map((p) => Math.abs(p.corr)); return s.length ? mean(s) : 0; };
    return { top: pairs.slice(0, 8), withinFamily: avg((p) => p.sameFamily), acrossFamily: avg((p) => !p.sameFamily) };
}

// ---------------------------------------------------------------------
// 7. Walk-forward optimisation (rolling train/test, honest OOS)
// ---------------------------------------------------------------------
const PARAM_GRID = (() => {
    const g = [];
    for (const minScore of [1.0, 1.5, 2.0, 2.5])
        for (const agreement of [1, 2])
            for (const atrStopMult of [1.5, 2.0, 2.5]) g.push({ minScore, agreement, atrStopMult });
    return g;
})();

function verdictFor(s, dsr) {
    if (s.trades < 20) return { code: "DATA", label: "ZU WENIG DATEN", tone: "neutral" };
    if (dsr >= 0.95 && s.totalReturn > 0) return { code: "EDGE", label: "EDGE BESTÄTIGT", tone: "green" };
    if (s.psr >= 0.80 && s.totalReturn > 0) return { code: "PROMISING", label: "VIELVERSPRECHEND", tone: "amber" };
    return { code: "NONE", label: "KEINE EDGE", tone: "red" };
}

function walkForward(candles, prepared, o = {}) {
    const { pre, first } = prepared;
    const tf = TF_MS[o.interval || "15m"];
    const barsPerDay = Math.round(86400e3 / tf);
    const train = (o.trainDays || 30) * barsPerDay;
    const test = (o.testDays || 10) * barsPerDay;
    const sim = { ...DEFAULT_SIM, ...(o.sim || {}) };
    const folds = [], oosTrades = [], withinVars = [];
    const oosEquity = [];
    let equity = 10000;
    let oosFrom = null;

    for (let t0 = first + 1; t0 + train + test <= candles.length; t0 += test) {
        let best = null;
        const foldSR = [];
        for (const p of PARAM_GRID) {
            const r = simulate(candles, pre, p, { ...sim, from: t0, to: t0 + train, equity0: 10000 });
            const rets = dailyReturns(candles, r.equity, r.from, 10000);
            const sd = std(rets);
            const sr = sd > 0 ? mean(rets) / sd : 0;
            foldSR.push(sr);
            const score = r.trades.length >= 5 ? sr : -Infinity;
            if (!best || score > best.score) best = { p, score, trades: r.trades.length };
        }
        withinVars.push(Math.pow(std(foldSR), 2));
        const isFrom = t0, isTo = t0 + train, oFrom = isTo, oTo = isTo + test;
        if (oosFrom === null) oosFrom = oFrom;
        const tradeable = best && best.score > 0;
        let foldTrades = 0, foldRet = 0;
        if (tradeable) {
            const r = simulate(candles, pre, best.p, { ...sim, from: oFrom, to: oTo, equity0: equity });
            for (let k = 0; k < r.equity.length; k++) oosEquity.push(r.equity[k]);
            for (const t of r.trades) oosTrades.push(t);
            foldTrades = r.trades.length;
            foldRet = r.equity.length ? r.equity[r.equity.length - 1] / equity - 1 : 0;
            equity = r.equity.length ? r.equity[r.equity.length - 1] : equity;
        } else {
            for (let k = oFrom; k < oTo; k++) oosEquity.push(equity);
        }
        folds.push({
            isFrom: candles[isFrom].ts, oosFrom: candles[oFrom].ts, oosTo: candles[oTo - 1].ts,
            params: tradeable ? best.p : null,
            isSharpe: best && Number.isFinite(best.score) ? best.score * Math.sqrt(365) : null,
            oosTrades: foldTrades, oosReturn: foldRet,
        });
    }
    if (oosFrom === null) return { error: "Zu wenig Historie für Walk-Forward (mindestens 40 Tage nach Warm-up nötig)." };

    const eqArr = Float64Array.from(oosEquity);
    const rets = dailyReturns(candles, eqArr, oosFrom, 10000);
    const feesPaid = oosTrades.reduce((s, t) => s + (t.fees || 0), 0);
    const stats = tearSheet(rets, oosTrades, { feesPaid, finalEquity: equity });
    // Selection bias: pooled within-window variance of the competing variants
    const trialVar = mean(withinVars);
    const dsr = probabilisticSharpe(rets, expectedMaxSharpeFromVar(trialVar, PARAM_GRID.length));
    stats.dsr = dsr;
    stats.trials = PARAM_GRID.length;

    // buy & hold benchmark over the identical OOS window
    const bh = [];
    const p0 = candles[oosFrom].open;
    for (let k = oosFrom; k < oosFrom + eqArr.length; k++) bh.push(10000 * candles[k].close / p0);
    const bhRets = dailyReturns(candles, Float64Array.from(bh), oosFrom, 10000);
    const bench = tearSheet(bhRets, []);

    // family attribution
    const famPnl = {};
    for (const t of oosTrades) {
        const fams = t.families && t.families.length ? t.families : ["other"];
        for (const f of fams) famPnl[f] = (famPnl[f] || 0) + t.pnl / fams.length;
    }
    const last = folds[folds.length - 1];
    const verdict = verdictFor(stats, dsr);
    return {
        symbol: o.symbol, interval: o.interval || "15m",
        from: candles[oosFrom].ts, to: candles[oosFrom + eqArr.length - 1].ts,
        stats, bench, verdict, folds, famPnl,
        alphaReturn: stats.totalReturn - bench.totalReturn,
        correlation: strategyCorrelationMatrix(pre, first),
        live: { params: last ? last.params : null, verdict: verdict.code },
        curve: downsample(Array.from(eqArr)).map((v) => v / 100),
        benchCurve: downsample(bh).map((v) => v / 100),
        oosDailyReturns: rets,
        benchDailyReturns: bhRets,
        trialVar,
        computedAt: Date.now(),
    };
}

// Equal-weight portfolio across symbols, aligned on the most recent common days.
function portfolioSummary(results) {
    const ok = results.filter((r) => r && !r.error && r.oosDailyReturns && r.oosDailyReturns.length);
    if (!ok.length) return null;
    const len = Math.min(...ok.map((r) => r.oosDailyReturns.length));
    const avgTail = (key) => {
        const out = [];
        for (let d = 0; d < len; d++) out.push(mean(ok.map((r) => r[key][r[key].length - len + d] || 0)));
        return out;
    };
    const rets = avgTail("oosDailyReturns");
    const bhRets = avgTail("benchDailyReturns");
    const stats = tearSheet(rets, []);
    const trades = ok.reduce((s, r) => s + r.stats.trades, 0);
    stats.trades = trades;
    stats.expectancyR = trades ? ok.reduce((s, r) => s + r.stats.expectancyR * r.stats.trades, 0) / trades : 0;
    stats.winRate = trades ? ok.reduce((s, r) => s + r.stats.winRate * r.stats.trades, 0) / trades : 0;
    stats.feesPaid = ok.reduce((s, r) => s + (r.stats.feesPaid || 0), 0);
    // every symbol picks its own variant, so the portfolio searched N × symbols configurations
    stats.trials = PARAM_GRID.length * ok.length;
    stats.dsr = probabilisticSharpe(rets, expectedMaxSharpeFromVar(mean(ok.map((r) => r.trialVar || 0)), stats.trials));
    const bench = tearSheet(bhRets, []);
    const verdict = trades < 50 ? { code: "DATA", label: "ZU WENIG DATEN", tone: "neutral" } : verdictFor(stats, stats.dsr);
    return { stats, bench, alphaReturn: stats.totalReturn - bench.totalReturn, verdict, symbols: ok.map((r) => r.symbol) };
}

// ---------------------------------------------------------------------
// 8. Live engine — feeds closed bars into the same SignalMachine
// ---------------------------------------------------------------------
class LiveEngine {
    constructor(opts = {}) {
        this.opts = { ...DEFAULT_SIM, interval: "15m", maxDelayMs: 120e3, ...opts };
        this.state = {};
    }
    _params(symbol) {
        const fn = this.opts.paramsFor;
        const p = typeof fn === "function" ? fn(symbol) : null;
        return p === undefined ? { ...DEFAULT_PARAMS } : p;
    }
    status(symbol) { return this.state[symbol] || null; }
    onCandles(symbol, candles, hasPosition, now = Date.now()) {
        const tf = TF_MS[this.opts.interval] || 900e3;
        if (!candles || candles.length < 262) return null;
        let closed = candles;
        const tail = candles[candles.length - 1];
        if (tail && tail.ts + tf > now) closed = candles.slice(0, -1);
        const params = this._params(symbol);
        let st = this.state[symbol];
        const pkey = JSON.stringify(params);
        if (!st || st.pkey !== pkey) {
            st = this.state[symbol] = { machine: new SignalMachine(params, this.opts), lastTs: 0, pkey, lastPre: null, params };
        }
        const lastBar = closed[closed.length - 1];
        if (lastBar.ts <= st.lastTs) return null;
        const cb = this.opts.confirmBars;
        // On a cold start, replay the last few bars to rebuild a pending watch.
        let startIdx = this.opts.warmReplay === false ? closed.length - 1 : closed.length - 1 - cb;
        if (st.lastTs) {
            // Bars closed while the app was paused are replayed (max one day) so the
            // watch state stays exact and missed entries can be reported honestly.
            const idx = closed.findIndex((c) => c.ts > st.lastTs);
            if (idx >= 0) {
                startIdx = Math.max(idx, closed.length - 96);
                if (startIdx > idx) st.machine.reset();
            } else st.machine.reset();
        }
        startIdx = Math.max(startIdx, 261);
        let decision = null;
        for (let k = startIdx; k < closed.length; k++) {
            const win = closed.slice(Math.max(0, k - WINDOW + 1), k + 1);
            const pre = evaluateBar(win, true);
            const isLast = k === closed.length - 1;
            const res = st.machine.onBarClose(pre, closed[k].close, hasPosition);
            if (isLast) st.lastPre = pre;
            if (res && !isLast && st.lastTs) {
                st.missed = (st.missed || 0) + 1;
                st.lastMissedAt = closed[k].ts + tf;
            }
            if (res && isLast) {
                decision = {
                    symbol, side: res.side, atr: pre.atr, regime: pre.regime, adx: pre.adx,
                    score: res.signal.score, families: res.signal.families, signals: res.signal.signals,
                    params, barTs: closed[k].ts,
                    stale: now - (closed[k].ts + tf) > this.opts.maxDelayMs,
                };
            }
        }
        st.lastTs = lastBar.ts;
        st.lastEvalAt = now;
        if (decision) st.lastDecision = { side: decision.side, at: now, stale: decision.stale };
        st.watch = st.machine.watch ? { side: st.machine.watch.side, trigger: st.machine.watch.trigger, barsLeft: st.machine.watch.barsLeft } : null;
        return decision;
    }
}

// ---------------------------------------------------------------------
// 9. Market microstructure — live order book + aggressor flow (CVD)
// ---------------------------------------------------------------------
class MicroStream {
    constructor(symbols, opts = {}) {
        this.onTrade = typeof opts.onTrade === "function" ? opts.onTrade : null;
        this._lastTradeCb = {};
        this.keys = symbols.map((s) => s.replace("/", "").toLowerCase());
        this.books = {};
        this.flow = {};
        this.ws = null;
        this.retry = 0;
        this.stopped = false;
        this.lastMsg = 0;
    }
    start() {
        const WS = root.WebSocket;
        if (!WS || !this.keys.length) return false;
        this.stopped = false;
        const streams = this.keys.flatMap((k) => [`${k}@aggTrade`, `${k}@depth20@100ms`]).join("/");
        let ws;
        try { ws = new WS(`wss://stream.binance.com:9443/stream?streams=${streams}`); } catch (e) { return false; }
        ws.onopen = () => { this.retry = 0; };
        ws.onmessage = (ev) => this._on(ev.data);
        ws.onerror = () => { try { ws.close(); } catch (e) { /* noop */ } };
        ws.onclose = () => {
            if (this.stopped) return;
            const delay = Math.min(30e3, 1000 * Math.pow(2, this.retry++));
            setTimeout(() => { if (!this.stopped) this.start(); }, delay);
        };
        this.ws = ws;
        return true;
    }
    stop() { this.stopped = true; if (this.ws) try { this.ws.close(); } catch (e) { /* noop */ } }
    _on(raw) {
        let msg;
        try { msg = JSON.parse(typeof raw === "string" ? raw : String(raw)); } catch (e) { return; }
        if (!msg || !msg.stream || !msg.data) return;
        this.lastMsg = Date.now();
        const [key, kind] = msg.stream.split("@");
        const d = msg.data;
        if (kind === "aggTrade") {
            const sec = Math.floor(d.T / 1000);
            const usd = (+d.p) * (+d.q);
            const arr = this.flow[key] || (this.flow[key] = []);
            let b = arr[arr.length - 1];
            if (!b || b.t !== sec) { b = { t: sec, buy: 0, sell: 0 }; arr.push(b); }
            if (d.m) b.sell += usd; else b.buy += usd;   // m=true: buyer is maker → aggressive seller
            while (arr.length && arr[0].t < sec - 3600) arr.shift();
            // at most one price callback per symbol and 250 ms (stop/target checks)
            if (this.onTrade && Date.now() - (this._lastTradeCb[key] || 0) >= 250) {
                this._lastTradeCb[key] = Date.now();
                try { this.onTrade(key.toUpperCase().replace(/USDT$/, "/USDT"), +d.p); } catch (e) { /* caller handles */ }
            }
        } else if (kind && kind.startsWith("depth")) {
            this.books[key] = {
                bids: (d.bids || []).map(([p, q]) => [+p, +q]),
                asks: (d.asks || []).map(([p, q]) => [+p, +q]),
                t: Date.now(),
            };
        }
    }
    book(symbol) {
        const b = this.books[symbol.replace("/", "").toLowerCase()];
        return b && Date.now() - b.t < 5000 && b.bids.length && b.asks.length ? b : null;
    }
    metrics(symbol) {
        const key = symbol.replace("/", "").toLowerCase();
        const book = this.book(symbol);
        const flow = this.flow[key] || [];
        if (!book && !flow.length) return null;
        const out = { symbol, ageMs: book ? Date.now() - book.t : null };
        if (book) {
            const bid = book.bids[0][0], ask = book.asks[0][0], mid = (bid + ask) / 2;
            out.mid = mid;
            out.spreadBps = ((ask - bid) / mid) * 1e4;
            const bidUsd = book.bids.reduce((s, [p, q]) => s + p * q, 0);
            const askUsd = book.asks.reduce((s, [p, q]) => s + p * q, 0);
            out.obi = bidUsd + askUsd > 0 ? (bidUsd - askUsd) / (bidUsd + askUsd) : 0;
            out.depthUsd = bidUsd + askUsd;
        }
        const nowSec = Math.floor(Date.now() / 1000);
        let b5 = 0, s5 = 0, b60 = 0, s60 = 0;
        for (const x of flow) {
            if (x.t >= nowSec - 300) { b5 += x.buy; s5 += x.sell; }
            b60 += x.buy; s60 += x.sell;
        }
        out.cvd5m = b5 - s5;
        out.cvd1h = b60 - s60;
        out.buyShare5m = b5 + s5 > 0 ? b5 / (b5 + s5) : null;
        return out;
    }
}

// Expected fill cost from walking the live book; falls back to the flat model.
function slippageBps(micro, symbol, side, notionalUsd, isExit) {
    const buying = (side === "long" && !isExit) || (side === "short" && isExit);
    const book = micro && micro.book ? micro.book(symbol) : null;
    if (!book || !(notionalUsd > 0)) return DEFAULT_SIM.slipBps;
    const bid = book.bids[0][0], ask = book.asks[0][0], mid = (bid + ask) / 2;
    const levels = buying ? book.asks : book.bids;
    let remaining = notionalUsd, cost = 0, qty = 0;
    for (const [p, q] of levels) {
        const take = Math.min(remaining, p * q);
        cost += take; qty += take / p; remaining -= take;
        if (remaining <= 1e-9) break;
    }
    if (remaining > 1e-9) return 60;   // book too thin for the order
    const vwap = cost / qty;
    const bps = Math.abs(vwap - mid) / mid * 1e4;
    return Math.min(60, Math.max(0.5, bps));
}

// ---------------------------------------------------------------------
// 10. Derivatives positioning — funding, basis, open interest
// ---------------------------------------------------------------------
const _derivCache = {};
async function fetchDerivatives(symbol) {
    const sym = symbol.replace("/", "");
    const c = _derivCache[sym];
    if (c && Date.now() - c.t < 5 * 60e3) return c.v;
    try {
        const base = "https://fapi.binance.com";
        const [pi, fr, oi] = await Promise.all([
            fetch(`${base}/fapi/v1/premiumIndex?symbol=${sym}`).then((r) => r.ok ? r.json() : null),
            fetch(`${base}/fapi/v1/fundingRate?symbol=${sym}&limit=100`).then((r) => r.ok ? r.json() : null),
            fetch(`${base}/futures/data/openInterestHist?symbol=${sym}&period=5m&limit=13`).then((r) => r.ok ? r.json() : null),
        ]);
        if (!pi || pi.code) throw new Error("no perp");
        const funding = +pi.lastFundingRate;
        const hist = Array.isArray(fr) ? fr.map((x) => +x.fundingRate).filter(Number.isFinite) : [];
        const sd = std(hist);
        const v = {
            funding,
            fundingAnnualPct: funding * 3 * 365 * 100,
            fundingZ: sd > 0 ? (funding - mean(hist)) / sd : 0,
            basisBps: (+pi.markPrice - +pi.indexPrice) / +pi.indexPrice * 1e4,
            oiChange1h: Array.isArray(oi) && oi.length > 1 ? +oi[oi.length - 1].sumOpenInterest / +oi[0].sumOpenInterest - 1 : null,
            nextFundingTime: +pi.nextFundingTime,
        };
        _derivCache[sym] = { t: Date.now(), v };
        return v;
    } catch (e) {
        _derivCache[sym] = { t: Date.now(), v: null };
        return null;
    }
}

// Live-only execution & crowding controls. Not alpha — protection against
// paying wide spreads or joining a crowded, over-levered side.
function liveControls(side, micro, deriv) {
    const reasons = [];
    if (micro) {
        if (Number.isFinite(micro.spreadBps) && micro.spreadBps > 10) reasons.push(`Spread ${micro.spreadBps.toFixed(1)} bps > 10`);
        if (Number.isFinite(micro.cvd5m) && Number.isFinite(micro.obi)) {
            if (side === "long" && micro.cvd5m < 0 && micro.obi < -0.35) reasons.push(`Verkaufsdruck: CVD 5m negativ, Orderbuch ${Math.round(micro.obi * 100)}% Ask-lastig`);
            if (side === "short" && micro.cvd5m > 0 && micro.obi > 0.35) reasons.push(`Kaufdruck: CVD 5m positiv, Orderbuch ${Math.round(micro.obi * 100)}% Bid-lastig`);
        }
    }
    if (deriv) {
        if (side === "long" && (deriv.funding >= 0.0005 || deriv.fundingZ >= 3)) reasons.push(`Longs überfüllt: Funding ${(deriv.funding * 100).toFixed(3)}%/8h (z=${deriv.fundingZ.toFixed(1)})`);
        if (side === "short" && (deriv.funding <= -0.0005 || deriv.fundingZ <= -3)) reasons.push(`Shorts überfüllt: Funding ${(deriv.funding * 100).toFixed(3)}%/8h (z=${deriv.fundingZ.toFixed(1)})`);
    }
    return { ok: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------
// 11. Full research run for a list of symbols
// ---------------------------------------------------------------------
async function runResearch(symbols, o = {}, onProgress = () => {}) {
    const results = [];
    for (let s = 0; s < symbols.length; s++) {
        const symbol = symbols[s];
        const base = s / symbols.length, span = 1 / symbols.length;
        try {
            onProgress({ symbol, phase: "Lade Historie", pct: base });
            const candles = o.candlesFor ? await o.candlesFor(symbol) : await fetchKlinesRange(symbol, o.interval || "15m", o.days || 90,
                (p) => onProgress({ symbol, phase: "Lade Historie", pct: base + span * 0.15 * p }));
            const prepared = await precompute(candles, (p) => onProgress({ symbol, phase: "Berechne Signale", pct: base + span * (0.15 + 0.8 * p) }));
            onProgress({ symbol, phase: "Walk-Forward", pct: base + span * 0.97 });
            const r = walkForward(candles, prepared, { ...o, symbol });
            results.push(r.error ? { symbol, error: r.error } : r);
        } catch (e) {
            results.push({ symbol, error: e.message || String(e) });
        }
    }
    onProgress({ phase: "Fertig", pct: 1 });
    return { results, portfolio: portfolioSummary(results), computedAt: Date.now(), days: o.days || 90, interval: o.interval || "15m" };
}

TB.pro = {
    version: "32.0",
    installDemoGuard, isBlockedRequest,
    FAMILIES, FAMILY_LABELS, REGIME_LABELS, REGIME_WEIGHTS, PARAM_GRID, DEFAULT_PARAMS, LEARN_PARAMS, DEFAULT_SIM, WINDOW, TF_MS,
    regimeOf, evaluateBar, signalFrom, SignalMachine,
    fetchKlinesRange, precompute, simulate, walkForward, portfolioSummary, runResearch,
    dailyReturns, tearSheet, probabilisticSharpe, expectedMaxSharpe, expectedMaxSharpeFromVar, bootstrapSharpeCI,
    normCdf, normInv, mean, std,
    LiveEngine, MicroStream, slippageBps, fetchDerivatives, liveControls,
};
})(typeof window !== "undefined" ? window : globalThis);
