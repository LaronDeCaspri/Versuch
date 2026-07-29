"""
Extended indicator pack — public / open-source indicators commonly seen on
TradingView. Proprietary paid scripts are NOT copied here; only the openly
documented equivalents are reimplemented.

Included:
  - Heikin Ashi transform
  - Wave Trend Oscillator (WTO)
  - QQE (Quantitative Qualitative Estimation)
  - Squeeze Momentum (LazyBear)
  - Chandelier Exit
  - Hull Suite (multi-HMA cloud)
  - HalfTrend
  - McGinley Dynamic
  - Chande Momentum Oscillator (CMO)
  - Detrended Price Oscillator (DPO)
  - Relative Vigor Index (RVI)
  - Ease of Movement (EOM)
  - Klinger Volume Oscillator (KVO)
  - Bill Williams: Alligator, Fractals, Gator Oscillator
  - Volume Weighted MA (VWMA)
  - Rainbow MA (5 SMAs)
  - Chaikin Volatility
  - Historical Volatility (annualized)
  - Fractal High/Low (Williams)
  - Basic Volume Profile (POC / VAH / VAL)
  - ZigZag pivots
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .ta import (atr, ema, hma, sma, true_range, wma)


def heikin_ashi(df: pd.DataFrame) -> pd.DataFrame:
    ha_close = (df["open"] + df["high"] + df["low"] + df["close"]) / 4
    ha_open = pd.Series(index=df.index, dtype=float)
    ha_open.iloc[0] = (df["open"].iloc[0] + df["close"].iloc[0]) / 2
    for i in range(1, len(df)):
        ha_open.iloc[i] = (ha_open.iloc[i - 1] + ha_close.iloc[i - 1]) / 2
    ha_high = pd.concat([df["high"], ha_open, ha_close], axis=1).max(axis=1)
    ha_low = pd.concat([df["low"], ha_open, ha_close], axis=1).min(axis=1)
    return pd.DataFrame({"open": ha_open, "high": ha_high, "low": ha_low, "close": ha_close})


def wave_trend(high: pd.Series, low: pd.Series, close: pd.Series,
               n1: int = 10, n2: int = 21) -> pd.DataFrame:
    ap = (high + low + close) / 3
    esa = ema(ap, n1)
    d = ema((ap - esa).abs(), n1)
    ci = (ap - esa) / (0.015 * d.replace(0, np.nan))
    tci = ema(ci, n2)
    wt1 = tci
    wt2 = sma(wt1, 4)
    return pd.DataFrame({"wt1": wt1, "wt2": wt2, "hist": wt1 - wt2})


def qqe(close: pd.Series, n: int = 14, factor: float = 4.238) -> pd.Series:
    rsi = _rsi_ema(close, n)
    smoothed = ema(rsi, 5)
    dar = ema(ema((smoothed.diff().abs()), n) * factor, n)
    trailing = smoothed.copy()
    for i in range(1, len(close)):
        prev = trailing.iloc[i - 1]
        if smoothed.iloc[i] > prev:
            trailing.iloc[i] = max(prev, smoothed.iloc[i] - dar.iloc[i])
        else:
            trailing.iloc[i] = min(prev, smoothed.iloc[i] + dar.iloc[i])
    return trailing


def _rsi_ema(close: pd.Series, n: int) -> pd.Series:
    delta = close.diff()
    up = delta.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = -delta.clip(upper=0).ewm(alpha=1 / n, adjust=False).mean()
    rs = up / dn.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def squeeze_momentum(high: pd.Series, low: pd.Series, close: pd.Series,
                     bb_n: int = 20, bb_k: float = 2.0, kc_n: int = 20, kc_mult: float = 1.5) -> pd.DataFrame:
    ma = sma(close, bb_n)
    std = close.rolling(bb_n).std(ddof=0)
    bb_upper = ma + bb_k * std
    bb_lower = ma - bb_k * std
    atr_v = atr(high, low, close, kc_n)
    kc_upper = ma + kc_mult * atr_v
    kc_lower = ma - kc_mult * atr_v
    on = (bb_lower > kc_lower) & (bb_upper < kc_upper)
    off = (bb_lower < kc_lower) & (bb_upper > kc_upper)
    donchian_mid = (high.rolling(kc_n).max() + low.rolling(kc_n).min()) / 2
    momentum = (close - (donchian_mid + ma) / 2)
    # linear regression on rolling window
    x = np.arange(kc_n)
    def _lr(w):
        return np.polyfit(x, w, 1)[0] * (kc_n - 1) + np.polyfit(x, w, 1)[1]
    val = momentum.rolling(kc_n).apply(lambda w: np.polyfit(x, w, 1)[0] * (kc_n - 1) + np.polyfit(x, w, 1)[1], raw=True)
    return pd.DataFrame({"momentum": val, "squeeze_on": on.astype(int), "squeeze_off": off.astype(int)})


def chandelier_exit(high: pd.Series, low: pd.Series, close: pd.Series,
                    n: int = 22, mult: float = 3.0) -> pd.DataFrame:
    a = atr(high, low, close, n)
    long_exit = high.rolling(n).max() - a * mult
    short_exit = low.rolling(n).min() + a * mult
    return pd.DataFrame({"long_exit": long_exit, "short_exit": short_exit})


def hull_suite(close: pd.Series, base: int = 55) -> pd.DataFrame:
    return pd.DataFrame({
        "hma_fast": hma(close, base),
        "hma_slow": hma(close, base * 2),
    })


def halftrend(high: pd.Series, low: pd.Series, close: pd.Series,
              n: int = 21, amp: float = 2.0) -> pd.DataFrame:
    a = atr(high, low, close, 100) * amp / 2
    up = sma(high, n)
    dn = sma(low, n)
    trend = np.zeros(len(close))
    line = close.copy().values
    for i in range(1, len(close)):
        if trend[i - 1] == 1:
            line[i] = max(line[i - 1], dn.iloc[i])
            if high.iloc[i] > up.iloc[i] + a.iloc[i]:
                trend[i] = 1
            elif close.iloc[i] < line[i]:
                trend[i] = -1
                line[i] = up.iloc[i]
            else:
                trend[i] = 1
        else:
            line[i] = min(line[i - 1], up.iloc[i])
            if low.iloc[i] < dn.iloc[i] - a.iloc[i]:
                trend[i] = -1
            elif close.iloc[i] > line[i]:
                trend[i] = 1
                line[i] = dn.iloc[i]
            else:
                trend[i] = -1
    return pd.DataFrame({"trend": pd.Series(trend, index=close.index),
                         "line": pd.Series(line, index=close.index)})


def mcginley(close: pd.Series, n: int = 14) -> pd.Series:
    out = close.copy().astype(float)
    for i in range(1, len(close)):
        out.iloc[i] = out.iloc[i - 1] + (close.iloc[i] - out.iloc[i - 1]) / (n * (close.iloc[i] / out.iloc[i - 1]) ** 4)
    return out


def cmo(close: pd.Series, n: int = 14) -> pd.Series:
    delta = close.diff()
    up = delta.clip(lower=0).rolling(n).sum()
    dn = -delta.clip(upper=0).rolling(n).sum()
    return 100 * (up - dn) / (up + dn).replace(0, np.nan)


def dpo(close: pd.Series, n: int = 20) -> pd.Series:
    shift = int(n / 2) + 1
    return close - sma(close, n).shift(shift)


def rvi(open_: pd.Series, high: pd.Series, low: pd.Series, close: pd.Series, n: int = 10) -> pd.DataFrame:
    numer = (close - open_ + 2 * (close.shift(1) - open_.shift(1))
             + 2 * (close.shift(2) - open_.shift(2)) + (close.shift(3) - open_.shift(3))) / 6
    denom = (high - low + 2 * (high.shift(1) - low.shift(1))
             + 2 * (high.shift(2) - low.shift(2)) + (high.shift(3) - low.shift(3))) / 6
    line = numer.rolling(n).sum() / denom.rolling(n).sum().replace(0, np.nan)
    return pd.DataFrame({"rvi": line, "signal": sma(line, 4)})


def eom(high: pd.Series, low: pd.Series, volume: pd.Series, n: int = 14, divisor: float = 1e6) -> pd.Series:
    dist = ((high + low) / 2) - ((high.shift(1) + low.shift(1)) / 2)
    box_ratio = (volume / divisor) / (high - low).replace(0, np.nan)
    return (dist / box_ratio).rolling(n).mean()


def klinger(high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series,
            fast: int = 34, slow: int = 55, signal: int = 13) -> pd.DataFrame:
    tp = (high + low + close) / 3
    dm = high - low
    cm = dm.copy()
    for i in range(1, len(tp)):
        cm.iloc[i] = cm.iloc[i - 1] + dm.iloc[i] if tp.iloc[i] > tp.iloc[i - 1] else dm.iloc[i]
    vf = volume * (2 * (dm / cm.replace(0, np.nan) - 1)) * np.sign(tp.diff().fillna(0)) * 100
    line = ema(vf, fast) - ema(vf, slow)
    return pd.DataFrame({"kvo": line, "signal": ema(line, signal)})


def alligator(high: pd.Series, low: pd.Series) -> pd.DataFrame:
    median = (high + low) / 2
    return pd.DataFrame({
        "jaw":   sma(median, 13).shift(8),
        "teeth": sma(median, 8).shift(5),
        "lips":  sma(median, 5).shift(3),
    })


def gator_oscillator(high: pd.Series, low: pd.Series) -> pd.DataFrame:
    a = alligator(high, low)
    return pd.DataFrame({"upper": (a["jaw"] - a["teeth"]).abs(),
                         "lower": -(a["teeth"] - a["lips"]).abs()})


def fractals(high: pd.Series, low: pd.Series, n: int = 2) -> pd.DataFrame:
    up = high == high.rolling(2 * n + 1, center=True).max()
    dn = low == low.rolling(2 * n + 1, center=True).min()
    return pd.DataFrame({"up": up.astype(int), "down": dn.astype(int)})


def vwma(close: pd.Series, volume: pd.Series, n: int = 20) -> pd.Series:
    return (close * volume).rolling(n).sum() / volume.rolling(n).sum().replace(0, np.nan)


def rainbow_ma(close: pd.Series) -> pd.DataFrame:
    return pd.DataFrame({f"sma_{n}": sma(close, n) for n in (10, 20, 50, 100, 200)})


def chaikin_volatility(high: pd.Series, low: pd.Series, n: int = 10) -> pd.Series:
    ma = ema(high - low, n)
    return ma.pct_change(n) * 100


def historical_volatility(close: pd.Series, n: int = 30) -> pd.Series:
    log_ret = np.log(close / close.shift(1))
    return log_ret.rolling(n).std() * np.sqrt(365) * 100


def volume_profile(df: pd.DataFrame, bins: int = 24) -> dict:
    if len(df) < bins:
        return {"poc": None, "vah": None, "val": None, "bins": []}
    price = (df["high"] + df["low"]) / 2
    hist, edges = np.histogram(price, bins=bins, weights=df["volume"])
    poc_idx = int(hist.argmax())
    poc_price = (edges[poc_idx] + edges[poc_idx + 1]) / 2
    # 70% value area around POC
    total = hist.sum()
    ord_idx = np.argsort(-hist)
    accumulated = 0
    included = set()
    for idx in ord_idx:
        included.add(int(idx))
        accumulated += hist[idx]
        if accumulated / total >= 0.70:
            break
    included_sorted = sorted(included)
    val = float(edges[included_sorted[0]])
    vah = float(edges[included_sorted[-1] + 1])
    return {"poc": float(poc_price), "vah": vah, "val": val,
            "bins": [{"price": float((edges[i]+edges[i+1])/2), "vol": float(hist[i])} for i in range(len(hist))]}


def zigzag(close: pd.Series, threshold_pct: float = 3.0) -> list[dict]:
    if len(close) == 0:
        return []
    pivots: list[dict] = [{"idx": 0, "price": float(close.iloc[0]), "kind": "start"}]
    last_pivot = pivots[0]
    direction = 0
    for i in range(1, len(close)):
        price = float(close.iloc[i])
        pct = (price - last_pivot["price"]) / last_pivot["price"] * 100
        if direction >= 0 and pct >= threshold_pct:
            direction = 1
            last_pivot = {"idx": i, "price": price, "kind": "high"}
            pivots.append(last_pivot)
        elif direction <= 0 and pct <= -threshold_pct:
            direction = -1
            last_pivot = {"idx": i, "price": price, "kind": "low"}
            pivots.append(last_pivot)
        else:
            if direction == 1 and price > last_pivot["price"]:
                last_pivot["price"] = price
                last_pivot["idx"] = i
            if direction == -1 and price < last_pivot["price"]:
                last_pivot["price"] = price
                last_pivot["idx"] = i
    return pivots


__all__ = [
    "heikin_ashi", "wave_trend", "qqe", "squeeze_momentum", "chandelier_exit",
    "hull_suite", "halftrend", "mcginley", "cmo", "dpo", "rvi", "eom",
    "klinger", "alligator", "gator_oscillator", "fractals", "vwma",
    "rainbow_ma", "chaikin_volatility", "historical_volatility",
    "volume_profile", "zigzag",
]
