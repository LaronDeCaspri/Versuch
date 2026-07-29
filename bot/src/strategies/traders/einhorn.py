from __future__ import annotations

from ... import indicators as ta
from ..base import Side, Signal, Strategy, StrategyContext


class EinhornBear(Strategy):
    """
    Einhorn's aggressive shorts: bearish RSI divergence (price higher high,
    RSI lower high) + break of the last swing low + declining CMF. Longs disabled.
    """
    name = "einhorn_bear"

    def evaluate(self, ctx: StrategyContext) -> Signal | None:
        df = ctx.candles
        if len(df) < 80:
            return None
        c = df["close"]
        r = ta.rsi(c, 14)
        # find last two swing highs (very simple)
        highs = c.rolling(5, center=True).max() == c
        swing_idx = [i for i, x in enumerate(highs.iloc[-60:]) if x]
        if len(swing_idx) < 2:
            return None
        i1, i2 = swing_idx[-2], swing_idx[-1]
        p1, p2 = float(c.iloc[-60:].iloc[i1]), float(c.iloc[-60:].iloc[i2])
        r1, r2 = float(r.iloc[-60:].iloc[i1]), float(r.iloc[-60:].iloc[i2])
        divergence = p2 > p1 and r2 < r1
        swing_low = float(c.iloc[-30:-2].min())
        broke = float(c.iloc[-1]) < swing_low
        cm = ta.cmf(df["high"], df["low"], df["close"], df["volume"], 20)
        cmf_falling = float(cm.iloc[-1]) < float(cm.iloc[-5])
        price = float(c.iloc[-1])
        if divergence and broke and cmf_falling:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.SHORT, 0.9, price,
                          f"bearish RSI divergence + break {swing_low:.2f} + CMF falling")
        return None
