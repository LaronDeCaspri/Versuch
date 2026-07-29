from __future__ import annotations

from ... import indicators as ta
from ..base import Side, Signal, Strategy, StrategyContext


class BuffettValue(Strategy):
    """
    Buffett: buy quality at a discount, hold. Proxy on price:
    30%+ drawdown from a 200-bar high + RSI(14) < 35 + OBV rising = accumulation.
    Longs only. Never shorts.
    """
    name = "buffett_value"

    def evaluate(self, ctx: StrategyContext) -> Signal | None:
        df = ctx.candles
        if len(df) < 220:
            return None
        c = df["close"]
        peak = float(c.rolling(200).max().iloc[-1])
        price = float(c.iloc[-1])
        drawdown = (peak - price) / peak
        r = ta.rsi(c, 14)
        o = ta.obv(c, df["volume"])
        obv_rising = float(o.iloc[-1]) > float(o.rolling(20).mean().iloc[-1])
        if drawdown >= 0.30 and float(r.iloc[-1]) < 35 and obv_rising:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.LONG, 0.85, price,
                          f"value accumulation: dd={drawdown*100:.1f}% RSI={r.iloc[-1]:.1f} OBV rising")
        return None
