import numpy as np
import pandas as pd

from src.indicators import (
    atr, bollinger, donchian, ema, macd, rsi, sma, stoch, stoch_rsi, vwap,
)


def _series():
    rng = np.random.default_rng(42)
    return pd.Series(100 + np.cumsum(rng.normal(0, 1, 500)))


def _ohlcv():
    s = _series()
    high = s + 1
    low = s - 1
    close = s
    volume = pd.Series(np.abs(np.random.default_rng(0).normal(1000, 200, len(s))))
    return high, low, close, volume


def test_sma_ema_length():
    s = _series()
    assert len(sma(s, 10)) == len(s)
    assert len(ema(s, 10)) == len(s)


def test_rsi_range():
    r = rsi(_series(), 14).dropna()
    assert r.min() >= 0 and r.max() <= 100


def test_macd_shape():
    m = macd(_series())
    assert set(m.columns) == {"macd", "signal", "hist"}


def test_bollinger_bands_order():
    b = bollinger(_series(), 20, 2).dropna()
    assert (b["upper"] >= b["mid"]).all()
    assert (b["mid"] >= b["lower"]).all()


def test_atr_positive():
    h, l, c, _ = _ohlcv()
    a = atr(h, l, c, 14).dropna()
    assert (a > 0).all()


def test_donchian_order():
    h, l, _, _ = _ohlcv()
    d = donchian(h, l, 20).dropna()
    assert (d["upper"] >= d["lower"]).all()


def test_stoch_range():
    h, l, c, _ = _ohlcv()
    s = stoch(h, l, c).dropna()
    assert s["k"].between(-1, 101).all()


def test_stoch_rsi_range():
    _, _, c, _ = _ohlcv()
    s = stoch_rsi(c).dropna()
    assert s["k"].between(-1, 101).all()


def test_vwap_non_nan_after_start():
    h, l, c, v = _ohlcv()
    idx = pd.date_range("2024-01-01", periods=len(c), freq="15min", tz="UTC")
    v_idx = pd.Series(v.values, index=idx)
    h_idx = pd.Series(h.values, index=idx)
    l_idx = pd.Series(l.values, index=idx)
    c_idx = pd.Series(c.values, index=idx)
    w = vwap(h_idx, l_idx, c_idx, v_idx)
    assert w.notna().sum() > 0
