/* =====================================================================
 * Trading Bot — pure JavaScript library
 * Indicators, strategies, paper broker, risk manager. No dependencies.
 * ===================================================================== */
window.TB = (function () {

// ---------- helpers ----------
const closes = (c) => c.map((x) => x.close);
const highs  = (c) => c.map((x) => x.high);
const lows   = (c) => c.map((x) => x.low);
const vols   = (c) => c.map((x) => x.volume);

function sma(arr, n) {
    const out = new Array(arr.length).fill(NaN);
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
        sum += arr[i];
        if (i >= n) sum -= arr[i - n];
        if (i >= n - 1) out[i] = sum / n;
    }
    return out;
}

function ema(arr, n) {
    const out = new Array(arr.length).fill(NaN);
    const k = 2 / (n + 1);
    let prev = NaN;
    for (let i = 0; i < arr.length; i++) {
        if (i < n - 1) continue;
        if (isNaN(prev)) {
            let s = 0;
            for (let j = i - n + 1; j <= i; j++) s += arr[j];
            prev = s / n;
        } else {
            prev = arr[i] * k + prev * (1 - k);
        }
        out[i] = prev;
    }
    return out;
}

function rsi(arr, n = 14) {
    const out = new Array(arr.length).fill(NaN);
    if (arr.length < n + 1) return out;
    let gain = 0, loss = 0;
    for (let i = 1; i <= n; i++) {
        const d = arr[i] - arr[i - 1];
        if (d >= 0) gain += d; else loss -= d;
    }
    let ag = gain / n, al = loss / n;
    out[n] = 100 - 100 / (1 + (al === 0 ? Infinity : ag / al));
    for (let i = n + 1; i < arr.length; i++) {
        const d = arr[i] - arr[i - 1];
        const g = Math.max(d, 0);
        const l = Math.max(-d, 0);
        ag = (ag * (n - 1) + g) / n;
        al = (al * (n - 1) + l) / n;
        out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
    return out;
}

function macd(arr, fast = 12, slow = 26, signalN = 9) {
    const f = ema(arr, fast), s = ema(arr, slow);
    const line = f.map((v, i) => v - s[i]);
    const sig = ema(line, signalN);
    const hist = line.map((v, i) => v - sig[i]);
    return { line, signal: sig, hist };
}

function bollinger(arr, n = 20, k = 2) {
    const m = sma(arr, n);
    const upper = [], lower = [], width = [];
    for (let i = 0; i < arr.length; i++) {
        if (i < n - 1 || isNaN(m[i])) { upper.push(NaN); lower.push(NaN); width.push(NaN); continue; }
        let sum = 0;
        for (let j = i - n + 1; j <= i; j++) sum += (arr[j] - m[i]) ** 2;
        const sd = Math.sqrt(sum / n);
        upper.push(m[i] + k * sd);
        lower.push(m[i] - k * sd);
        width.push(2 * k * sd / m[i]);
    }
    return { mid: m, upper, lower, width };
}

function trueRange(h, l, c) {
    const out = [NaN];
    for (let i = 1; i < c.length; i++) {
        out.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
    }
    return out;
}

function atr(h, l, c, n = 14) {
    const tr = trueRange(h, l, c);
    const out = new Array(c.length).fill(NaN);
    let sum = 0;
    for (let i = 1; i <= n; i++) sum += tr[i] || 0;
    out[n] = sum / n;
    for (let i = n + 1; i < c.length; i++) {
        out[i] = (out[i - 1] * (n - 1) + tr[i]) / n;
    }
    return out;
}

function adx(h, l, c, n = 14) {
    const len = c.length;
    const tr = trueRange(h, l, c);
    const plusDM = [0], minusDM = [0];
    for (let i = 1; i < len; i++) {
        const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
        plusDM.push(up > dn && up > 0 ? up : 0);
        minusDM.push(dn > up && dn > 0 ? dn : 0);
    }
    const atr_ = new Array(len).fill(NaN);
    const pDI = new Array(len).fill(NaN);
    const mDI = new Array(len).fill(NaN);
    let a = 0, pd = 0, md = 0;
    for (let i = 1; i <= n; i++) { a += tr[i] || 0; pd += plusDM[i]; md += minusDM[i]; }
    atr_[n] = a; pDI[n] = 100 * pd / a; mDI[n] = 100 * md / a;
    for (let i = n + 1; i < len; i++) {
        a = a - a / n + tr[i]; pd = pd - pd / n + plusDM[i]; md = md - md / n + minusDM[i];
        atr_[i] = a;
        pDI[i] = 100 * pd / a;
        mDI[i] = 100 * md / a;
    }
    const dx = pDI.map((p, i) => Math.abs(p - mDI[i]) / (p + mDI[i]) * 100);
    const adxOut = new Array(len).fill(NaN);
    let sum = 0;
    for (let i = n + 1; i < 2 * n + 1 && i < len; i++) sum += dx[i] || 0;
    if (2 * n + 1 < len) adxOut[2 * n] = sum / n;
    for (let i = 2 * n + 1; i < len; i++) adxOut[i] = (adxOut[i - 1] * (n - 1) + dx[i]) / n;
    return { adx: adxOut, plus_di: pDI, minus_di: mDI };
}

function highest(arr, n) {
    const out = new Array(arr.length).fill(NaN);
    for (let i = n - 1; i < arr.length; i++) {
        let m = -Infinity;
        for (let j = i - n + 1; j <= i; j++) m = Math.max(m, arr[j]);
        out[i] = m;
    }
    return out;
}
function lowest(arr, n) {
    const out = new Array(arr.length).fill(NaN);
    for (let i = n - 1; i < arr.length; i++) {
        let m = Infinity;
        for (let j = i - n + 1; j <= i; j++) m = Math.min(m, arr[j]);
        out[i] = m;
    }
    return out;
}

function donchian(h, l, n = 20) {
    return { upper: highest(h, n), lower: lowest(l, n) };
}

function obv(c, v) {
    const out = [0];
    for (let i = 1; i < c.length; i++) {
        const d = c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0;
        out.push(out[i - 1] + d);
    }
    return out;
}

function stoch(h, l, c, n = 14, d = 3) {
    const hh = highest(h, n), ll = lowest(l, n);
    const k = c.map((v, i) => (hh[i] === ll[i]) ? NaN : 100 * (v - ll[i]) / (hh[i] - ll[i]));
    return { k, d: sma(k, d) };
}

function williamsR(h, l, c, n = 14) {
    const hh = highest(h, n), ll = lowest(l, n);
    return c.map((v, i) => (hh[i] === ll[i]) ? NaN : -100 * (hh[i] - v) / (hh[i] - ll[i]));
}

function cci(h, l, c, n = 20) {
    const tp = c.map((_, i) => (h[i] + l[i] + c[i]) / 3);
    const m = sma(tp, n);
    const out = new Array(c.length).fill(NaN);
    for (let i = n - 1; i < c.length; i++) {
        let md = 0;
        for (let j = i - n + 1; j <= i; j++) md += Math.abs(tp[j] - m[i]);
        md /= n;
        out[i] = md === 0 ? 0 : (tp[i] - m[i]) / (0.015 * md);
    }
    return out;
}

function mfi(h, l, c, v, n = 14) {
    const tp = c.map((_, i) => (h[i] + l[i] + c[i]) / 3);
    const flow = tp.map((x, i) => x * v[i]);
    const out = new Array(c.length).fill(NaN);
    for (let i = n; i < c.length; i++) {
        let pos = 0, neg = 0;
        for (let j = i - n + 1; j <= i; j++) {
            if (j === 0) continue;
            if (tp[j] > tp[j - 1]) pos += flow[j];
            else if (tp[j] < tp[j - 1]) neg += flow[j];
        }
        out[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
    }
    return out;
}

// ---------- strategies ----------
// each returns { side: 'long'|'short'|null, strength: 0..1, strategy: name, reason: '...' }

function stratEmaCross(candles, params = {}) {
    const fast = params.fast || 20, slow = params.slow || 50, trend = params.trend || 200;
    const c = closes(candles);
    if (c.length < trend + 5) return null;
    const ef = ema(c, fast), es = ema(c, slow), et = ema(c, trend);
    const i = c.length - 1;
    const crossUp = ef[i - 1] <= es[i - 1] && ef[i] > es[i];
    const crossDn = ef[i - 1] >= es[i - 1] && ef[i] < es[i];
    const above = c[i] > et[i];
    if (crossUp && above) return { side: "long", strength: 0.8, strategy: "ema_cross",
        reason: `EMA${fast} kreuzt EMA${slow} nach oben, Preis über EMA${trend}` };
    if (crossDn && !above) return { side: "short", strength: 0.8, strategy: "ema_cross",
        reason: `EMA${fast} kreuzt EMA${slow} nach unten, Preis unter EMA${trend}` };
    return null;
}

function stratMacd(candles) {
    const c = closes(candles);
    if (c.length < 40) return null;
    const m = macd(c);
    const i = c.length - 1;
    if (isNaN(m.hist[i - 1])) return null;
    if (m.hist[i - 1] <= 0 && m.hist[i] > 0)
        return { side: "long", strength: 0.7, strategy: "macd_trend", reason: "MACD-Histogramm flippt positiv" };
    if (m.hist[i - 1] >= 0 && m.hist[i] < 0)
        return { side: "short", strength: 0.7, strategy: "macd_trend", reason: "MACD-Histogramm flippt negativ" };
    return null;
}

function stratRsiMeanRev(candles, params = {}) {
    const oversold = params.oversold || 28, overbought = params.overbought || 72;
    const c = closes(candles);
    const r = rsi(c, 14);
    const i = c.length - 1;
    if (isNaN(r[i - 1])) return null;
    if (r[i - 1] < oversold && r[i] >= oversold)
        return { side: "long", strength: 0.65, strategy: "rsi_meanrev",
            reason: `RSI verlässt überverkauften Bereich (${r[i - 1].toFixed(1)}→${r[i].toFixed(1)})` };
    if (r[i - 1] > overbought && r[i] <= overbought)
        return { side: "short", strength: 0.65, strategy: "rsi_meanrev",
            reason: `RSI verlässt überkauften Bereich (${r[i - 1].toFixed(1)}→${r[i].toFixed(1)})` };
    return null;
}

function stratBollingerSqueeze(candles) {
    const c = closes(candles);
    const bb = bollinger(c, 20, 2);
    const i = c.length - 1;
    if (i < 120) return null;
    let minW = Infinity;
    for (let j = i - 120; j < i - 1; j++) if (bb.width[j] < minW) minW = bb.width[j];
    const squeezed = bb.width[i] <= minW * 1.15;
    if (squeezed && c[i] > bb.upper[i - 1] && c[i - 1] <= bb.upper[i - 1])
        return { side: "long", strength: 0.8, strategy: "bollinger_squeeze",
            reason: "Bollinger-Squeeze-Ausbruch nach oben" };
    if (squeezed && c[i] < bb.lower[i - 1] && c[i - 1] >= bb.lower[i - 1])
        return { side: "short", strength: 0.8, strategy: "bollinger_squeeze",
            reason: "Bollinger-Squeeze-Ausbruch nach unten" };
    return null;
}

function stratDonchianBreakout(candles, params = {}) {
    const n = params.period || 55;
    const c = closes(candles), h = highs(candles), l = lows(candles);
    const d = donchian(h, l, n);
    const i = c.length - 1;
    if (isNaN(d.upper[i - 1])) return null;
    if (c[i] > d.upper[i - 1])
        return { side: "long", strength: 0.9, strategy: "donchian_breakout",
            reason: `Donchian${n}-Ausbruch über ${d.upper[i - 1].toFixed(2)}` };
    if (c[i] < d.lower[i - 1])
        return { side: "short", strength: 0.9, strategy: "donchian_breakout",
            reason: `Donchian${n}-Bruch unter ${d.lower[i - 1].toFixed(2)}` };
    return null;
}

function stratMmCrypto(candles) {
    const c = closes(candles), v = vols(candles), h = highs(candles), l = lows(candles);
    if (c.length < 220) return null;
    const e200 = ema(c, 200), e21 = ema(c, 21), e55 = ema(c, 55);
    const r = rsi(c, 14);
    const a = atr(h, l, c, 14);
    const i = c.length - 1;
    const macroUp = c[i] > e200[i];
    const macroDn = c[i] < e200[i];
    const crossUp = e21[i - 1] <= e55[i - 1] && e21[i] > e55[i];
    const crossDn = e21[i - 1] >= e55[i - 1] && e21[i] < e55[i];
    let vAvg = 0;
    for (let j = i - 20; j < i; j++) vAvg += v[j];
    vAvg /= 20;
    const volOk = v[i] >= vAvg * 1.5;
    const distAtr = Math.abs(c[i] - e21[i]) / a[i];
    const notStretched = distAtr < 2.5;
    if (macroUp && crossUp && volOk && r[i] < 70 && notStretched)
        return { side: "long", strength: 0.9, strategy: "mmcrypto_style",
            reason: "Makro-Uptrend + LTF EMA21>EMA55, Volumen 1.5×, RSI ok" };
    if (macroDn && crossDn && volOk && r[i] > 30 && notStretched)
        return { side: "short", strength: 0.9, strategy: "mmcrypto_style",
            reason: "Makro-Downtrend + LTF EMA21<EMA55, Volumen 1.5×, RSI ok" };
    return null;
}

function stratMegaConfluence(candles) {
    const c = closes(candles), h = highs(candles), l = lows(candles), v = vols(candles);
    if (c.length < 220) return null;
    const i = c.length - 1;
    const votes = [];
    const e20 = ema(c, 20), e50 = ema(c, 50), e200 = ema(c, 200);
    votes.push(e20[i] > e50[i] ? 1 : -1);
    votes.push(e50[i] > e200[i] ? 1 : -1);
    const m = macd(c);
    votes.push(m.hist[i] > 0 ? 1 : -1);
    const r = rsi(c, 14)[i];
    votes.push(r > 50 ? 1 : -1);
    const st = stoch(h, l, c);
    votes.push(st.k[i] > st.d[i] ? 1 : -1);
    votes.push(cci(h, l, c, 20)[i] > 0 ? 1 : -1);
    votes.push(williamsR(h, l, c, 14)[i] > -50 ? 1 : -1);
    const o = obv(c, v);
    let oAvg = 0;
    for (let j = i - 20; j < i; j++) oAvg += o[j];
    oAvg /= 20;
    votes.push(o[i] > oAvg ? 1 : -1);
    votes.push(mfi(h, l, c, v, 14)[i] > 50 ? 1 : -1);
    const adxRes = adx(h, l, c, 14);
    if (adxRes.adx[i] > 20) votes.push(adxRes.plus_di[i] > adxRes.minus_di[i] ? 1 : -1);
    const longs = votes.filter((x) => x > 0).length;
    const total = votes.length;
    const longPct = longs / total;
    if (longPct >= 0.70)
        return { side: "long", strength: longPct, strategy: "mega_confluence",
            reason: `${Math.round(longPct * 100)}% der ${total} Indikatoren bullisch` };
    if (longPct <= 0.30)
        return { side: "short", strength: 1 - longPct, strategy: "mega_confluence",
            reason: `${Math.round((1 - longPct) * 100)}% der ${total} Indikatoren bärisch` };
    return null;
}

const STRATEGIES = [
    { name: "ema_cross",          weight: 1.0, fn: stratEmaCross },
    { name: "macd_trend",         weight: 1.0, fn: stratMacd },
    { name: "rsi_meanrev",        weight: 0.7, fn: stratRsiMeanRev },
    { name: "bollinger_squeeze",  weight: 0.8, fn: stratBollingerSqueeze },
    { name: "donchian_breakout",  weight: 1.0, fn: stratDonchianBreakout },
    { name: "mmcrypto_style",     weight: 1.4, fn: stratMmCrypto },
    { name: "mega_confluence",    weight: 1.6, fn: stratMegaConfluence },
];

function ensemble(candles, minScore = 1.5, agreement = 2) {
    const scores = { long: 0, short: 0 };
    const sigs = { long: [], short: [] };
    for (const s of STRATEGIES) {
        try {
            const r = s.fn(candles);
            if (!r || !r.side) continue;
            scores[r.side] += s.weight * r.strength;
            sigs[r.side].push(r);
        } catch (e) { /* strategy failed silently */ }
    }
    const winner = scores.long > scores.short ? "long" : scores.short > scores.long ? "short" : null;
    if (!winner) return { side: null, score: 0, signals: [] };
    const s = scores[winner], sg = sigs[winner];
    if (s < minScore || sg.length < agreement) return { side: null, score: s, signals: sg };
    return { side: winner, score: s, signals: sg };
}

// ---------- risk manager ----------
function planTrade(side, entry, atrValue, equity, cfg) {
    if (atrValue <= 0 || entry <= 0 || equity <= 0) return null;
    const riskAmount = equity * (cfg.riskPctPerTrade || 1.0) / 100;
    const stopDist = (cfg.atrStopMult || 2.0) * atrValue;
    const stop = side === "long" ? entry - stopDist : entry + stopDist;
    const size = riskAmount / stopDist;
    const tpMults = cfg.tpMultiples || [1.5, 2.5, 4.0];
    const tps = tpMults.map((mult, i) => {
        const frac = i === tpMults.length - 1 ? 1 - (tpMults.length - 1) * (1 / tpMults.length) : 1 / tpMults.length;
        const price = side === "long" ? entry + mult * stopDist : entry - mult * stopDist;
        return { price, fraction: frac };
    });
    return { side, entry, stop, size, riskAmount, take_profits: tps };
}

function forecast(plan) {
    const r = Math.abs(plan.entry - plan.stop);
    let weighted = 0, maxProfit = 0;
    for (const tp of plan.take_profits) {
        const diff = plan.side === "long" ? tp.price - plan.entry : plan.entry - tp.price;
        weighted += diff * plan.size * tp.fraction;
        maxProfit = Math.max(maxProfit, diff * plan.size);
    }
    let ev = -0.5 * plan.riskAmount;
    for (const tp of plan.take_profits) {
        const diff = plan.side === "long" ? tp.price - plan.entry : plan.entry - tp.price;
        ev += (0.5 / plan.take_profits.length) * diff * plan.size;
    }
    return {
        weighted, maxProfit, ev,
        lossAtStop: plan.riskAmount,
        rrFinal: Math.abs(plan.take_profits[plan.take_profits.length - 1].price - plan.entry) / r,
    };
}

function assessRisk(plan, candles, openPositions, equity) {
    const factors = [];
    let score = 0;
    const posPct = plan.riskAmount / equity * 100;
    const f1 = Math.min(posPct * 4, 40);
    score += f1;
    factors.push({ name: "Positionsrisiko", value: `${posPct.toFixed(2)}% des Depots`, impact: f1.toFixed(1) });
    if (candles.length >= 60) {
        const a = atr(highs(candles), lows(candles), closes(candles), 14);
        const i = a.length - 1;
        let avg = 0, cnt = 0;
        for (let j = Math.max(0, i - 49); j < i; j++) if (!isNaN(a[j])) { avg += a[j]; cnt++; }
        avg /= Math.max(cnt, 1);
        const ratio = a[i] / avg;
        const f2 = ratio > 1 ? Math.min((ratio - 1) * 20, 25) : 0;
        score += f2;
        factors.push({ name: "Volatilität", value: `ATR ${ratio.toFixed(2)}× 50-Bar-Ø`, impact: f2.toFixed(1) });
    }
    if (candles.length >= 210) {
        const e200 = ema(closes(candles), 200);
        const i = e200.length - 1;
        const against = (plan.side === "long" && plan.entry < e200[i]) || (plan.side === "short" && plan.entry > e200[i]);
        if (against) { score += 15; factors.push({ name: "Trend-Kontext", value: "gegen EMA200", impact: "15" }); }
        else factors.push({ name: "Trend-Kontext", value: "mit EMA200", impact: "0" });
    }
    const rV = rsi(closes(candles), 14);
    const rl = rV[rV.length - 1];
    let f4 = 0;
    if (plan.side === "long" && rl > 75) f4 = (rl - 75) * 1.2;
    if (plan.side === "short" && rl < 25) f4 = (25 - rl) * 1.2;
    score += f4;
    factors.push({ name: "RSI-Extrem", value: `RSI ${rl.toFixed(1)}`, impact: f4.toFixed(1) });
    const nOpen = Object.keys(openPositions).length;
    if (nOpen >= 3) {
        const f5 = Math.min((nOpen - 2) * 3, 15);
        score += f5;
        factors.push({ name: "Depot-Auslastung", value: `${nOpen} offene`, impact: `${f5}` });
    }
    score = Math.min(Math.max(score, 0), 100);
    const label = score < 20 ? "niedrig" : score < 40 ? "moderat" : score < 60 ? "erhöht" : score < 80 ? "hoch" : "extrem";
    const color = score < 20 ? "green" : score < 40 ? "yellow" : score < 60 ? "orange" : score < 80 ? "red" : "purple";
    return { score: Math.round(score), label, color, factors };
}

// ---------- paper broker with localStorage persistence ----------
class PaperBroker {
    constructor(startingBalance = 10000) {
        this.startingBalance = startingBalance;
        this.load();
    }
    load() {
        const raw = localStorage.getItem("tb_broker");
        if (raw) {
            try {
                const d = JSON.parse(raw);
                this.cash = d.cash;
                this.positions = d.positions || {};
                this.journal = d.journal || [];
                this.startingBalance = d.startingBalance || 10000;
                return;
            } catch (e) { /* fall through */ }
        }
        this.cash = this.startingBalance;
        this.positions = {};
        this.journal = [];
        this.save();
    }
    save() {
        localStorage.setItem("tb_broker", JSON.stringify({
            cash: this.cash, positions: this.positions, journal: this.journal,
            startingBalance: this.startingBalance,
        }));
    }
    reset() {
        localStorage.removeItem("tb_broker");
        this.load();
    }
    equity(marks) {
        let e = this.cash;
        for (const sym in this.positions) {
            const p = this.positions[sym];
            const price = (marks || {})[sym] || p.entry;
            if (p.side === "long") e += p.qty * price;
            else e += p.qty * (2 * p.entry - price);
        }
        return e;
    }
    realizedPnl() {
        return this.journal.filter((j) => j.kind === "close").reduce((s, j) => s + (j.pnl || 0), 0);
    }
    submit(symbol, side, qty, price, meta = {}) {
        const notional = qty * price;
        if (side === "long") this.cash -= notional;
        else this.cash += notional;
        this.positions[symbol] = {
            symbol, side, qty, entry: price,
            stop: meta.stop || 0, opened_at: new Date().toISOString(),
            take_profits: (meta.take_profits || []).map((t) => ({ price: t.price, qty: qty * t.fraction })),
            original_qty: qty, meta,
        };
        this.journal.push({
            ts: new Date().toISOString(), kind: "open", symbol, side, price, qty,
            strategy: meta.strategy || "",
        });
        this.save();
        return this.positions[symbol];
    }
    close(symbol, price, fraction = 1) {
        const p = this.positions[symbol];
        if (!p) return null;
        const qty = p.qty * Math.min(fraction, 1);
        let pnl;
        if (p.side === "long") { pnl = (price - p.entry) * qty; this.cash += qty * price; }
        else { pnl = (p.entry - price) * qty; this.cash += qty * (2 * p.entry - price); }
        p.qty -= qty;
        if (p.qty <= 1e-12) delete this.positions[symbol];
        this.journal.push({
            ts: new Date().toISOString(), kind: "close", symbol, side: p.side,
            price, qty, pnl, r_multiple: 0,
        });
        this.save();
        return { pnl, qty };
    }
    onPrice(symbol, price) {
        const p = this.positions[symbol];
        if (!p) return [];
        const events = [];
        if (p.stop) {
            if (p.side === "long" && price <= p.stop) {
                const r = this.close(symbol, price, 1);
                if (r) events.push({ kind: "sl", ...r });
                return events;
            }
            if (p.side === "short" && price >= p.stop) {
                const r = this.close(symbol, price, 1);
                if (r) events.push({ kind: "sl", ...r });
                return events;
            }
        }
        const remain = [];
        for (const tp of p.take_profits) {
            const hit = (p.side === "long" && price >= tp.price) || (p.side === "short" && price <= tp.price);
            if (hit) {
                const cur = this.positions[symbol];
                if (!cur || cur.qty <= 0) continue;
                const frac = Math.min(1, tp.qty / cur.qty);
                const r = this.close(symbol, price, frac);
                if (r) events.push({ kind: "tp", ...r });
            } else remain.push(tp);
        }
        if (this.positions[symbol]) this.positions[symbol].take_profits = remain;
        this.save();
        return events;
    }
}

// ---------- Binance public API fetcher ----------
async function fetchKlines(symbol, interval = "15m", limit = 500) {
    const sym = symbol.replace("/", "");
    const url = `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${limit}`;
    const raw = await fetch(url).then((r) => r.json());
    if (!Array.isArray(raw)) throw new Error("no data");
    return raw.map((k) => ({
        ts: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
    }));
}

async function fetchPrice(symbol) {
    const sym = symbol.replace("/", "");
    const url = `https://api.binance.com/api/v3/ticker/price?symbol=${sym}`;
    const d = await fetch(url).then((r) => r.json());
    return +d.price;
}

async function fetchFearGreed() {
    try {
        const d = await fetch("https://api.alternative.me/fng/?limit=1").then((r) => r.json());
        return { value: +d.data[0].value, label: d.data[0].value_classification };
    } catch { return null; }
}

// ---------- exports ----------
return {
    sma, ema, rsi, macd, bollinger, atr, adx, donchian, obv, stoch, williamsR, cci, mfi,
    closes, highs, lows, vols,
    STRATEGIES, ensemble,
    planTrade, forecast, assessRisk,
    PaperBroker,
    fetchKlines, fetchPrice, fetchFearGreed,
};
})();
