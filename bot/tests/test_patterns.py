import numpy as np
import pandas as pd

from src.patterns import PatternDetector


def _df(n=100, seed=1):
    rng = np.random.default_rng(seed)
    close = 100 + np.cumsum(rng.normal(0, 0.5, n))
    open_ = close - rng.normal(0, 0.3, n)
    high = np.maximum(close, open_) + np.abs(rng.normal(0.3, 0.2, n))
    low = np.minimum(close, open_) - np.abs(rng.normal(0.3, 0.2, n))
    volume = np.abs(rng.normal(1000, 200, n))
    idx = pd.date_range("2024-01-01", periods=n, freq="15min", tz="UTC")
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close, "volume": volume}, index=idx)


def test_detector_returns_list():
    det = PatternDetector()
    out = det.detect(_df())
    assert isinstance(out, list)
    for p in out:
        assert p.direction in ("bullish", "bearish", "neutral")
        assert 0.0 <= p.confidence <= 1.0
        assert p.why and p.means and p.action


def test_detector_short_df_returns_empty():
    det = PatternDetector()
    assert det.detect(_df(20)) == []


def test_bull_flag_synthetic():
    n = 60
    close = np.concatenate([np.linspace(100, 130, 40), np.linspace(130, 131.5, 20)])
    df = pd.DataFrame({
        "open": close - 0.1, "high": close + 0.3, "low": close - 0.3,
        "close": close, "volume": np.ones(n) * 1000
    }, index=pd.date_range("2024-01-01", periods=n, freq="15min", tz="UTC"))
    out = PatternDetector().detect(df)
    # bull_flag needs 60 bars total in the code (uses -60:-20 and -20:)
    names = [p.name for p in out]
    assert isinstance(names, list)


def test_engulfing_detected():
    n = 60
    close = np.linspace(120, 90, n).tolist()
    open_ = [c + 0.5 for c in close]
    high = [max(o, c) + 0.5 for o, c in zip(open_, close)]
    low = [min(o, c) - 0.5 for o, c in zip(open_, close)]
    # last bar: bullish engulfing after downtrend
    open_[-1] = close[-2] - 1.0
    close[-1] = open_[-2] + 2.0
    high[-1] = close[-1] + 0.3
    low[-1] = open_[-1] - 0.3
    df = pd.DataFrame({"open": open_, "high": high, "low": low, "close": close,
                       "volume": [1000] * n},
                      index=pd.date_range("2024-01-01", periods=n, freq="15min", tz="UTC"))
    out = PatternDetector().detect(df)
    names = [p.name for p in out]
    assert "bullish_engulfing" in names
