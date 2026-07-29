from __future__ import annotations

from .. import indicators as ta
from .base import Side, Signal, Strategy, StrategyContext


class MacdTrend(Strategy):
    name = "macd_trend"

    def evaluate(self, ctx: StrategyContext) -> Signal | None:
        p = self.params
        m = ta.macd(ctx.candles["close"], int(p.get("fast", 12)), int(p.get("slow", 26)), int(p.get("signal", 9)))
        if m["hist"].isna().iloc[-2]:
            return None
        h_prev, h_now = float(m["hist"].iloc[-2]), float(m["hist"].iloc[-1])
        price = float(ctx.candles["close"].iloc[-1])
        if h_prev <= 0 < h_now:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.LONG, 0.7, price,
                          f"MACD hist flip +, {h_now:.4f}")
        if h_prev >= 0 > h_now:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.SHORT, 0.7, price,
                          f"MACD hist flip -, {h_now:.4f}")
        return None
