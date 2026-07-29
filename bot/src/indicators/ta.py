from __future__ import annotations

import numpy as np
import pandas as pd


# --- moving averages -------------------------------------------------------

def sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n, min_periods=n).mean()


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def wma(s: pd.Series, n: int) -> pd.Series:
    w = np.arange(1, n + 1)
    return s.rolling(n).apply(lambda x: np.dot(x, w) / w.sum(), raw=True)


def dema(s: pd.Series, n: int) -> pd.Series:
    e = ema(s, n)
    return 2 * e - ema(e, n)


def tema(s: pd.Series, n: int) -> pd.Series:
    e1 = ema(s, n)
    e2 = ema(e1, n)
    e3 = ema(e2, n)
    return 3 * (e1 - e2) + e3


def hma(s: pd.Series, n: int) -> pd.Series:
    half = max(1, int(n / 2))
    sqrt_n = max(1, int(np.sqrt(n)))
    return wma(2 * wma(s, half) - wma(s, n), sqrt_n)


# --- range helpers ---------------------------------------------------------

def highest(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n).max()


def lowest(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n).min()


def roc(s: pd.Series, n: int) -> pd.Series:
    return (s / s.shift(n) - 1.0) * 100


def true_range(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    prev = close.shift(1)
    return pd.concat([high - low, (high - prev).abs(), (low - prev).abs()], axis=1).max(axis=1)


def atr(high: pd.Series, low: pd.Series, close: pd.Series, n: int = 14) -> pd.Series:
    return true_range(high, low, close).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


# --- oscillators -----------------------------------------------------------

def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    ag = gain.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    al = loss.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    rs = ag / al.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    line = ema(close, fast) - ema(close, slow)
    sig = ema(line, signal)
    return pd.DataFrame({"macd": line, "signal": sig, "hist": line - sig})


def ppo(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    f, s = ema(close, fast), ema(close, slow)
    line = (f - s) / s.replace(0, np.nan) * 100
    sig = ema(line, signal)
    return pd.DataFrame({"ppo": line, "signal": sig, "hist": line - sig})


def stoch(high: pd.Series, low: pd.Series, close: pd.Series, k: int = 14, d: int = 3) -> pd.DataFrame:
    ll, hh = lowest(low, k), highest(high, k)
    kline = 100 * (close - ll) / (hh - ll).replace(0, np.nan)
    return pd.DataFrame({"k": kline, "d": sma(kline, d)})


def stoch_rsi(close: pd.Series, n: int = 14, k: int = 3, d: int = 3) -> pd.DataFrame:
    r = rsi(close, n)
    ll, hh = lowest(r, n), highest(r, n)
    kline = sma((r - ll) / (hh - ll).replace(0, np.nan), k) * 100
    return pd.DataFrame({"k": kline, "d": sma(kline, d)})


def williams_r(high: pd.Series, low: pd.Series, close: pd.Series, n: int = 14) -> pd.Series:
    hh, ll = highest(high, n), lowest(low, n)
    return -100 * (hh - close) / (hh - ll).replace(0, np.nan)


def cci(high: pd.Series, low: pd.Series, close: pd.Series, n: int = 20) -> pd.Series:
    tp = (high + low + close) / 3
    ma = sma(tp, n)
    md = (tp - ma).abs().rolling(n).mean()
    return (tp - ma) / (0.015 * md.replace(0, np.nan))


def fisher_transform(high: pd.Series, low: pd.Series, n: int = 10) -> pd.DataFrame:
    m = (high + low) / 2
    hh, ll = highest(m, n), lowest(m, n)
    raw = 2 * ((m - ll) / (hh - ll).replace(0, np.nan) - 0.5)
    raw = raw.clip(-0.999, 0.999)
    fish = 0.5 * np.log((1 + raw) / (1 - raw))
    fish = fish.ewm(alpha=0.33, adjust=False).mean()
    return pd.DataFrame({"fisher": fish, "trigger": fish.shift(1)})


def trix(close: pd.Series, n: int = 15) -> pd.Series:
    e1 = ema(close, n)
    e2 = ema(e1, n)
    e3 = ema(e2, n)
    return e3.pct_change() * 100


def coppock(close: pd.Series, wma_n: int = 10, roc1: int = 14, roc2: int = 11) -> pd.Series:
    return wma(roc(close, roc1) + roc(close, roc2), wma_n)


def kst(close: pd.Series) -> pd.DataFrame:
    r1 = sma(roc(close, 10), 10)
    r2 = sma(roc(close, 15), 10)
    r3 = sma(roc(close, 20), 10)
    r4 = sma(roc(close, 30), 15)
    line = r1 + 2 * r2 + 3 * r3 + 4 * r4
    return pd.DataFrame({"kst": line, "signal": sma(line, 9)})


def ultimate(high: pd.Series, low: pd.Series, close: pd.Series,
             s1: int = 7, s2: int = 14, s3: int = 28) -> pd.Series:
    prev_close = close.shift(1)
    bp = close - pd.concat([low, prev_close], axis=1).min(axis=1)
    tr = pd.concat([high, prev_close], axis=1).max(axis=1) - pd.concat([low, prev_close], axis=1).min(axis=1)
    avg1 = bp.rolling(s1).sum() / tr.rolling(s1).sum()
    avg2 = bp.rolling(s2).sum() / tr.rolling(s2).sum()
    avg3 = bp.rolling(s3).sum() / tr.rolling(s3).sum()
    return 100 * (4 * avg1 + 2 * avg2 + avg3) / 7


def awesome_oscillator(high: pd.Series, low: pd.Series) -> pd.Series:
    m = (high + low) / 2
    return sma(m, 5) - sma(m, 34)


def accelerator_oscillator(high: pd.Series, low: pd.Series) -> pd.Series:
    ao = awesome_oscillator(high, low)
    return ao - sma(ao, 5)


def choppiness(high: pd.Series, low: pd.Series, close: pd.Series, n: int = 14) -> pd.Series:
    tr = true_range(high, low, close)
    sum_tr = tr.rolling(n).sum()
    hi = highest(high, n)
    lo = lowest(low, n)
    return 100 * np.log10(sum_tr / (hi - lo).replace(0, np.nan)) / np.log10(n)


def mass_index(high: pd.Series, low: pd.Series, n: int = 25) -> pd.Series:
    rng = high - low
    e1 = ema(rng, 9)
    e2 = ema(e1, 9)
    return (e1 / e2.replace(0, np.nan)).rolling(n).sum()


# --- trend -----------------------------------------------------------------

def adx(high: pd.Series, low: pd.Series, close: pd.Series, n: int = 14) -> pd.DataFrame:
    up = high.diff()
    down = -low.diff()
    plus_dm = pd.Series(np.where((up > down) & (up > 0), up, 0.0), index=high.index)
    minus_dm = pd.Series(np.where((down > up) & (down > 0), down, 0.0), index=high.index)
    tr = true_range(high, low, close)
    atr_ = tr.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    plus_di = 100 * plus_dm.ewm(alpha=1 / n, adjust=False).mean() / atr_
    minus_di = 100 * minus_dm.ewm(alpha=1 / n, adjust=False).mean() / atr_
    dx = (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan) * 100
    return pd.DataFrame({"adx": dx.ewm(alpha=1 / n, adjust=False, min_periods=n).mean(),
                         "plus_di": plus_di, "minus_di": minus_di})


def aroon(high: pd.Series, low: pd.Series, n: int = 25) -> pd.DataFrame:
    up = high.rolling(n + 1).apply(lambda x: (n - x[::-1].argmax()) / n * 100, raw=True)
    dn = low.rolling(n + 1).apply(lambda x: (n - x[::-1].argmin()) / n * 100, raw=True)
    return pd.DataFrame({"up": up, "down": dn, "osc": up - dn})


def vortex(high: pd.Series, low: pd.Series, close: pd.Series, n: int = 14) -> pd.DataFrame:
    tr = true_range(high, low, close)
    vm_plus = (high - low.shift(1)).abs()
    vm_minus = (low - high.shift(1)).abs()
    vi_plus = vm_plus.rolling(n).sum() / tr.rolling(n).sum().replace(0, np.nan)
    vi_minus = vm_minus.rolling(n).sum() / tr.rolling(n).sum().replace(0, np.nan)
    return pd.DataFrame({"vi_plus": vi_plus, "vi_minus": vi_minus})


def parabolic_sar(high: pd.Series, low: pd.Series, af_start: float = 0.02,
                  af_step: float = 0.02, af_max: float = 0.2) -> pd.Series:
    length = len(high)
    sar = np.zeros(length)
    trend = np.zeros(length, dtype=int)
    af = np.zeros(length)
    ep = np.zeros(length)
    if length < 2:
        return pd.Series(sar, index=high.index)
    trend[0] = 1
    sar[0] = low.iloc[0]
    ep[0] = high.iloc[0]
    af[0] = af_start
    for i in range(1, length):
        prev_sar, prev_af, prev_ep, prev_trend = sar[i - 1], af[i - 1], ep[i - 1], trend[i - 1]
        sar_i = prev_sar + prev_af * (prev_ep - prev_sar)
        trend_i = prev_trend
        if prev_trend == 1 and low.iloc[i] < sar_i:
            trend_i = -1
            sar_i = prev_ep
            ep_i = low.iloc[i]
            af_i = af_start
        elif prev_trend == -1 and high.iloc[i] > sar_i:
            trend_i = 1
            sar_i = prev_ep
            ep_i = high.iloc[i]
            af_i = af_start
        else:
            ep_i = prev_ep
            af_i = prev_af
            if trend_i == 1 and high.iloc[i] > prev_ep:
                ep_i = high.iloc[i]
                af_i = min(prev_af + af_step, af_max)
            elif trend_i == -1 and low.iloc[i] < prev_ep:
                ep_i = low.iloc[i]
                af_i = min(prev_af + af_step, af_max)
        sar[i], trend[i], ep[i], af[i] = sar_i, trend_i, ep_i, af_i
    return pd.Series(sar, index=high.index)


def supertrend(high: pd.Series, low: pd.Series, close: pd.Series, n: int = 10, mult: float = 3.0) -> pd.DataFrame:
    hl2 = (high + low) / 2
    a = atr(high, low, close, n)
    upper = hl2 + mult * a
    lower = hl2 - mult * a
    final_upper = upper.copy()
    final_lower = lower.copy()
    trend = pd.Series(np.ones(len(close)), index=close.index, dtype=float)
    for i in range(1, len(close)):
        prev_close = close.iloc[i - 1]
        final_upper.iloc[i] = min(upper.iloc[i], final_upper.iloc[i - 1]) if prev_close <= final_upper.iloc[i - 1] else upper.iloc[i]
        final_lower.iloc[i] = max(lower.iloc[i], final_lower.iloc[i - 1]) if prev_close >= final_lower.iloc[i - 1] else lower.iloc[i]
        trend.iloc[i] = 1 if close.iloc[i] > final_upper.iloc[i - 1] else (-1 if close.iloc[i] < final_lower.iloc[i - 1] else trend.iloc[i - 1])
    line = np.where(trend == 1, final_lower, final_upper)
    return pd.DataFrame({"trend": trend, "line": pd.Series(line, index=close.index)})


# --- volume ----------------------------------------------------------------

def obv(close: pd.Series, volume: pd.Series) -> pd.Series:
    direction = np.sign(close.diff().fillna(0))
    return (direction * volume).cumsum()


def mfi(high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series, n: int = 14) -> pd.Series:
    tp = (high + low + close) / 3
    raw_flow = tp * volume
    delta = tp.diff()
    pos = raw_flow.where(delta > 0, 0.0).rolling(n).sum()
    neg = raw_flow.where(delta < 0, 0.0).rolling(n).sum()
    mr = pos / neg.replace(0, np.nan)
    return 100 - 100 / (1 + mr)


def cmf(high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series, n: int = 20) -> pd.Series:
    mfv = ((close - low) - (high - close)) / (high - low).replace(0, np.nan) * volume
    return mfv.rolling(n).sum() / volume.rolling(n).sum().replace(0, np.nan)


def force_index(close: pd.Series, volume: pd.Series, n: int = 13) -> pd.Series:
    raw = close.diff() * volume
    return ema(raw, n)


def bop(open_: pd.Series, high: pd.Series, low: pd.Series, close: pd.Series, n: int = 14) -> pd.Series:
    raw = (close - open_) / (high - low).replace(0, np.nan)
    return sma(raw, n)


def vwap(high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series) -> pd.Series:
    tp = (high + low + close) / 3
    pv = tp * volume
    day = tp.index.floor("D") if hasattr(tp.index, "floor") else pd.Series(range(len(tp)), index=tp.index)
    return pv.groupby(day).cumsum() / volume.groupby(day).cumsum()


# --- bands and envelopes ---------------------------------------------------

def bollinger(close: pd.Series, n: int = 20, k: float = 2.0) -> pd.DataFrame:
    mid = sma(close, n)
    std = close.rolling(n).std(ddof=0)
    upper, lower = mid + k * std, mid - k * std
    return pd.DataFrame({"mid": mid, "upper": upper, "lower": lower, "width": (upper - lower) / mid})


def donchian(high: pd.Series, low: pd.Series, n: int = 20) -> pd.DataFrame:
    upper = highest(high, n)
    lower = lowest(low, n)
    return pd.DataFrame({"upper": upper, "lower": lower, "mid": (upper + lower) / 2})


def keltner(high: pd.Series, low: pd.Series, close: pd.Series, n: int = 20, mult: float = 2.0) -> pd.DataFrame:
    mid = ema(close, n)
    rng = atr(high, low, close, n)
    return pd.DataFrame({"mid": mid, "upper": mid + mult * rng, "lower": mid - mult * rng})


def ttm_squeeze(high: pd.Series, low: pd.Series, close: pd.Series,
                bb_n: int = 20, bb_k: float = 2.0, kc_n: int = 20, kc_mult: float = 1.5) -> pd.DataFrame:
    bb = bollinger(close, bb_n, bb_k)
    kc = keltner(high, low, close, kc_n, kc_mult)
    on = (bb["lower"] > kc["lower"]) & (bb["upper"] < kc["upper"])
    return pd.DataFrame({"on": on.astype(int)})


def ichimoku(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.DataFrame:
    tenkan = (highest(high, 9) + lowest(low, 9)) / 2
    kijun = (highest(high, 26) + lowest(low, 26)) / 2
    span_a = ((tenkan + kijun) / 2).shift(26)
    span_b = ((highest(high, 52) + lowest(low, 52)) / 2).shift(26)
    return pd.DataFrame({"tenkan": tenkan, "kijun": kijun, "span_a": span_a, "span_b": span_b, "chikou": close.shift(-26)})


# --- Elder ray -------------------------------------------------------------

def elder_ray(high: pd.Series, low: pd.Series, close: pd.Series, n: int = 13) -> pd.DataFrame:
    e = ema(close, n)
    return pd.DataFrame({"bull": high - e, "bear": low - e})


# --- pivots ----------------------------------------------------------------

def pivot_points_classical(prev_high: float, prev_low: float, prev_close: float) -> dict[str, float]:
    p = (prev_high + prev_low + prev_close) / 3
    r1, s1 = 2 * p - prev_low, 2 * p - prev_high
    r2, s2 = p + (prev_high - prev_low), p - (prev_high - prev_low)
    r3, s3 = prev_high + 2 * (p - prev_low), prev_low - 2 * (prev_high - p)
    return {"p": p, "r1": r1, "r2": r2, "r3": r3, "s1": s1, "s2": s2, "s3": s3}


def pivot_points_fib(prev_high: float, prev_low: float, prev_close: float) -> dict[str, float]:
    p = (prev_high + prev_low + prev_close) / 3
    d = prev_high - prev_low
    return {"p": p,
            "r1": p + 0.382 * d, "r2": p + 0.618 * d, "r3": p + 1.000 * d,
            "s1": p - 0.382 * d, "s2": p - 0.618 * d, "s3": p - 1.000 * d}


def pivot_points_camarilla(prev_high: float, prev_low: float, prev_close: float) -> dict[str, float]:
    d = prev_high - prev_low
    return {"h4": prev_close + d * 1.1 / 2, "h3": prev_close + d * 1.1 / 4,
            "h2": prev_close + d * 1.1 / 6, "h1": prev_close + d * 1.1 / 12,
            "l1": prev_close - d * 1.1 / 12, "l2": prev_close - d * 1.1 / 6,
            "l3": prev_close - d * 1.1 / 4, "l4": prev_close - d * 1.1 / 2}


def fib_retracement(swing_low: float, swing_high: float) -> dict[str, float]:
    diff = swing_high - swing_low
    return {f"{int(level*1000)/10}": swing_high - diff * level
            for level in (0.236, 0.382, 0.5, 0.618, 0.786, 1.0)}
