from __future__ import annotations

from .. import indicators as ta
from .base import Side, Signal, Strategy, StrategyContext


class WeinsteinStages(Strategy):
    """
    Stan Weinstein's four-stage model on the weekly chart, transplanted to
    the primary timeframe:
      Stage 1 (base)    : price ~ flat 30-EMA, ADX low
      Stage 2 (advance) : price > flat/rising 30-EMA, ADX rising
      Stage 3 (top)     : price ~ flat 30-EMA after stage 2, ADX falling
      Stage 4 (decline) : price < falling 30-EMA
    Fires long on entering stage 2 (breakout above resistance with volume),
    short on entering stage 4.
    """
    name = "weinstein_stages"

    def evaluate(self, ctx: StrategyContext) -> Signal | None:
        df = ctx.candles
        if len(df) < 60:
            return None
        c = df["close"]
        e30 = ta.ema(c, 30)
        slope = float(e30.iloc[-1] - e30.iloc[-10])
        adx_v = float(ta.adx(df["high"], df["low"], c, 14)["adx"].iloc[-1])
        recent_high = float(c.iloc[-30:-1].max())
        recent_low = float(c.iloc[-30:-1].min())
        price = float(c.iloc[-1])
        vol_ok = float(df["volume"].iloc[-1]) > float(df["volume"].rolling(20).mean().iloc[-1]) * 1.4

        if price > recent_high and slope > 0 and adx_v > 20 and vol_ok:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.LONG, 0.85, price,
                          f"Weinstein Stufe 2: Ausbruch über {recent_high:.2f}, EMA30 steigend, ADX {adx_v:.1f}")
        if price < recent_low and slope < 0 and adx_v > 20 and vol_ok:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.SHORT, 0.85, price,
                          f"Weinstein Stufe 4: Bruch unter {recent_low:.2f}, EMA30 fallend, ADX {adx_v:.1f}")
        return None
