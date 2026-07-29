from __future__ import annotations

from .. import indicators as ta
from .base import Side, Signal, Strategy, StrategyContext


class BollingerSqueeze(Strategy):
    name = "bollinger_squeeze"

    def evaluate(self, ctx: StrategyContext) -> Signal | None:
        p = self.params
        n, k = int(p.get("period", 20)), float(p.get("stdev", 2.0))
        lookback = int(p.get("squeeze_lookback", 120))
        c = ctx.candles["close"]
        bb = ta.bollinger(c, n, k)
        if len(bb) < lookback + 3:
            return None
        width_now = float(bb["width"].iloc[-1])
        min_width = float(bb["width"].iloc[-lookback:-1].min())
        was_squeezed = width_now <= min_width * 1.15
        price = float(c.iloc[-1])
        upper, lower = float(bb["upper"].iloc[-2]), float(bb["lower"].iloc[-2])
        prev_close = float(c.iloc[-2])
        if was_squeezed and price > upper and prev_close <= upper:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.LONG, 0.8, price,
                          f"BB squeeze breakout up, width={width_now:.4f}")
        if was_squeezed and price < lower and prev_close >= lower:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.SHORT, 0.8, price,
                          f"BB squeeze breakout down, width={width_now:.4f}")
        return None
