import numpy as np
import pandas as pd

from src.backtest.runner import Backtest
from src.core.config import Config, EngineCfg, EnsembleCfg, ExchangeCfg, RiskCfg, UniverseCfg
from src.strategies import Ensemble, REGISTRY


def _synthetic(n=1000, tf_minutes=15, drift=0.05):
    idx = pd.date_range("2024-01-01", periods=n, freq=f"{tf_minutes}min", tz="UTC")
    rng = np.random.default_rng(7)
    noise = rng.normal(0, 1, n)
    close = 100 + np.cumsum(noise * 0.3 + drift)
    return pd.DataFrame({
        "open": close - 0.1,
        "high": close + 0.5,
        "low": close - 0.5,
        "close": close,
        "volume": np.abs(rng.normal(1000, 200, n)),
    }, index=idx)


def _cfg():
    return Config(
        exchange=ExchangeCfg(),
        universe=UniverseCfg(symbols=["FAKE/USDT"], timeframes=["15m", "4h"], primary_timeframe="15m"),
        engine=EngineCfg(warmup_candles=250),
        risk=RiskCfg(risk_per_trade_pct=1.0, atr_stop_multiplier=2.0,
                     take_profit_r_multiple=[1.5, 3.0], max_open_positions=1),
        strategies={
            "ema_cross": {"enabled": True, "weight": 1.0, "fast": 20, "slow": 50, "trend_filter_ema": 100},
            "macd_trend": {"enabled": True, "weight": 1.0, "fast": 12, "slow": 26, "signal": 9},
        },
        ensemble=EnsembleCfg(min_score=0.5, agreement_required=1),
        logging={},
        secrets={},
    )


def test_backtest_runs_end_to_end():
    cfg = _cfg()
    ens = Ensemble.from_config(cfg, REGISTRY)
    primary = _synthetic(1000, 15, drift=0.05)
    higher = {"4h": _synthetic(200, 240, drift=0.5)}
    bt = Backtest(cfg, ens, starting_balance=10_000)
    res = bt.run(primary, higher, "FAKE/USDT")
    assert res.final_equity > 0
    assert res.trades >= 0
    assert 0.0 <= res.max_drawdown_pct <= 100.0
    assert len(res.equity_curve) > 0
