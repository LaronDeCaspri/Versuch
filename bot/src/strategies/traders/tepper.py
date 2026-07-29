from __future__ import annotations

from ... import indicators as ta
from ..base import Side, Signal, Strategy, StrategyContext


class TepperDistressed(Strategy):
    """
    Tepper post-2009: buy distressed assets when policy/liquidity turns. Proxy:
    50%+ drawdown from a 200-bar high + Supertrend flip from bearish to bullish
    + rising volume. Long-only.
    """
    name = "tepper_distressed"

    def evaluate(self, ctx: StrategyContext) -> Signal | None:
        df = ctx.candles
        if len(df) < 210:
            return None
        c = df["close"]
        peak = float(c.rolling(200).max().iloc[-1])
        price = float(c.iloc[-1])
        drawdown = (peak - price) / peak
        st = ta.supertrend(df["high"], df["low"], c, 10, 3.0)
        flip = float(st["trend"].iloc[-2]) == -1 and float(st["trend"].iloc[-1]) == 1
        vol_rising = float(df["volume"].iloc[-1]) > float(df["volume"].rolling(20).mean().iloc[-1]) * 1.2
        if drawdown >= 0.50 and flip and vol_rising:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.LONG, 0.92, price,
                          f"distressed reversal: dd={drawdown*100:.1f}% Supertrend flip + volume")
        return None
