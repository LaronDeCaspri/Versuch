from __future__ import annotations

import numpy as np

from .. import indicators as ta
from .base import Side, Signal, Strategy, StrategyContext


class VwapReversion(Strategy):
    name = "vwap_reversion"

    def evaluate(self, ctx: StrategyContext) -> Signal | None:
        p = self.params
        bands = p.get("stdev_bands", [1.5, 2.5])
        df = ctx.candles
        v = ta.vwap(df["high"], df["low"], df["close"], df["volume"])
        dev = (df["close"] - v).rolling(50).std()
        if v.isna().iloc[-1] or dev.isna().iloc[-1]:
            return None
        price = float(df["close"].iloc[-1])
        vwap_now = float(v.iloc[-1])
        d = float(dev.iloc[-1])
        upper = vwap_now + bands[0] * d
        lower = vwap_now - bands[0] * d
        upper_far = vwap_now + bands[1] * d
        lower_far = vwap_now - bands[1] * d
        if lower_far <= price <= lower:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.LONG, 0.55, price,
                          f"VWAP reversion long, {price:.2f} < {lower:.2f}")
        if upper <= price <= upper_far:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.SHORT, 0.55, price,
                          f"VWAP reversion short, {price:.2f} > {upper:.2f}")
        return None
