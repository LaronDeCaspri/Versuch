from __future__ import annotations

from ... import indicators as ta
from ..base import Side, Signal, Strategy, StrategyContext


class SorosReflexivity(Strategy):
    """
    Soros' reflexivity: when a self-reinforcing trend meets an unsustainable
    fundamental setup, the reversal is violent. We proxy this on price:
    long parabolic move (>2x ATR extension over 20 bars) + break of 20-bar
    low = short. Symmetric long setup after capitulation waterfall.
    """
    name = "soros_reflexivity"

    def evaluate(self, ctx: StrategyContext) -> Signal | None:
        df = ctx.candles
        if len(df) < 60:
            return None
        c = df["close"]
        a = ta.atr(df["high"], df["low"], c, 14)
        move = (c.iloc[-1] - c.iloc[-20])
        extension = move / max(float(a.iloc[-1]), 1e-9)
        d = ta.donchian(df["high"], df["low"], 20)
        price = float(c.iloc[-1])
        if extension > 4 and price < float(d["lower"].iloc[-2]):
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.SHORT, 0.95, price,
                          f"reflexive top: 20-bar extension {extension:.1f} ATR, break Donchian low")
        if extension < -4 and price > float(d["upper"].iloc[-2]):
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.LONG, 0.95, price,
                          f"capitulation reversal: extension {extension:.1f} ATR, break Donchian high")
        return None
