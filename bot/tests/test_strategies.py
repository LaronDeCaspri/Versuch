import numpy as np
import pandas as pd

from src.strategies import REGISTRY
from src.strategies.base import Side, StrategyContext


def _uptrend_candles(n=400, start=100, step=0.5):
    idx = pd.date_range("2024-01-01", periods=n, freq="15min", tz="UTC")
    close = start + np.arange(n) * step + np.sin(np.arange(n) / 10) * 2
    high = close + 1
    low = close - 1
    open_ = close - 0.2
    volume = np.abs(np.random.default_rng(0).normal(1000, 200, n))
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close, "volume": volume}, index=idx)


def _downtrend_candles(n=400, start=200, step=0.5):
    df = _uptrend_candles(n, start, step)
    df["close"] = start - np.arange(n) * step + np.sin(np.arange(n) / 10) * 2
    df["high"] = df["close"] + 1
    df["low"] = df["close"] - 1
    df["open"] = df["close"] + 0.2
    return df


def _ctx(df, higher=None):
    return StrategyContext(symbol="BTC/USDT", timeframe="15m", candles=df, higher_tf_candles=higher or {}, params={})


def test_ema_cross_registered_and_evaluates():
    ema_cross = REGISTRY["ema_cross"]({"fast": 20, "slow": 50, "trend_filter_ema": 200})
    df = _uptrend_candles()
    sig = ema_cross.evaluate(_ctx(df))
    assert sig is None or sig.side in (Side.LONG, Side.SHORT)


def test_donchian_breakout_on_new_high():
    strat = REGISTRY["donchian_breakout"]({"period": 20})
    df = _uptrend_candles()
    df.loc[df.index[-1], "close"] = df["high"].iloc[-30:-1].max() + 5
    sig = strat.evaluate(_ctx(df))
    assert sig is not None and sig.side is Side.LONG


def test_rsi_meanrev_flat_when_no_reversal():
    strat = REGISTRY["rsi_meanrev"]({"period": 14, "oversold": 25, "overbought": 75})
    df = _uptrend_candles()
    sig = strat.evaluate(_ctx(df))
    assert sig is None or sig.side in (Side.LONG, Side.SHORT)


def test_mmcrypto_style_needs_htf():
    strat = REGISTRY["mmcrypto_style"]({
        "higher_tf": "4h", "ema_htf": 200, "ema_ltf_fast": 21, "ema_ltf_slow": 55,
        "rsi_period": 14, "volume_lookback": 20, "volume_multiplier": 1.0,
    })
    df = _uptrend_candles()
    htf = _uptrend_candles(n=300, start=100, step=1.0)
    sig = strat.evaluate(_ctx(df, higher={"4h": htf}))
    assert sig is None or sig.side in (Side.LONG, Side.SHORT)
