from __future__ import annotations

from .. import indicators as ta
from .base import Side, Signal, Strategy, StrategyContext


class DonchianBreakout(Strategy):
    name = "donchian_breakout"

    def evaluate(self, ctx: StrategyContext) -> Signal | None:
        p = self.params
        n = int(p.get("period", 55))
        df = ctx.candles
        d = ta.donchian(df["high"], df["low"], n)
        if d["upper"].isna().iloc[-2]:
            return None
        close = float(df["close"].iloc[-1])
        prev_upper = float(d["upper"].iloc[-2])
        prev_lower = float(d["lower"].iloc[-2])
        if close > prev_upper:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.LONG, 0.85, close,
                          f"Donchian{n} breakout > {prev_upper:.4f}")
        if close < prev_lower:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.SHORT, 0.85, close,
                          f"Donchian{n} breakout < {prev_lower:.4f}")
        return None
