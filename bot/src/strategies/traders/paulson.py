from __future__ import annotations

from ... import indicators as ta
from ..base import Side, Signal, Strategy, StrategyContext


class PaulsonBubble(Strategy):
    """
    Paulson made his fortune shorting a bubble. Detect parabolic price acceleration
    (last 20-bar slope > 2x prior 20-bar slope) combined with RSI(14) > 80 and
    Bollinger upper-band walker. Short on the first bearish engulfing after that.
    """
    name = "paulson_bubble"

    def evaluate(self, ctx: StrategyContext) -> Signal | None:
        df = ctx.candles
        if len(df) < 80:
            return None
        c = df["close"]
        slope_now = float(c.iloc[-1] - c.iloc[-20])
        slope_prev = float(c.iloc[-20] - c.iloc[-40])
        r = ta.rsi(c, 14)
        bb = ta.bollinger(c, 20, 2)
        walking = (c.iloc[-5:].reset_index(drop=True) > bb["upper"].iloc[-5:].reset_index(drop=True) * 0.99).sum() >= 3
        bearish_engulfing = (df["close"].iloc[-1] < df["open"].iloc[-1]
                             and df["close"].iloc[-2] > df["open"].iloc[-2]
                             and df["close"].iloc[-1] < df["open"].iloc[-2]
                             and df["open"].iloc[-1] > df["close"].iloc[-2])
        price = float(c.iloc[-1])
        if slope_prev > 0 and slope_now > slope_prev * 2 and float(r.iloc[-1]) > 80 and walking and bearish_engulfing:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.SHORT, 0.95, price,
                          f"bubble short: slope×2 + RSI={r.iloc[-1]:.1f} + upper-band walker + engulfing")
        return None
