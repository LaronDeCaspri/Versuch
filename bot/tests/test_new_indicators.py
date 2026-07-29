import numpy as np
import pandas as pd

from src.indicators import (
    aroon, awesome_oscillator, cci, cmf, choppiness, coppock, dema, elder_ray,
    fisher_transform, force_index, hma, kst, mass_index, mfi, parabolic_sar,
    ppo, supertrend, tema, trix, ttm_squeeze, ultimate, vortex, williams_r,
    pivot_points_classical, pivot_points_fib, pivot_points_camarilla, fib_retracement,
)


def _ohlcv(n=300, seed=1):
    rng = np.random.default_rng(seed)
    close = 100 + np.cumsum(rng.normal(0, 1, n))
    high = close + np.abs(rng.normal(0.5, 0.3, n))
    low = close - np.abs(rng.normal(0.5, 0.3, n))
    open_ = close + rng.normal(0, 0.1, n)
    volume = np.abs(rng.normal(1000, 200, n))
    idx = pd.date_range("2024-01-01", periods=n, freq="15min", tz="UTC")
    return (pd.Series(open_, index=idx), pd.Series(high, index=idx),
            pd.Series(low, index=idx), pd.Series(close, index=idx), pd.Series(volume, index=idx))


def test_moving_averages():
    _, _, _, c, _ = _ohlcv()
    assert len(dema(c, 20)) == len(c)
    assert len(tema(c, 20)) == len(c)
    assert len(hma(c, 20)) == len(c)


def test_ppo_and_trix():
    _, _, _, c, _ = _ohlcv()
    assert set(ppo(c).columns) == {"ppo", "signal", "hist"}
    assert trix(c, 15).notna().sum() > 0


def test_williams_range():
    _, h, l, c, _ = _ohlcv()
    w = williams_r(h, l, c, 14).dropna()
    assert (w >= -100.001).all() and (w <= 0.001).all()


def test_cci_finite():
    _, h, l, c, _ = _ohlcv()
    v = cci(h, l, c, 20).dropna()
    assert np.isfinite(v).all()


def test_fisher_transform_bounded():
    _, h, l, _, _ = _ohlcv()
    f = fisher_transform(h, l, 10).dropna()
    assert f["fisher"].between(-5, 5).all()


def test_ultimate_range():
    _, h, l, c, _ = _ohlcv()
    u = ultimate(h, l, c).dropna()
    assert (u >= 0).all() and (u <= 100).all()


def test_awesome_ao():
    _, h, l, _, _ = _ohlcv()
    ao = awesome_oscillator(h, l).dropna()
    assert len(ao) > 0


def test_choppiness_range():
    _, h, l, c, _ = _ohlcv()
    cp = choppiness(h, l, c, 14).dropna()
    assert cp.between(-10, 110).all()


def test_mass_index():
    _, h, l, _, _ = _ohlcv()
    m = mass_index(h, l, 25).dropna()
    assert (m > 0).all()


def test_aroon():
    _, h, l, _, _ = _ohlcv()
    a = aroon(h, l, 25).dropna()
    assert a["up"].between(-0.1, 100.1).all()
    assert a["down"].between(-0.1, 100.1).all()


def test_vortex():
    _, h, l, c, _ = _ohlcv()
    v = vortex(h, l, c, 14).dropna()
    assert (v["vi_plus"] > 0).all() and (v["vi_minus"] > 0).all()


def test_parabolic_sar_finite():
    _, h, l, _, _ = _ohlcv()
    s = parabolic_sar(h, l)
    assert np.isfinite(s).all()


def test_supertrend_trend():
    _, h, l, c, _ = _ohlcv()
    st = supertrend(h, l, c, 10, 3.0)
    assert st["trend"].isin([-1, 1]).all()


def test_mfi_range():
    _, h, l, c, v = _ohlcv()
    m = mfi(h, l, c, v, 14).dropna()
    assert m.between(-0.1, 100.1).all()


def test_cmf_range():
    _, h, l, c, v = _ohlcv()
    cm = cmf(h, l, c, v, 20).dropna()
    assert cm.between(-1.01, 1.01).all()


def test_force_index_finite():
    _, _, _, c, v = _ohlcv()
    fi = force_index(c, v, 13).dropna()
    assert np.isfinite(fi).all()


def test_ttm_squeeze_bool():
    _, h, l, c, _ = _ohlcv()
    sq = ttm_squeeze(h, l, c).dropna()
    assert sq["on"].isin([0, 1]).all()


def test_elder_ray():
    _, h, l, c, _ = _ohlcv()
    e = elder_ray(h, l, c, 13).dropna()
    assert "bull" in e and "bear" in e


def test_kst_and_coppock():
    _, _, _, c, _ = _ohlcv()
    k = kst(c).dropna()
    assert {"kst", "signal"}.issubset(k.columns)
    assert coppock(c).notna().sum() > 0


def test_pivot_helpers():
    p = pivot_points_classical(110, 90, 100)
    assert p["r1"] > p["p"] > p["s1"]
    f = pivot_points_fib(110, 90, 100)
    assert f["r1"] > f["p"] > f["s1"]
    cm = pivot_points_camarilla(110, 90, 100)
    assert cm["h1"] > cm["l1"]
    fib = fib_retracement(90, 110)
    assert set(fib) - set(("23.6", "38.2", "50.0", "61.8", "78.6", "100.0")) == set()
