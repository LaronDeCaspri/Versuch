from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable

import pandas as pd


class Side(str, Enum):
    LONG = "long"
    SHORT = "short"
    FLAT = "flat"


@dataclass
class Signal:
    strategy: str
    symbol: str
    timeframe: str
    side: Side
    strength: float                 # 0..1
    price: float
    reason: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class StrategyContext:
    symbol: str
    timeframe: str
    candles: pd.DataFrame                                     # primary TF
    higher_tf_candles: dict[str, pd.DataFrame] = field(default_factory=dict)
    params: dict[str, Any] = field(default_factory=dict)


class Strategy:
    name: str = "base"

    def __init__(self, params: dict[str, Any]):
        self.params = params or {}

    def evaluate(self, ctx: StrategyContext) -> Signal | None:
        raise NotImplementedError
