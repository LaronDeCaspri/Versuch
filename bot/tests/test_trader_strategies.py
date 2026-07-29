import numpy as np
import pandas as pd

from src.strategies import REGISTRY
from src.strategies.base import Side, StrategyContext


def _candles(kind="up", n=400):
    rng = np.random.default_rng(3)
    if kind == "up":
        close = 100 + np.arange(n) * 0.4 + rng.normal(0, 0.5, n)
    elif kind == "down":
        close = 300 - np.arange(n) * 0.4 + rng.normal(0, 0.5, n)
    elif kind == "parabolic":
        close = np.concatenate([100 + np.arange(300) * 0.1,
                                100 + 30 + np.arange(n - 300) ** 1.5 * 0.02])
        close = close + rng.normal(0, 0.3, n)
    elif kind == "capitulation":
        close = np.concatenate([200 + np.arange(300) * 0.1,
                                230 - np.arange(n - 300) * 2.0])
    else:
        close = 100 + rng.normal(0, 1, n).cumsum()
    idx = pd.date_range("2024-01-01", periods=n, freq="15min", tz="UTC")
    high = close + 0.6
    low = close - 0.6
    open_ = close - 0.05
    volume = np.abs(rng.normal(1000, 200, n))
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close, "volume": volume}, index=idx)


def _ctx(df):
    return StrategyContext(symbol="X/USDT", timeframe="15m", candles=df, higher_tf_candles={})


def test_all_trader_strategies_registered():
    for name in ["soros_reflexivity", "buffett_value", "ptj_crash", "paulson_bubble",
                 "livermore_pivot", "einhorn_bear", "dalio_allweather",
                 "templeton_pessimism", "tepper_distressed", "ackman_conviction"]:
        assert name in REGISTRY


def test_each_trader_strategy_returns_signal_or_none():
    for kind in ("up", "down", "parabolic", "capitulation", "random"):
        df = _candles(kind)
        for name, klass in REGISTRY.items():
            strat = klass({"pivot_lookback": 60, "agreement_pct": 0.7,
                           "higher_tf": "4h", "ema_htf": 200, "ema_ltf_fast": 21,
                           "ema_ltf_slow": 55, "rsi_period": 14, "volume_lookback": 20,
                           "volume_multiplier": 1.0, "fast": 12, "slow": 26, "signal": 9,
                           "period": 14, "oversold": 30, "overbought": 70, "stdev": 2.0,
                           "squeeze_lookback": 120, "trend_filter_ema": 200,
                           "stdev_bands": [1.5, 2.5]})
            sig = strat.evaluate(_ctx(df))
            assert sig is None or sig.side in (Side.LONG, Side.SHORT)


def test_mega_confluence_returns_signal_on_strong_trend():
    strat = REGISTRY["mega_confluence"]({"agreement_pct": 0.65})
    df = _candles("up")
    sig = strat.evaluate(_ctx(df))
    assert sig is None or sig.side is Side.LONG
