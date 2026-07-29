"""
Seeds a running PWA server with realistic synthetic OHLCV, a couple of
paper positions and a pending signal — so the demo looks alive even when
external market data is unreachable from the sandbox.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.core.config import Config
from src.data.market_data import MarketData
from src.execution.paper import PaperBroker
from src.risk.manager import RiskManager
from src.strategies import Ensemble, REGISTRY
from src.strategies.base import Side


def _syn(n: int, tf_minutes: int, base: float, drift: float = 0.0, seed: int = 1) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    close = base + np.cumsum(rng.normal(0, base * 0.005, n)) + np.arange(n) * drift
    close = np.abs(close)
    idx = pd.date_range(datetime.now(timezone.utc) - timedelta(minutes=tf_minutes * n),
                        periods=n, freq=f"{tf_minutes}min", tz="UTC")
    return pd.DataFrame({
        "open": close - rng.normal(0, base * 0.001, n),
        "high": close + np.abs(rng.normal(0, base * 0.003, n)),
        "low":  close - np.abs(rng.normal(0, base * 0.003, n)),
        "close": close,
        "volume": np.abs(rng.normal(base * 10, base * 2, n)),
    }, index=idx)


def seed(service) -> None:
    tfs = {"5m": 5, "15m": 15, "1h": 60, "4h": 240, "1d": 1440}
    bases = {"BTC/USDT": 68000, "ETH/USDT": 3400, "SOL/USDT": 165, "BNB/USDT": 620,
             "XRP/USDT": 2.10, "ADA/USDT": 0.85, "AVAX/USDT": 40, "LINK/USDT": 24}
    drifts = {"BTC/USDT": 5, "ETH/USDT": 0.4, "SOL/USDT": 0.05}
    for sym, base in bases.items():
        for tf, minutes in tfs.items():
            df = _syn(500, minutes, base, drift=drifts.get(sym, 0.0), seed=hash((sym, tf)) & 0xffff)
            service.market._cache[(sym, tf)] = df

    # simulate one filled position
    service.broker.submit_market("ETH/USDT", Side.LONG, 0.5, 3380,
                                 metadata={"stop": 3300, "take_profits": [(3450, 0.5), (3560, 0.5)]})
    service.broker.on_price("ETH/USDT", 3420)                     # walk up a bit

    # add a pending signal to show the tile pre-filled
    service.engine.pending.add(
        side=Side.LONG, symbol="BTC/USDT", entry=68150, stop=67320,
        take_profits=[(69200, 0.33), (70450, 0.33), (72100, 0.34)],
        size=0.148, risk_amount=100.0, score=3.4,
        reasons=[
            "mega_confluence: 82% der Indikatoren bullisch",
            "ackman_conviction: EMA20>EMA50>EMA200, ADX 28, MFI 61",
            "mmcrypto_style: HTF (4h) im Uptrend + LTF EMA21>EMA55, Volumen 1.7× avg",
            "weinstein_stages: Stufe-2-Ausbruch über 67900",
            "livermore_pivot: Pivotal-High-Break bei 68000 mit Volumen",
        ],
    )
