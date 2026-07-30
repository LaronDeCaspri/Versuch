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

// =========================================================================
// v8: More indicators for confluence-based safer trades
// =========================================================================

// Ichimoku Cloud (Tenkan, Kijun, Senkou A/B, Chikou)
function ichimoku(h, l, c, tenkanN = 9, kijunN = 26, senkouBN = 52, displace = 26) {
    const highLow = (arr, n) => {
        const out = new Array(arr.length).fill(NaN);
        for (let i = n - 1; i < arr.length; i++) {
            let hi = -Infinity, lo = Infinity;
            for (let j = i - n + 1; j <= i; j++) {
                if (h[j] > hi) hi = h[j];
                if (l[j] < lo) lo = l[j];
            }
            out[i] = (hi + lo) / 2;
        }
        return out;
    };
    const tenkan = highLow(h, tenkanN);
    const kijun = highLow(h, kijunN);
    const senkouA = tenkan.map((v, i) => isNaN(v) || isNaN(kijun[i]) ? NaN : (v + kijun[i]) / 2);
    const senkouB = highLow(h, senkouBN);
    const chikou = c.map((_, i) => i >= displace ? c[i - displace] : NaN);
    return { tenkan, kijun, senkouA, senkouB, chikou };
}

// VWAP — anchored to session start (first bar in the window)
function vwap(h, l, c, v) {
    const out = new Array(c.length).fill(NaN);
    let cumPV = 0, cumV = 0;
    for (let i = 0; i < c.length; i++) {
        const typical = (h[i] + l[i] + c[i]) / 3;
        cumPV += typical * v[i];
        cumV += v[i];
        out[i] = cumV > 0 ? cumPV / cumV : NaN;
    }
    return out;
}

// VWAP bands: 1 & 2 stddev from anchored VWAP
function vwapBands(h, l, c, v) {
    const mid = vwap(h, l, c, v);
    const upper1 = new Array(c.length).fill(NaN);
    const lower1 = new Array(c.length).fill(NaN);
    const upper2 = new Array(c.length).fill(NaN);
    const lower2 = new Array(c.length).fill(NaN);
    let cumV = 0, cumVar = 0;
    for (let i = 0; i < c.length; i++) {
        cumV += v[i];
        const typical = (h[i] + l[i] + c[i]) / 3;
        cumVar += v[i] * (typical - mid[i]) ** 2;
        const sd = cumV > 0 ? Math.sqrt(cumVar / cumV) : 0;
        upper1[i] = mid[i] + sd;
        lower1[i] = mid[i] - sd;
        upper2[i] = mid[i] + 2 * sd;
        lower2[i] = mid[i] - 2 * sd;
    }
    return { mid, upper1, lower1, upper2, lower2 };
}

// Keltner Channels — EMA(20) ± ATR(10) * mult
function keltner(h, l, c, emaN = 20, atrN = 10, mult = 2) {
    const m = ema(c, emaN);
    const a = atr(h, l, c, atrN);
    return {
        mid: m,
        upper: m.map((v, i) => v + mult * a[i]),
        lower: m.map((v, i) => v - mult * a[i]),
    };
}

// Chandelier Exit — trailing stop N*ATR from N-bar high (long) / low (short)
function chandelier(h, l, c, n = 22, mult = 3) {
    const a = atr(h, l, c, n);
    const longStop = new Array(c.length).fill(NaN);
    const shortStop = new Array(c.length).fill(NaN);
    for (let i = n; i < c.length; i++) {
        let hi = -Infinity, lo = Infinity;
        for (let j = i - n + 1; j <= i; j++) {
            if (h[j] > hi) hi = h[j];
            if (l[j] < lo) lo = l[j];
        }
        longStop[i] = hi - mult * a[i];
        shortStop[i] = lo + mult * a[i];
    }
    return { longStop, shortStop };
}

// RSI/MACD divergence detection (bullish or bearish)
// Returns { bullish: bool, bearish: bool } based on recent swings
function detectDivergence(closes, oscillator, lookback = 30) {
    if (closes.length < lookback + 5) return { bullish: false, bearish: false };
    const priceEnd = closes.length - 1;
    // find last two significant lows in price + oscillator (bullish div)
    // find last two significant highs (bearish div)
    let bull = false, bear = false;
    // simple: compare current vs bar 15 ago
    const past = priceEnd - 15;
    if (past > 0) {
        const priceLower = closes[priceEnd] < closes[past] * 0.995;
        const priceHigher = closes[priceEnd] > closes[past] * 1.005;
        const oscHigher = oscillator[priceEnd] > oscillator[past];
        const oscLower = oscillator[priceEnd] < oscillator[past];
        bull = priceLower && oscHigher;
        bear = priceHigher && oscLower;
    }
    return { bullish: bull, bearish: bear };
}

// Regime detection — trending vs ranging via ADX and Bollinger width
function detectRegime(h, l, c) {
    const adxVals = adx(h, l, c, 14);
    const bb = bollinger(c, 20, 2);
    const adxNow = adxVals[adxVals.length - 1];
    const bbWidth = bb.width[bb.width.length - 1];
    const atrVals = atr(h, l, c, 14);
    const atrPct = (atrVals[atrVals.length - 1] / c[c.length - 1]) * 100;
    let trend, volatility;
    if (adxNow >= 25) trend = "trending";
    else if (adxNow >= 18) trend = "weak-trend";
    else trend = "ranging";
    if (atrPct >= 4) volatility = "panic";
    else if (atrPct >= 2) volatility = "high";
    else if (atrPct >= 1) volatility = "normal";
    else volatility = "calm";
    return {
        trend, volatility,
        adx: adxNow, bbWidth, atrPct,
        // recommended strategy family per regime
        recommend: trend === "trending"
            ? "Trend-Strategien (EMA-Cross, Donchian, MACD)"
            : trend === "ranging"
            ? "Mean-Rev-Strategien (RSI, Bollinger-Bounce)"
            : "Vorsicht — gemischtes Regime, konservativ handeln",
    };
}

// =========================================================================
// v9: Candlestick + Chart Pattern Detection Engine
// Pattern descriptions in plain German, historical stats via computeStats
// =========================================================================

const PATTERN_INFO = {
    "doji":              { name: "Doji", type: "candle", bias: "reversal", desc: "Der Kurs schliesst fast dort wo er eröffnet hat. Zeigt Unentschlossenheit — Käufer und Verkäufer im Gleichgewicht. Oft Vorbote einer Trendumkehr." },
    "hammer":            { name: "Hammer", type: "candle", bias: "bull", desc: "Kleiner Körper oben, langer Docht nach unten. Käufer haben die Verkäufer nach starkem Abverkauf zurückgedrängt. Bullisches Umkehrsignal." },
    "shooting_star":     { name: "Shooting Star", type: "candle", bias: "bear", desc: "Kleiner Körper unten, langer Docht nach oben. Verkäufer haben eine Rally abgewürgt. Bärisches Umkehrsignal." },
    "bull_engulfing":    { name: "Bullish Engulfing", type: "candle", bias: "bull", desc: "Grüne Kerze verschlingt die vorherige rote komplett. Käufer übernehmen aggressiv die Kontrolle — starkes Kauf-Signal." },
    "bear_engulfing":    { name: "Bearish Engulfing", type: "candle", bias: "bear", desc: "Rote Kerze verschlingt die vorherige grüne. Verkäufer sind zurück in der Kontrolle — starkes Verkauf-Signal." },
    "morning_star":      { name: "Morning Star", type: "candle", bias: "bull", desc: "3-Kerzen-Muster: grosse rote → kleine Kerze → grosse grüne. Der Boden ist erreicht, Trendwende bullish." },
    "evening_star":      { name: "Evening Star", type: "candle", bias: "bear", desc: "3-Kerzen-Muster: grosse grüne → kleine Kerze → grosse rote. Das Top ist erreicht, Trendwende bearish." },
    "harami":            { name: "Harami", type: "candle", bias: "reversal", desc: "Kleine Kerze innerhalb der vorherigen grossen. Zeigt nachlassenden Trend-Druck — mögliche Umkehr." },
    "piercing":          { name: "Piercing Line", type: "candle", bias: "bull", desc: "Rote Kerze, dann grüne die mehr als halb in die rote hineinschliesst. Bullishe Umkehr im Abwärtstrend." },
    "dark_cloud":        { name: "Dark Cloud Cover", type: "candle", bias: "bear", desc: "Grüne Kerze, dann rote die mehr als halb in die grüne hineinschliesst. Bearishe Umkehr im Aufwärtstrend." },
    "three_soldiers":    { name: "Drei weisse Soldaten", type: "candle", bias: "bull", desc: "Drei aufeinanderfolgende grüne Kerzen, jede höher als die letzte. Sehr starkes bullishes Momentum." },
    "three_crows":       { name: "Drei schwarze Raben", type: "candle", bias: "bear", desc: "Drei aufeinanderfolgende rote Kerzen, jede tiefer als die letzte. Sehr starkes bearishes Momentum." },
    "double_top":        { name: "Doppel-Top", type: "chart", bias: "bear", desc: "Kurs testet zweimal denselben Widerstand und wird abgewiesen. Klassisches Umkehrsignal — der Trend endet, Verkäufer übernehmen." },
    "double_bottom":     { name: "Doppel-Boden", type: "chart", bias: "bull", desc: "Kurs testet zweimal denselben Support und hält. Klassisches bullishes Umkehrsignal — Käufer bekommen die Kontrolle." },
    "hns":               { name: "Head &amp; Shoulders", type: "chart", bias: "bear", desc: "Drei Peaks: linke Schulter, Kopf (höchster), rechte Schulter. Bruch der Nackenlinie = starkes Verkaufssignal. Ziel: Höhe des Kopfes nach unten." },
    "inv_hns":           { name: "Inverse Head &amp; Shoulders", type: "chart", bias: "bull", desc: "Umgedreht: drei Tiefs mit dem mittleren am tiefsten. Klassisches Boden-Muster — Trendumkehr nach oben." },
    "asc_triangle":      { name: "Aufsteigendes Dreieck", type: "chart", bias: "bull", desc: "Waagerechter Widerstand oben + steigende Tiefs unten. Käufer werden aggressiver — Ausbruch nach oben wahrscheinlich." },
    "desc_triangle":     { name: "Absteigendes Dreieck", type: "chart", bias: "bear", desc: "Waagerechter Support unten + fallende Highs oben. Verkäufer werden aggressiver — Ausbruch nach unten wahrscheinlich." },
    "sym_triangle":      { name: "Symmetrisches Dreieck", type: "chart", bias: "continuation", desc: "Konvergierende Trendlinien. Konsolidierung — Bruch in Trendrichtung wahrscheinlich." },
    "bull_flag":         { name: "Bull-Flagge", type: "chart", bias: "bull", desc: "Steile Rally + kurze Konsolidierung im Abwärts-Kanal. Fortsetzung des Aufwärtstrends nach Ausbruch." },
    "bear_flag":         { name: "Bear-Flagge", type: "chart", bias: "bear", desc: "Steiler Absturz + kurze Konsolidierung im Aufwärts-Kanal. Fortsetzung des Abwärtstrends nach Ausbruch." },
    "rising_wedge":      { name: "Steigender Keil", type: "chart", bias: "bear", desc: "Steigende Highs + steigende Tiefs, aber konvergierend. Trotz Anstieg schwächelt Momentum — bearishe Umkehr." },
    "falling_wedge":     { name: "Fallender Keil", type: "chart", bias: "bull", desc: "Fallende Highs + fallende Tiefs, aber konvergierend. Verkäufer verlieren Momentum — bullishe Umkehr." },
    "cup_handle":        { name: "Cup and Handle", type: "chart", bias: "bull", desc: "U-förmiger Boden + kurze Konsolidierung rechts. William-O'Neil-Klassiker — sehr bullishes Fortsetzungsmuster." },
};

// -------- CANDLESTICK PATTERNS --------
function _bodySize(c)  { return Math.abs(c.close - c.open); }
function _upperWick(c) { return c.high - Math.max(c.open, c.close); }
function _lowerWick(c) { return Math.min(c.open, c.close) - c.low; }
function _range(c)     { return c.high - c.low; }

function _detectDoji(c) {
    const rng = _range(c);
    if (rng === 0) return false;
    return _bodySize(c) / rng < 0.10;
}
function _detectHammer(c) {
    const rng = _range(c);
    if (rng === 0) return false;
    const body = _bodySize(c);
    return _lowerWick(c) > 2 * body && _upperWick(c) < body * 0.5 && body / rng > 0.1;
}
function _detectShootingStar(c) {
    const rng = _range(c);
    if (rng === 0) return false;
    const body = _bodySize(c);
    return _upperWick(c) > 2 * body && _lowerWick(c) < body * 0.5 && body / rng > 0.1;
}
function _detectBullEngulfing(prev, curr) {
    return prev.close < prev.open
        && curr.close > curr.open
        && curr.open < prev.close
        && curr.close > prev.open;
}
function _detectBearEngulfing(prev, curr) {
    return prev.close > prev.open
        && curr.close < curr.open
        && curr.open > prev.close
        && curr.close < prev.open;
}
function _detectMorningStar(c1, c2, c3) {
    const bear1 = c1.close < c1.open && _bodySize(c1) / _range(c1) > 0.5;
    const small2 = _bodySize(c2) / _range(c1) < 0.3;
    const bull3 = c3.close > c3.open && c3.close > (c1.open + c1.close) / 2;
    return bear1 && small2 && bull3;
}
function _detectEveningStar(c1, c2, c3) {
    const bull1 = c1.close > c1.open && _bodySize(c1) / _range(c1) > 0.5;
    const small2 = _bodySize(c2) / _range(c1) < 0.3;
    const bear3 = c3.close < c3.open && c3.close < (c1.open + c1.close) / 2;
    return bull1 && small2 && bear3;
}
function _detectHarami(prev, curr) {
    const prevBody = _bodySize(prev);
    const currBody = _bodySize(curr);
    if (prevBody < 1e-9 || currBody / prevBody > 0.6) return false;
    const prevTop = Math.max(prev.open, prev.close);
    const prevBot = Math.min(prev.open, prev.close);
    return Math.max(curr.open, curr.close) < prevTop && Math.min(curr.open, curr.close) > prevBot;
}
function _detectPiercing(prev, curr) {
    if (prev.close >= prev.open) return false;             // prev must be red
    if (curr.close <= curr.open) return false;             // curr must be green
    const prevMid = (prev.open + prev.close) / 2;
    return curr.open < prev.close && curr.close > prevMid && curr.close < prev.open;
}
function _detectDarkCloud(prev, curr) {
    if (prev.close <= prev.open) return false;             // prev must be green
    if (curr.close >= curr.open) return false;             // curr must be red
    const prevMid = (prev.open + prev.close) / 2;
    return curr.open > prev.close && curr.close < prevMid && curr.close > prev.open;
}
function _detectThreeSoldiers(c1, c2, c3) {
    return c1.close > c1.open && c2.close > c2.open && c3.close > c3.open
        && c2.close > c1.close && c3.close > c2.close
        && c2.open > c1.open && c3.open > c2.open;
}
function _detectThreeCrows(c1, c2, c3) {
    return c1.close < c1.open && c2.close < c2.open && c3.close < c3.open
        && c2.close < c1.close && c3.close < c2.close
        && c2.open < c1.open && c3.open < c2.open;
}

// -------- CHART PATTERNS (need swings) --------
function _findSwings(candles, lookback = 5) {
    // pivot-based swing detection: bar is a swing high if higher than N bars each side
    const swings = [];
    for (let i = lookback; i < candles.length - lookback; i++) {
        let isHigh = true, isLow = true;
        for (let j = 1; j <= lookback; j++) {
            if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
            if (candles[i].low  >= candles[i - j].low  || candles[i].low  >= candles[i + j].low)  isLow = false;
        }
        if (isHigh) swings.push({ i, type: "high", price: candles[i].high, ts: candles[i].ts });
        else if (isLow) swings.push({ i, type: "low", price: candles[i].low, ts: candles[i].ts });
    }
    return swings;
}

function _detectDoubleTop(candles, swings, tolPct = 0.02) {
    if (swings.length < 3) return null;
    const recent = swings.slice(-6).filter((s) => s.type === "high");
    if (recent.length < 2) return null;
    const [a, b] = recent.slice(-2);
    if (Math.abs(a.price - b.price) / a.price > tolPct) return null;
    // require a low between them
    const between = swings.filter((s) => s.i > a.i && s.i < b.i && s.type === "low");
    if (!between.length) return null;
    const valley = Math.min(...between.map((s) => s.price));
    if (valley >= a.price * 0.98) return null;                  // require meaningful valley
    return { peaks: [a, b], neckline: valley, priceTarget: valley - (a.price - valley) };
}

function _detectDoubleBottom(candles, swings, tolPct = 0.02) {
    if (swings.length < 3) return null;
    const recent = swings.slice(-6).filter((s) => s.type === "low");
    if (recent.length < 2) return null;
    const [a, b] = recent.slice(-2);
    if (Math.abs(a.price - b.price) / a.price > tolPct) return null;
    const between = swings.filter((s) => s.i > a.i && s.i < b.i && s.type === "high");
    if (!between.length) return null;
    const peak = Math.max(...between.map((s) => s.price));
    if (peak <= a.price * 1.02) return null;
    return { troughs: [a, b], neckline: peak, priceTarget: peak + (peak - a.price) };
}

function _detectHns(candles, swings) {
    if (swings.length < 5) return null;
    const highs = swings.slice(-10).filter((s) => s.type === "high");
    if (highs.length < 3) return null;
    const [ls, head, rs] = highs.slice(-3);
    // head must be higher than shoulders, shoulders roughly equal
    if (head.price <= ls.price || head.price <= rs.price) return null;
    if (Math.abs(ls.price - rs.price) / ls.price > 0.05) return null;
    const lows = swings.filter((s) => s.i > ls.i && s.i < rs.i && s.type === "low");
    if (lows.length < 2) return null;
    const neckline = (lows[0].price + lows[lows.length - 1].price) / 2;
    return { leftShoulder: ls, head, rightShoulder: rs, neckline,
             priceTarget: neckline - (head.price - neckline) };
}

function _detectInvHns(candles, swings) {
    if (swings.length < 5) return null;
    const lows = swings.slice(-10).filter((s) => s.type === "low");
    if (lows.length < 3) return null;
    const [ls, head, rs] = lows.slice(-3);
    if (head.price >= ls.price || head.price >= rs.price) return null;
    if (Math.abs(ls.price - rs.price) / ls.price > 0.05) return null;
    const highs = swings.filter((s) => s.i > ls.i && s.i < rs.i && s.type === "high");
    if (highs.length < 2) return null;
    const neckline = (highs[0].price + highs[highs.length - 1].price) / 2;
    return { leftShoulder: ls, head, rightShoulder: rs, neckline,
             priceTarget: neckline + (neckline - head.price) };
}

function _detectTriangle(candles, swings) {
    if (swings.length < 4) return null;
    const highs = swings.slice(-8).filter((s) => s.type === "high").slice(-3);
    const lows  = swings.slice(-8).filter((s) => s.type === "low").slice(-3);
    if (highs.length < 2 || lows.length < 2) return null;
    const hFirst = highs[0].price, hLast = highs[highs.length - 1].price;
    const lFirst = lows[0].price, lLast = lows[lows.length - 1].price;
    const hSlope = (hLast - hFirst) / hFirst;
    const lSlope = (lLast - lFirst) / lFirst;
    // ascending: flat top (|hSlope| < 1%), rising bottoms (lSlope > 2%)
    if (Math.abs(hSlope) < 0.01 && lSlope > 0.02) return { kind: "asc_triangle", res: hLast, sup: lLast };
    if (Math.abs(lSlope) < 0.01 && hSlope < -0.02) return { kind: "desc_triangle", res: hLast, sup: lLast };
    if (hSlope < -0.01 && lSlope > 0.01) return { kind: "sym_triangle", res: hLast, sup: lLast };
    return null;
}

function _detectWedge(candles, swings) {
    if (swings.length < 4) return null;
    const highs = swings.slice(-8).filter((s) => s.type === "high").slice(-3);
    const lows  = swings.slice(-8).filter((s) => s.type === "low").slice(-3);
    if (highs.length < 2 || lows.length < 2) return null;
    const hSlope = (highs[highs.length - 1].price - highs[0].price) / highs[0].price;
    const lSlope = (lows[lows.length - 1].price - lows[0].price) / lows[0].price;
    // rising wedge: both up but highs slope < lows slope (converging up)
    if (hSlope > 0.01 && lSlope > 0.02 && lSlope > hSlope) return { kind: "rising_wedge" };
    if (hSlope < -0.02 && lSlope < -0.01 && hSlope < lSlope) return { kind: "falling_wedge" };
    return null;
}

function _detectFlag(candles) {
    // simple: last 20 bars, find strong impulse (10+ bars) then small counter-move (5-8 bars)
    if (candles.length < 25) return null;
    const impulse = candles.slice(-20, -8);
    const flag = candles.slice(-8);
    const impStart = impulse[0].close, impEnd = impulse[impulse.length - 1].close;
    const impMove = (impEnd - impStart) / impStart;
    if (Math.abs(impMove) < 0.05) return null;                  // impulse < 5% = not strong enough
    const flagStart = flag[0].close, flagEnd = flag[flag.length - 1].close;
    const flagMove = (flagEnd - flagStart) / flagStart;
    // flag counter-move should be < 40% of impulse and OPPOSITE direction
    if (Math.abs(flagMove) > Math.abs(impMove) * 0.4) return null;
    if (impMove > 0 && flagMove < 0) return { kind: "bull_flag", impMove, flagMove };
    if (impMove < 0 && flagMove > 0) return { kind: "bear_flag", impMove, flagMove };
    return null;
}

function _detectCupHandle(candles, swings) {
    // Simplified: find U-shape in last 30-60 bars + small pullback at end
    if (candles.length < 40) return null;
    const window = candles.slice(-40);
    const highs = window.map((c) => c.high);
    const lefth = highs[0], righth = highs[highs.length - 1];
    if (Math.abs(lefth - righth) / lefth > 0.05) return null;   // rim heights similar
    const bottom = Math.min(...highs);
    const bottomIdx = highs.indexOf(bottom);
    if (bottomIdx < 8 || bottomIdx > 32) return null;           // bottom near middle
    if ((lefth - bottom) / lefth < 0.10) return null;           // meaningful cup depth
    // handle: small pullback in last 5-8 bars
    const handle = candles.slice(-8);
    const handleLow = Math.min(...handle.map((c) => c.low));
    if (handleLow < bottom + (lefth - bottom) * 0.5) return null;  // handle too deep
    return { rim: (lefth + righth) / 2, cupDepth: lefth - bottom };
}

// Main detector — returns { patternKey: metadata }
function detectPatterns(candles) {
    if (!candles || candles.length < 30) return {};
    const found = {};
    const n = candles.length;
    // candlestick — last 3 bars
    if (n >= 1) {
        const c = candles[n - 1];
        if (_detectDoji(c))         found.doji = { at: n - 1 };
        if (_detectHammer(c))       found.hammer = { at: n - 1 };
        if (_detectShootingStar(c)) found.shooting_star = { at: n - 1 };
    }
    if (n >= 2) {
        const prev = candles[n - 2], curr = candles[n - 1];
        if (_detectBullEngulfing(prev, curr)) found.bull_engulfing = { at: n - 1 };
        if (_detectBearEngulfing(prev, curr)) found.bear_engulfing = { at: n - 1 };
        if (_detectHarami(prev, curr))         found.harami = { at: n - 1 };
        if (_detectPiercing(prev, curr))       found.piercing = { at: n - 1 };
        if (_detectDarkCloud(prev, curr))      found.dark_cloud = { at: n - 1 };
    }
    if (n >= 3) {
        const c1 = candles[n - 3], c2 = candles[n - 2], c3 = candles[n - 1];
        if (_detectMorningStar(c1, c2, c3))    found.morning_star = { at: n - 1 };
        if (_detectEveningStar(c1, c2, c3))    found.evening_star = { at: n - 1 };
        if (_detectThreeSoldiers(c1, c2, c3))  found.three_soldiers = { at: n - 1 };
        if (_detectThreeCrows(c1, c2, c3))     found.three_crows = { at: n - 1 };
    }
    // chart patterns
    const swings = _findSwings(candles, 5);
    if (swings.length >= 3) {
        const dt = _detectDoubleTop(candles, swings);
        if (dt) found.double_top = dt;
        const db = _detectDoubleBottom(candles, swings);
        if (db) found.double_bottom = db;
        const hns = _detectHns(candles, swings);
        if (hns) found.hns = hns;
        const ihns = _detectInvHns(candles, swings);
        if (ihns) found.inv_hns = ihns;
        const tri = _detectTriangle(candles, swings);
        if (tri) found[tri.kind] = tri;
        const wed = _detectWedge(candles, swings);
        if (wed) found[wed.kind] = wed;
    }
    const flg = _detectFlag(candles);
    if (flg) found[flg.kind] = flg;
    const cup = _detectCupHandle(candles, swings);
    if (cup) found.cup_handle = cup;
    return found;
}

// Compute historical stats for a pattern across a candle series
// For each occurrence: return N bars later, mark win if bias-correct
function computePatternStats(candles, patternKey, lookAheadBars = 10) {
    const info = PATTERN_INFO[patternKey];
    if (!info) return null;
    const occurrences = [];
    // scan through history detecting only THIS pattern per bar
    for (let i = 30; i < candles.length - lookAheadBars; i++) {
        const slice = candles.slice(0, i + 1);
        const detected = detectPatterns(slice);
        if (!(patternKey in detected)) continue;
        const startPrice = candles[i].close;
        const futureBars = candles.slice(i + 1, i + 1 + lookAheadBars);
        const endPrice = futureBars[futureBars.length - 1].close;
        const returnPct = (endPrice - startPrice) / startPrice * 100;
        const win = info.bias === "bull" ? returnPct > 0
                  : info.bias === "bear" ? returnPct < 0
                  : Math.abs(returnPct) > 0.5;                 // reversal: any move
        occurrences.push({ i, startPrice, endPrice, returnPct, win });
    }
    if (!occurrences.length) return null;
    const wins = occurrences.filter((o) => o.win).length;
    const avgReturn = occurrences.reduce((s, o) => s + o.returnPct, 0) / occurrences.length;
    const bestReturn = Math.max(...occurrences.map((o) => o.returnPct));
    const worstReturn = Math.min(...occurrences.map((o) => o.returnPct));
    return {
        count: occurrences.length,
        winRate: wins / occurrences.length,
        avgReturn, bestReturn, worstReturn,
        lookAheadBars,
    };
}

// Chain-fetch historical klines back N years
async function fetchHistory(symbol, interval = "1d", years = 5, progressCb = null) {
    const sym = symbol.replace("/", "");
    const intervalMs = {
        "1m": 60, "5m": 300, "15m": 900, "30m": 1800,
        "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800,
    }[interval] * 1000;
    const perBatch = 1000;
    const now = Date.now();
    const startTs = now - years * 365 * 86400 * 1000;
    let all = [];
    let endTime = now;
    let requests = 0;
    while (endTime > startTs && requests < 100) {              // safety cap
        const url = `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&endTime=${endTime}&limit=${perBatch}`;
        const raw = await fetch(url).then((r) => r.json()).catch(() => []);
        if (!Array.isArray(raw) || !raw.length) break;
        const batch = raw.map((k) => ({
            ts: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
        }));
        all = batch.concat(all);
        endTime = batch[0].ts - 1;
        requests++;
        if (progressCb) progressCb({ loaded: all.length, requests, oldest: new Date(batch[0].ts) });
        if (batch.length < perBatch) break;
        await new Promise((r) => setTimeout(r, 150));           // rate-limit friendly
    }
    // dedupe by ts
    const seen = new Set();
    return all.filter((c) => { if (seen.has(c.ts)) return false; seen.add(c.ts); return true; });
}

// Confluence score — how many independent bullish/bearish signals agree
function confluenceScore(candles) {
    if (!candles || candles.length < 100) return null;
    const c = closes(candles), h = highs(candles), l = lows(candles), v = vols(candles);
    const i = c.length - 1;
    const signals = { bull: [], bear: [] };
    const push = (side, name) => signals[side].push(name);

    // 1. EMA cross
    const e20 = ema(c, 20), e50 = ema(c, 50), e200 = ema(c, 200);
    if (e20[i] > e50[i] && c[i] > e200[i]) push("bull", "EMA-Trend");
    if (e20[i] < e50[i] && c[i] < e200[i]) push("bear", "EMA-Trend");

    // 2. MACD histogram
    const mac = macd(c);
    if (mac.hist[i] > 0 && mac.hist[i] > mac.hist[i - 1]) push("bull", "MACD");
    if (mac.hist[i] < 0 && mac.hist[i] < mac.hist[i - 1]) push("bear", "MACD");

    // 3. RSI
    const r = rsi(c, 14);
    if (r[i] < 30) push("bull", "RSI-oversold");
    if (r[i] > 70) push("bear", "RSI-overbought");
    if (r[i] > 55 && r[i] < 70) push("bull", "RSI-strength");
    if (r[i] < 45 && r[i] > 30) push("bear", "RSI-weakness");

    // 4. Bollinger position
    const bb = bollinger(c, 20, 2);
    if (c[i] < bb.lower[i]) push("bull", "BB-untere");
    if (c[i] > bb.upper[i]) push("bear", "BB-obere");

    // 5. Ichimoku cloud
    const ich = ichimoku(h, l, c);
    if (c[i] > Math.max(ich.senkouA[i], ich.senkouB[i])) push("bull", "Ichimoku-Cloud");
    if (c[i] < Math.min(ich.senkouA[i], ich.senkouB[i])) push("bear", "Ichimoku-Cloud");

    // 6. VWAP position
    const vw = vwap(h, l, c, v);
    if (c[i] > vw[i]) push("bull", "VWAP");
    if (c[i] < vw[i]) push("bear", "VWAP");

    // 7. Keltner breakout
    const kc = keltner(h, l, c);
    if (c[i] > kc.upper[i]) push("bull", "Keltner-Break");
    if (c[i] < kc.lower[i]) push("bear", "Keltner-Break");

    // 8. Divergence RSI
    const div = detectDivergence(c, r, 30);
    if (div.bullish) push("bull", "RSI-Divergenz");
    if (div.bearish) push("bear", "RSI-Divergenz");

    // 9. Stochastic
    const st = stoch(h, l, c, 14, 3);
    if (st.k[i] > st.d[i] && st.k[i] < 30) push("bull", "Stoch-Kreuz");
    if (st.k[i] < st.d[i] && st.k[i] > 70) push("bear", "Stoch-Kreuz");

    // 10. Volume above 20-avg (confirmation)
    const volAvg = sma(v, 20)[i];
    const volConfirm = v[i] > volAvg * 1.3;
    if (volConfirm && signals.bull.length >= signals.bear.length) push("bull", "Volumen-Bestätigung");
    if (volConfirm && signals.bear.length > signals.bull.length) push("bear", "Volumen-Bestätigung");

    // 11. ADX trend strength
    const adxVals = adx(h, l, c, 14);
    if (adxVals[i] > 25) {
        if (e20[i] > e50[i]) push("bull", "ADX-stark");
        else push("bear", "ADX-stark");
    }

    // 12. Donchian breakout
    const don = donchian(h, l, 20);
    if (c[i] > don.upper[i - 1]) push("bull", "Donchian-High");
    if (c[i] < don.lower[i - 1]) push("bear", "Donchian-Low");

    const bullN = signals.bull.length;
    const bearN = signals.bear.length;
    const total = 12;
    const net = bullN - bearN;
    const side = net > 2 ? "long" : net < -2 ? "short" : "flat";
    const score = Math.max(bullN, bearN);
    return {
        bull: signals.bull, bear: signals.bear,
        bullCount: bullN, bearCount: bearN, total,
        score, net, side,
        confidence: score >= 8 ? "sehr hoch" : score >= 6 ? "hoch" : score >= 4 ? "mittel" : "niedrig",
    };
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

// ---------- trader personas ----------

function stratSorosReflexivity(candles) {
    const c = closes(candles), h = highs(candles), l = lows(candles);
    if (c.length < 60) return null;
    const a = atr(h, l, c, 14);
    const i = c.length - 1;
    const move = c[i] - c[i - 20];
    const extension = move / a[i];
    const d = donchian(h, l, 20);
    const price = c[i];
    if (extension > 4 && price < d.lower[i - 1])
        return { side: "short", strength: 0.95, strategy: "soros_reflexivity",
            reason: `Reflexives Top: 20-Bar-Extension ${extension.toFixed(1)}× ATR + Donchian-Bruch` };
    if (extension < -4 && price > d.upper[i - 1])
        return { side: "long", strength: 0.95, strategy: "soros_reflexivity",
            reason: `Kapitulation-Reversal: ${extension.toFixed(1)}× ATR + Donchian-Hoch-Bruch` };
    return null;
}

function stratBuffettValue(candles) {
    const c = closes(candles), v = vols(candles);
    if (c.length < 220) return null;
    const i = c.length - 1;
    let peak = -Infinity;
    for (let j = i - 200; j <= i; j++) peak = Math.max(peak, c[j]);
    const drawdown = (peak - c[i]) / peak;
    const r = rsi(c, 14)[i];
    const o = obv(c, v);
    let oAvg = 0;
    for (let j = i - 20; j < i; j++) oAvg += o[j];
    oAvg /= 20;
    const obvRising = o[i] > oAvg;
    if (drawdown >= 0.30 && r < 35 && obvRising)
        return { side: "long", strength: 0.85, strategy: "buffett_value",
            reason: `Wert-Akkumulation: DD ${(drawdown*100).toFixed(1)}%, RSI ${r.toFixed(1)}, OBV steigt` };
    return null;
}

function stratPtjCrash(candles) {
    const c = closes(candles), h = highs(candles), l = lows(candles);
    if (c.length < 220) return null;
    const i = c.length - 1;
    const a = atr(h, l, c, 14);
    let avgAtr = 0, cnt = 0;
    for (let j = Math.max(0, i - 49); j < i; j++) if (!isNaN(a[j])) { avgAtr += a[j]; cnt++; }
    avgAtr /= Math.max(cnt, 1);
    const volExp = a[i] > avgAtr * 1.5;
    const e200 = ema(c, 200);
    const brokeDn = c[i - 1] >= e200[i - 1] && c[i] < e200[i];
    const brokeUp = c[i - 1] <= e200[i - 1] && c[i] > e200[i];
    if (volExp && brokeDn)
        return { side: "short", strength: 0.9, strategy: "ptj_crash",
            reason: `Regime-Shift: ATR-Spike + EMA200-Bruch nach unten` };
    if (volExp && brokeUp)
        return { side: "long", strength: 0.9, strategy: "ptj_crash",
            reason: `Regime-Shift: ATR-Spike + EMA200-Bruch nach oben` };
    return null;
}

function stratPaulsonBubble(candles) {
    const c = closes(candles);
    if (c.length < 80) return null;
    const i = c.length - 1;
    const slopeNow = c[i] - c[i - 20];
    const slopePrev = c[i - 20] - c[i - 40];
    const r = rsi(c, 14)[i];
    const bb = bollinger(c, 20, 2);
    let walking = 0;
    for (let j = i - 4; j <= i; j++) if (c[j] > bb.upper[j] * 0.99) walking++;
    const o = candles[i].open, cl = candles[i].close;
    const o1 = candles[i - 1].open, c1 = candles[i - 1].close;
    const bearishEng = cl < o && c1 > o1 && cl < o1 && o > c1;
    if (slopePrev > 0 && slopeNow > slopePrev * 2 && r > 80 && walking >= 3 && bearishEng)
        return { side: "short", strength: 0.95, strategy: "paulson_bubble",
            reason: `Bubble-Short: Slope×2 + RSI ${r.toFixed(1)} + oberes BB + Engulfing` };
    return null;
}

function stratLivermorePivot(candles) {
    const c = closes(candles), v = vols(candles);
    const n = 60;
    if (c.length < n + 5) return null;
    const i = c.length - 1;
    let hh = -Infinity, ll = Infinity, vAvg = 0;
    for (let j = i - n; j < i; j++) {
        hh = Math.max(hh, c[j]);
        ll = Math.min(ll, c[j]);
        vAvg += v[j];
    }
    vAvg /= n;
    const volOk = v[i] > vAvg * 1.5;
    if (c[i] > hh && volOk)
        return { side: "long", strength: 0.9, strategy: "livermore_pivot",
            reason: `Pivotaler Hoch-Bruch ${hh.toFixed(2)} mit Volumen ${(v[i]/vAvg).toFixed(1)}×` };
    if (c[i] < ll && volOk)
        return { side: "short", strength: 0.9, strategy: "livermore_pivot",
            reason: `Pivotaler Tief-Bruch ${ll.toFixed(2)} mit Volumen ${(v[i]/vAvg).toFixed(1)}×` };
    return null;
}

function stratDalioAllWeather(candles) {
    const c = closes(candles), h = highs(candles), l = lows(candles);
    if (c.length < 210) return null;
    const i = c.length - 1;
    const e20 = ema(c, 20), e200 = ema(c, 200);
    const bothUp = c[i] > e20[i] && e20[i] > e200[i];
    const bothDn = c[i] < e20[i] && e20[i] < e200[i];
    const adxRes = adx(h, l, c, 14);
    const regime = adxRes.adx[i] > 20 && adxRes.adx[i] < 40;
    const prevAbove = c[i - 1] > e20[i - 1];
    if (bothUp && regime && !prevAbove)
        return { side: "long", strength: 0.75, strategy: "dalio_allweather",
            reason: `Regime-Alignment aufwärts, ADX ${adxRes.adx[i].toFixed(1)}` };
    if (bothDn && regime && prevAbove)
        return { side: "short", strength: 0.75, strategy: "dalio_allweather",
            reason: `Regime-Alignment abwärts, ADX ${adxRes.adx[i].toFixed(1)}` };
    return null;
}

function stratTempletonPessimism(candles) {
    const c = closes(candles);
    if (c.length < 60) return null;
    const i = c.length - 1;
    const r = rsi(c, 14);
    const rmin = Math.min(...r.slice(i - 20, i + 1).filter((x) => !isNaN(x)));
    if (r[i] < 25 && r[i] > rmin && c[i] > c[i - 1])
        return { side: "long", strength: 0.85, strategy: "templeton_pessimism",
            reason: `Maximum Pessimismus: RSI ${r[i].toFixed(1)}, Wende beginnt` };
    return null;
}

function stratAckmanConviction(candles) {
    const c = closes(candles), h = highs(candles), l = lows(candles), v = vols(candles);
    if (c.length < 210) return null;
    const i = c.length - 1;
    const e20 = ema(c, 20), e50 = ema(c, 50), e200 = ema(c, 200);
    const adxRes = adx(h, l, c, 14);
    const m = macd(c);
    const mfiVal = mfi(h, l, c, v, 14)[i];
    const stackUp = e20[i] > e50[i] && e50[i] > e200[i] && c[i] > e20[i];
    const stackDn = e20[i] < e50[i] && e50[i] < e200[i] && c[i] < e20[i];
    const hist3 = [m.hist[i - 2], m.hist[i - 1], m.hist[i]];
    if (stackUp && adxRes.adx[i] > 25 && hist3.every((x) => x > 0) && mfiVal > 55)
        return { side: "long", strength: 1.0, strategy: "ackman_conviction",
            reason: `Konviktion long: EMA-Stack + ADX ${adxRes.adx[i].toFixed(1)} + MFI ${mfiVal.toFixed(1)}` };
    if (stackDn && adxRes.adx[i] > 25 && hist3.every((x) => x < 0) && mfiVal < 45)
        return { side: "short", strength: 1.0, strategy: "ackman_conviction",
            reason: `Konviktion short: EMA-Stack + ADX ${adxRes.adx[i].toFixed(1)} + MFI ${mfiVal.toFixed(1)}` };
    return null;
}

function stratWeinsteinStages(candles) {
    const c = closes(candles), h = highs(candles), l = lows(candles), v = vols(candles);
    if (c.length < 60) return null;
    const i = c.length - 1;
    const e30 = ema(c, 30);
    const slope = e30[i] - e30[i - 10];
    const adxRes = adx(h, l, c, 14);
    let recentHi = -Infinity, recentLo = Infinity, vAvg = 0;
    for (let j = i - 30; j < i; j++) {
        recentHi = Math.max(recentHi, c[j]);
        recentLo = Math.min(recentLo, c[j]);
        vAvg += v[j];
    }
    vAvg /= 30;
    const volOk = v[i] > vAvg * 1.4;
    if (c[i] > recentHi && slope > 0 && adxRes.adx[i] > 20 && volOk)
        return { side: "long", strength: 0.85, strategy: "weinstein_stages",
            reason: `Weinstein Stufe 2: Ausbruch über ${recentHi.toFixed(2)}, EMA30 steigend` };
    if (c[i] < recentLo && slope < 0 && adxRes.adx[i] > 20 && volOk)
        return { side: "short", strength: 0.85, strategy: "weinstein_stages",
            reason: `Weinstein Stufe 4: Bruch unter ${recentLo.toFixed(2)}, EMA30 fallend` };
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
    { name: "soros_reflexivity",  weight: 1.3, fn: stratSorosReflexivity },
    { name: "buffett_value",      weight: 1.2, fn: stratBuffettValue },
    { name: "ptj_crash",          weight: 1.3, fn: stratPtjCrash },
    { name: "paulson_bubble",     weight: 1.3, fn: stratPaulsonBubble },
    { name: "livermore_pivot",    weight: 1.1, fn: stratLivermorePivot },
    { name: "dalio_allweather",   weight: 1.0, fn: stratDalioAllWeather },
    { name: "templeton_pessimism",weight: 1.1, fn: stratTempletonPessimism },
    { name: "ackman_conviction",  weight: 1.5, fn: stratAckmanConviction },
    { name: "weinstein_stages",   weight: 1.2, fn: stratWeinsteinStages },
];

function ensemble(candles, minScore = 1.5, agreement = 2, adaptiveWeights = null) {
    const scores = { long: 0, short: 0 };
    const sigs = { long: [], short: [] };
    for (const s of STRATEGIES) {
        try {
            const r = s.fn(candles);
            if (!r || !r.side) continue;
            const adaptive = adaptiveWeights?.[s.name] || 1.0;
            scores[r.side] += s.weight * r.strength * adaptive;
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
    // hard cap: position notional at most (equity / max_positions) so several trades fit
    const maxNotional = equity * (cfg.maxNotionalPctPerPosition || 20) / 100;
    let size = riskAmount / stopDist;
    if (size * entry > maxNotional) size = maxNotional / entry;
    if (size <= 0) return null;
    const tpMults = cfg.tpMultiples || [1.5, 2.5, 4.0];
    const tps = tpMults.map((mult, i) => {
        const frac = i === tpMults.length - 1 ? 1 - (tpMults.length - 1) * (1 / tpMults.length) : 1 / tpMults.length;
        const price = side === "long" ? entry + mult * stopDist : entry - mult * stopDist;
        return { price, fraction: frac };
    });
    // actual risk after size cap
    const actualRisk = size * stopDist;
    return { side, entry, stop, size, riskAmount: actualRisk, take_profits: tps };
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
    static SCHEMA_VERSION = 3;                                // bump when accounting logic changes
    constructor(startingBalance = 10000, opts = {}) {
        this.startingBalance = startingBalance;
        this.isolated = !!opts.isolated;                       // no localStorage in isolated mode
        this.load();
    }
    load() {
        if (this.isolated) {
            this.cash = this.startingBalance;
            this.positions = {};
            this.journal = [];
            this.schemaVersion = PaperBroker.SCHEMA_VERSION;
            return;
        }
        const raw = localStorage.getItem("tb_broker");
        if (raw) {
            try {
                const d = JSON.parse(raw);
                this.cash = d.cash;
                this.positions = d.positions || {};
                this.journal = d.journal || [];
                this.startingBalance = d.startingBalance || 10000;
                this.schemaVersion = d.schemaVersion || 0;
                if (this.schemaVersion < PaperBroker.SCHEMA_VERSION) {
                    console.warn("[TB] broker schema outdated, migrating (closing all positions).");
                    const kept = this.journal.filter((e) => e.kind === "close");
                    this.cash = this.startingBalance;
                    this.positions = {};
                    this.journal = kept;
                    this.schemaVersion = PaperBroker.SCHEMA_VERSION;
                    this.save();
                    try { window.dispatchEvent(new CustomEvent("tb-autoheal")); } catch (e) {}
                    return;
                }
                this._autoHeal();
                return;
            } catch (e) { /* fall through */ }
        }
        this.cash = this.startingBalance;
        this.positions = {};
        this.journal = [];
        this.schemaVersion = PaperBroker.SCHEMA_VERSION;
        this.save();
    }
    _autoHeal() {
        // Compute expected equity (no marks): cash + sum of position notionals at entry (long +, short -)
        // If actual "no-marks" equity is way off from starting + realized PnL, state is corrupt.
        let expected = this.cash;
        for (const sym in this.positions) {
            const p = this.positions[sym];
            expected += (p.side === "long") ? p.qty * p.entry : -p.qty * p.entry;
        }
        const realized = this.journal.filter((e) => e.kind === "close").reduce((s, e) => s + (e.pnl || 0), 0);
        const sane = this.startingBalance + realized;
        const drift = Math.abs(expected - sane);
        const corruptDrift = drift > this.startingBalance * 0.05;
        const negCash = this.cash < -this.startingBalance * 0.02;
        const oversizedCash = this.cash > this.startingBalance * 1.3;   // cash > 130% start = probably from double-crediting shorts
        if (corruptDrift || negCash || oversizedCash) {
            console.warn(`[TB] auto-heal: state corruption detected. expected=${expected.toFixed(2)} sane=${sane.toFixed(2)} cash=${this.cash.toFixed(2)}. Resetting portfolio to ${this.startingBalance}, keeping closed-trade journal.`);
            const kept = this.journal.filter((e) => e.kind === "close");
            this.cash = this.startingBalance;
            this.positions = {};
            this.journal = kept;
            this.save();
            try { window.dispatchEvent(new CustomEvent("tb-autoheal")); } catch (e) {}
        }
    }
    save() {
        if (this.isolated) return;
        localStorage.setItem("tb_broker", JSON.stringify({
            cash: this.cash, positions: this.positions, journal: this.journal,
            startingBalance: this.startingBalance,
            schemaVersion: PaperBroker.SCHEMA_VERSION,
        }));
    }
    reset() {
        if (this.isolated) { this.load(); return; }
        localStorage.removeItem("tb_broker");
        this.load();
    }
    equity(marks) {
        // LONG: cash decreased at open by qty*entry, current value = qty*price.
        //   equity contribution = +qty*price  →  net = cash + qty*price
        // SHORT: cash increased at open by qty*entry (sale proceeds), buy-back cost = qty*price.
        //   equity contribution = -qty*price  →  net = cash - qty*price = orig + qty*(entry-price)
        let e = this.cash;
        for (const sym in this.positions) {
            const p = this.positions[sym];
            const price = (marks || {})[sym] || p.entry;
            if (p.side === "long") e += p.qty * price;
            else e -= p.qty * price;
        }
        return e;
    }
    realizedPnl() {
        return this.journal.filter((j) => j.kind === "close").reduce((s, j) => s + (j.pnl || 0), 0);
    }
    submit(symbol, side, qty, price, meta = {}) {
        // enforce cash-only (no leverage) for spot paper trading
        const desiredNotional = qty * price;
        if (side === "long") {
            const affordable = Math.min(this.cash * 0.99, desiredNotional);
            if (affordable <= 0) return null;
            qty = affordable / price;
        }
        const notional = qty * price;
        if (side === "long") this.cash -= notional;
        else this.cash += notional;
        this.positions[symbol] = {
            symbol, side, qty, entry: price,
            stop: meta.stop || 0, original_stop: meta.stop || 0,
            opened_at: new Date().toISOString(),
            take_profits: (meta.take_profits || []).map((t) => ({ price: t.price, qty: qty * t.fraction })),
            original_qty: qty, meta,
            trailing_moves: 0,           // how many times stop moved up
            peak_price: price,            // highest (long) / lowest (short) since open
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
        if (p.side === "long") {
            // sell qty units at current price
            pnl = (price - p.entry) * qty;
            this.cash += qty * price;
        } else {
            // buy back qty units at current price to close short
            pnl = (p.entry - price) * qty;
            this.cash -= qty * price;
        }
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
        // ---- trailing stop ----
        // once profit >= 1R move stop to breakeven, then every 0.5R further trail by 0.5R
        if (p.original_stop && p.entry && p.stop) {
            const r = Math.abs(p.entry - p.original_stop);
            if (r > 0) {
                if (p.side === "long") {
                    p.peak_price = Math.max(p.peak_price || price, price);
                    const profitR = (p.peak_price - p.entry) / r;
                    if (profitR >= 1.0) {
                        const desiredStop = p.entry + (profitR - 1.0) * r * 0.5;
                        const newStop = Math.max(p.stop, Math.min(desiredStop, p.peak_price - r * 0.5));
                        if (newStop > p.stop + 1e-9) {
                            p.stop = newStop;
                            p.trailing_moves++;
                            events.push({ kind: "trail", newStop, profitR });
                        }
                    }
                } else {
                    p.peak_price = Math.min(p.peak_price || price, price);
                    const profitR = (p.entry - p.peak_price) / r;
                    if (profitR >= 1.0) {
                        const desiredStop = p.entry - (profitR - 1.0) * r * 0.5;
                        const newStop = Math.min(p.stop, Math.max(desiredStop, p.peak_price + r * 0.5));
                        if (newStop < p.stop - 1e-9) {
                            p.stop = newStop;
                            p.trailing_moves++;
                            events.push({ kind: "trail", newStop, profitR });
                        }
                    }
                }
                if (events.length) this.save();
            }
        }
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

// 24h ticker data — one call for all symbols
async function fetch24hTickers(symbols) {
    try {
        const url = "https://api.binance.com/api/v3/ticker/24hr";
        const all = await fetch(url).then((r) => r.json());
        const wanted = new Set(symbols.map((s) => s.replace("/", "")));
        const out = {};
        for (const t of all) {
            if (!wanted.has(t.symbol)) continue;
            const sym = t.symbol.replace(/USDT$/, "") + "/USDT";
            out[sym] = {
                symbol: sym,
                priceChangePct: parseFloat(t.priceChangePercent),
                lastPrice: parseFloat(t.lastPrice),
                high: parseFloat(t.highPrice),
                low: parseFloat(t.lowPrice),
                volumeUSD: parseFloat(t.quoteVolume),
                trades: parseInt(t.count),
            };
        }
        return out;
    } catch (e) { return {}; }
}

async function fetchFearGreed() {
    try {
        const d = await fetch("https://api.alternative.me/fng/?limit=1").then((r) => r.json());
        return { value: +d.data[0].value, label: d.data[0].value_classification };
    } catch { return null; }
}

// CoinGecko global market data — BTC dominance, total market cap
async function fetchGlobalMarket() {
    try {
        const d = await fetch("https://api.coingecko.com/api/v3/global").then((r) => r.json());
        const g = d?.data;
        if (!g) return null;
        return {
            btcDominance: g.market_cap_percentage?.btc ?? null,
            ethDominance: g.market_cap_percentage?.eth ?? null,
            totalMcap: g.total_market_cap?.usd ?? null,
            totalVolume: g.total_volume?.usd ?? null,
            mcapChange24h: g.market_cap_change_percentage_24h_usd ?? null,
            activeCoins: g.active_cryptocurrencies ?? null,
        };
    } catch { return null; }
}

// CoinGecko trending coins
async function fetchTrending() {
    try {
        const d = await fetch("https://api.coingecko.com/api/v3/search/trending").then((r) => r.json());
        const coins = (d?.coins || []).slice(0, 10).map((x) => ({
            id: x.item.id, name: x.item.name, symbol: x.item.symbol,
            rank: x.item.market_cap_rank, score: x.item.score,
        }));
        return coins;
    } catch { return []; }
}

// Frankfurter.app free EUR/USD rate — no key needed
async function fetchEurRate() {
    try {
        const d = await fetch("https://api.frankfurter.app/latest?from=USD&to=EUR").then((r) => r.json());
        return d?.rates?.EUR ?? null;
    } catch { return null; }
}

// On-chain: hashrate + mempool from mempool.space
async function fetchOnChain() {
    try {
        const [mempool, fees, hashrate] = await Promise.all([
            fetch("https://mempool.space/api/mempool").then((r) => r.json()).catch(() => null),
            fetch("https://mempool.space/api/v1/fees/recommended").then((r) => r.json()).catch(() => null),
            fetch("https://mempool.space/api/v1/mining/hashrate/1d").then((r) => r.json()).catch(() => null),
        ]);
        return {
            mempoolSize: mempool?.count ?? null,
            mempoolVsize: mempool?.vsize ?? null,
            fastFee: fees?.fastestFee ?? null,
            halfFee: fees?.halfHourFee ?? null,
            hourFee: fees?.hourFee ?? null,
            hashrate: hashrate?.currentHashrate ?? null,
            difficulty: hashrate?.currentDifficulty ?? null,
        };
    } catch { return null; }
}

// Rolling Sharpe from daily returns array
function rollingSharpe(rets, window = 30, annualisation = 365) {
    if (!rets.length || rets.length < window) return null;
    const slice = rets.slice(-window);
    const mean = slice.reduce((s, r) => s + r, 0) / slice.length;
    const variance = slice.reduce((s, r) => s + (r - mean) ** 2, 0) / slice.length;
    const std = Math.sqrt(variance);
    if (std < 1e-12) return 0;
    return (mean / std) * Math.sqrt(annualisation);
}

// Sortino — same but only counts downside deviation
function rollingSortino(rets, window = 30, annualisation = 365) {
    if (!rets.length || rets.length < window) return null;
    const slice = rets.slice(-window);
    const mean = slice.reduce((s, r) => s + r, 0) / slice.length;
    const downside = slice.filter((r) => r < 0);
    if (!downside.length) return 999;
    const dvar = downside.reduce((s, r) => s + r ** 2, 0) / downside.length;
    const dstd = Math.sqrt(dvar);
    if (dstd < 1e-12) return 0;
    return (mean / dstd) * Math.sqrt(annualisation);
}

// Calmar = CAGR / max-DD
function calmar(equityHistory) {
    if (!equityHistory || equityHistory.length < 30) return null;
    const first = equityHistory[0];
    const last = equityHistory[equityHistory.length - 1];
    const days = (last.ts - first.ts) / (86400 * 1000);
    if (days < 1) return null;
    const totalReturn = last.eq / first.eq;
    const cagr = Math.pow(totalReturn, 365 / days) - 1;
    let peak = first.eq, maxDD = 0;
    for (const p of equityHistory) {
        if (p.eq > peak) peak = p.eq;
        const dd = (peak - p.eq) / peak;
        if (dd > maxDD) maxDD = dd;
    }
    return maxDD > 0 ? cagr / maxDD : (cagr > 0 ? 999 : 0);
}

// Active addresses + block stats from blockchain.info
async function fetchBlockchainStats() {
    try {
        const [addrs, txs, diff] = await Promise.all([
            fetch("https://blockchain.info/q/24hrbtcsent?cors=true").then((r) => r.text()).catch(() => null),
            fetch("https://blockchain.info/q/24hrtransactioncount?cors=true").then((r) => r.text()).catch(() => null),
            fetch("https://blockchain.info/q/getdifficulty?cors=true").then((r) => r.text()).catch(() => null),
        ]);
        return {
            btcSent24h: addrs ? parseFloat(addrs) / 1e8 : null,
            txCount24h: txs ? parseInt(txs) : null,
            difficulty: diff ? parseFloat(diff) : null,
        };
    } catch { return null; }
}

// mempool.space large recent transactions — pseudo whale watch
async function fetchWhaleTransfers() {
    try {
        const mempool = await fetch("https://mempool.space/api/mempool/recent").then((r) => r.json()).catch(() => []);
        // top 10 by fee (proxy for large value txns)
        return (mempool || []).slice(0, 30)
            .filter((t) => t.value > 1e9)                // > 10 BTC in satoshi (100M sat/BTC)
            .sort((a, b) => b.value - a.value)
            .slice(0, 8)
            .map((t) => ({
                txid: t.txid,
                btc: t.value / 1e8,
                fee: t.fee,
                url: `https://mempool.space/tx/${t.txid}`,
            }));
    } catch { return []; }
}

// Hard-coded macro event calendar (FOMC / CPI / NFP + BTC halving)
function economicCalendar() {
    const raw = [
        // FOMC 2026 (approx dates — Fed publishes ~1yr in advance)
        { date: "2026-01-28", type: "FOMC", desc: "Fed Zinsentscheid" },
        { date: "2026-03-18", type: "FOMC", desc: "Fed Zinsentscheid + SEP" },
        { date: "2026-04-29", type: "FOMC", desc: "Fed Zinsentscheid" },
        { date: "2026-06-17", type: "FOMC", desc: "Fed Zinsentscheid + SEP" },
        { date: "2026-07-29", type: "FOMC", desc: "Fed Zinsentscheid" },
        { date: "2026-09-16", type: "FOMC", desc: "Fed Zinsentscheid + SEP" },
        { date: "2026-10-28", type: "FOMC", desc: "Fed Zinsentscheid" },
        { date: "2026-12-16", type: "FOMC", desc: "Fed Zinsentscheid + SEP" },
        // CPI 2026 — typically 2nd Wed of month
        { date: "2026-01-14", type: "CPI",  desc: "US-Inflationsdaten (Dez)" },
        { date: "2026-02-11", type: "CPI",  desc: "US-Inflationsdaten (Jan)" },
        { date: "2026-03-11", type: "CPI",  desc: "US-Inflationsdaten (Feb)" },
        { date: "2026-04-15", type: "CPI",  desc: "US-Inflationsdaten (Mär)" },
        { date: "2026-05-13", type: "CPI",  desc: "US-Inflationsdaten (Apr)" },
        { date: "2026-06-10", type: "CPI",  desc: "US-Inflationsdaten (Mai)" },
        { date: "2026-07-15", type: "CPI",  desc: "US-Inflationsdaten (Jun)" },
        { date: "2026-08-12", type: "CPI",  desc: "US-Inflationsdaten (Jul)" },
        { date: "2026-09-10", type: "CPI",  desc: "US-Inflationsdaten (Aug)" },
        { date: "2026-10-15", type: "CPI",  desc: "US-Inflationsdaten (Sep)" },
        { date: "2026-11-13", type: "CPI",  desc: "US-Inflationsdaten (Okt)" },
        { date: "2026-12-10", type: "CPI",  desc: "US-Inflationsdaten (Nov)" },
        // NFP — first Friday
        { date: "2026-01-02", type: "NFP",  desc: "Nonfarm Payrolls" },
        { date: "2026-02-06", type: "NFP",  desc: "Nonfarm Payrolls" },
        { date: "2026-03-06", type: "NFP",  desc: "Nonfarm Payrolls" },
        { date: "2026-04-03", type: "NFP",  desc: "Nonfarm Payrolls" },
        { date: "2026-05-01", type: "NFP",  desc: "Nonfarm Payrolls" },
        { date: "2026-06-05", type: "NFP",  desc: "Nonfarm Payrolls" },
        { date: "2026-07-03", type: "NFP",  desc: "Nonfarm Payrolls" },
        { date: "2026-08-07", type: "NFP",  desc: "Nonfarm Payrolls" },
        { date: "2026-09-04", type: "NFP",  desc: "Nonfarm Payrolls" },
        { date: "2026-10-02", type: "NFP",  desc: "Nonfarm Payrolls" },
        { date: "2026-11-06", type: "NFP",  desc: "Nonfarm Payrolls" },
        { date: "2026-12-04", type: "NFP",  desc: "Nonfarm Payrolls" },
        // ECB
        { date: "2026-01-22", type: "ECB",  desc: "EZB Zinsentscheid" },
        { date: "2026-03-12", type: "ECB",  desc: "EZB Zinsentscheid" },
        { date: "2026-04-30", type: "ECB",  desc: "EZB Zinsentscheid" },
        { date: "2026-06-11", type: "ECB",  desc: "EZB Zinsentscheid" },
        { date: "2026-07-23", type: "ECB",  desc: "EZB Zinsentscheid" },
        { date: "2026-09-10", type: "ECB",  desc: "EZB Zinsentscheid" },
        { date: "2026-10-29", type: "ECB",  desc: "EZB Zinsentscheid" },
        { date: "2026-12-17", type: "ECB",  desc: "EZB Zinsentscheid" },
        // BTC halving countdown (next: ~April 2028)
        { date: "2028-04-15", type: "BTC",  desc: "Bitcoin Halving #5 (Block 1 050 000)" },
    ];
    const now = Date.now();
    return raw
        .map((e) => ({ ...e, ts: new Date(e.date + "T13:30:00Z").getTime() }))
        .filter((e) => e.ts >= now - 6 * 3600 * 1000)     // include events happening today
        .sort((a, b) => a.ts - b.ts);
}

// Alpha-decay: bucket a strategy's trades into 20-trade windows, compute mean PnL per bucket
function alphaDecayBuckets(trades, bucketSize = 15) {
    if (!trades.length) return [];
    const sorted = trades.slice().sort((a, b) => new Date(a.close_ts) - new Date(b.close_ts));
    const buckets = [];
    for (let i = 0; i < sorted.length; i += bucketSize) {
        const chunk = sorted.slice(i, i + bucketSize);
        const meanPnl = chunk.reduce((s, t) => s + t.pnl, 0) / chunk.length;
        const wins = chunk.filter((t) => t.pnl > 0).length;
        buckets.push({
            start: chunk[0].close_ts, end: chunk[chunk.length - 1].close_ts,
            count: chunk.length, meanPnl, winRate: wins / chunk.length,
        });
    }
    return buckets;
}

// FIFO/LIFO matcher for partial closes — produces proper lot-matched round-trips
function matchTradesFifo(journal, method = "fifo") {
    const opens = {};              // symbol → queue of {ts, price, qtyRemaining, strategy, side}
    const matches = [];
    for (const e of journal) {
        if (e.kind === "open") {
            (opens[e.symbol] = opens[e.symbol] || []).push({
                ts: e.ts, price: e.price, qtyRemaining: e.qty, strategy: e.strategy || "",
                side: e.side, original_qty: e.qty,
            });
        } else if (e.kind === "close") {
            let need = e.qty;
            const stack = opens[e.symbol] || [];
            while (need > 1e-12 && stack.length) {
                const idx = method === "fifo" ? 0 : stack.length - 1;
                const lot = stack[idx];
                const take = Math.min(lot.qtyRemaining, need);
                const pnl = lot.side === "long"
                    ? (e.price - lot.price) * take
                    : (lot.price - e.price) * take;
                matches.push({
                    symbol: e.symbol, side: lot.side,
                    open_ts: lot.ts, close_ts: e.ts,
                    open_price: lot.price, close_price: e.price,
                    qty: take, pnl,
                    strategy: lot.strategy,
                    holding_ms: new Date(e.ts) - new Date(lot.ts),
                    partial: take < lot.original_qty,
                });
                lot.qtyRemaining -= take;
                need -= take;
                if (lot.qtyRemaining <= 1e-12) stack.splice(idx, 1);
            }
        }
    }
    return matches;
}

// AES-GCM encrypted backup using PBKDF2-derived key
async function encryptWithPassword(plainText, password) {
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const keyMaterial = await crypto.subtle.importKey(
        "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 200_000, hash: "SHA-256" },
        keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plainText));
    // combine: [salt(16)][iv(12)][ciphertext]
    const combined = new Uint8Array(salt.length + iv.length + ct.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(ct), salt.length + iv.length);
    return btoa(String.fromCharCode(...combined));
}

async function decryptWithPassword(b64, password) {
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const salt = raw.slice(0, 16);
    const iv = raw.slice(16, 28);
    const ct = raw.slice(28);
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 200_000, hash: "SHA-256" },
        keyMaterial, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(pt);
}

// HMAC-SHA256 signature for Binance signed endpoints
async function hmacSha256(secret, message) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
    return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Normal-distribution PDF for histogram overlay
function normalPdf(x, mean, std) {
    if (std < 1e-12) return 0;
    return (1 / (std * Math.sqrt(2 * Math.PI))) * Math.exp(-((x - mean) ** 2) / (2 * std * std));
}

// ---------- exports ----------
return {
    sma, ema, rsi, macd, bollinger, atr, adx, donchian, obv, stoch, williamsR, cci, mfi,
    ichimoku, vwap, vwapBands, keltner, chandelier, detectDivergence, detectRegime, confluenceScore,
    detectPatterns, computePatternStats, fetchHistory, PATTERN_INFO,
    closes, highs, lows, vols,
    STRATEGIES, ensemble,
    planTrade, forecast, assessRisk,
    PaperBroker,
    fetchKlines, fetchPrice, fetchFearGreed, fetch24hTickers,
    fetchGlobalMarket, fetchTrending, fetchEurRate, fetchOnChain,
    fetchBlockchainStats, fetchWhaleTransfers,
    rollingSharpe, rollingSortino, calmar,
    economicCalendar, alphaDecayBuckets, matchTradesFifo,
    encryptWithPassword, decryptWithPassword, hmacSha256, normalPdf,
};
})();
