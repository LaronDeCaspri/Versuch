from __future__ import annotations

from .. import indicators as ta
from .base import Side, Signal, Strategy, StrategyContext


class RsiMeanReversion(Strategy):
    name = "rsi_meanrev"

    def evaluate(self, ctx: StrategyContext) -> Signal | None:
        p = self.params
        period = int(p.get("period", 14))
        oversold = float(p.get("oversold", 28))
        overbought = float(p.get("overbought", 72))
        c = ctx.candles["close"]
        r = ta.rsi(c, period)
        if r.isna().iloc[-2]:
            return None
        r_prev, r_now = float(r.iloc[-2]), float(r.iloc[-1])
        price = float(c.iloc[-1])
        if r_prev < oversold <= r_now:
            strength = min(1.0, (oversold - r_prev) / oversold + 0.4)
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.LONG, strength, price,
                          f"RSI exit oversold {r_prev:.1f}->{r_now:.1f}")
        if r_prev > overbought >= r_now:
            strength = min(1.0, (r_prev - overbought) / (100 - overbought) + 0.4)
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.SHORT, strength, price,
                          f"RSI exit overbought {r_prev:.1f}->{r_now:.1f}")
        return None
