from __future__ import annotations

from ... import indicators as ta
from ..base import Side, Signal, Strategy, StrategyContext


class TempletonPessimism(Strategy):
    """
    Templeton: 'Buy at the point of maximum pessimism.' Trigger when Ultimate
    Oscillator is below 30 AND Fisher Transform crosses up from an extreme low.
    """
    name = "templeton_pessimism"

    def evaluate(self, ctx: StrategyContext) -> Signal | None:
        df = ctx.candles
        if len(df) < 60:
            return None
        u = ta.ultimate(df["high"], df["low"], df["close"])
        f = ta.fisher_transform(df["high"], df["low"], 10)
        cross_up = float(f["fisher"].iloc[-2]) < float(f["trigger"].iloc[-2]) \
                   and float(f["fisher"].iloc[-1]) > float(f["trigger"].iloc[-1])
        extreme_low = float(f["fisher"].iloc[-2]) < -1.5
        price = float(df["close"].iloc[-1])
        if float(u.iloc[-1]) < 30 and cross_up and extreme_low:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.LONG, 0.85, price,
                          f"maximum pessimism: UO={u.iloc[-1]:.1f}, Fisher cross from {f['fisher'].iloc[-2]:.2f}")
        return None
