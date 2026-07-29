from __future__ import annotations

from ... import indicators as ta
from ..base import Side, Signal, Strategy, StrategyContext


class PtjCrash(Strategy):
    """
    Paul Tudor Jones on 1987: sees regime shift by combining rising volatility,
    weakening breadth, and a decisive break of the 200-EMA. Short trigger fires
    when ATR expands 50% vs 50-bar average and price breaks below EMA(200).
    """
    name = "ptj_crash"

    def evaluate(self, ctx: StrategyContext) -> Signal | None:
        df = ctx.candles
        if len(df) < 220:
            return None
        c = df["close"]
        a = ta.atr(df["high"], df["low"], c, 14)
        avg_atr = a.rolling(50).mean()
        vol_expanding = float(a.iloc[-1]) > float(avg_atr.iloc[-1]) * 1.5
        e200 = ta.ema(c, 200)
        broke_down = float(c.iloc[-2]) >= float(e200.iloc[-2]) and float(c.iloc[-1]) < float(e200.iloc[-1])
        broke_up = float(c.iloc[-2]) <= float(e200.iloc[-2]) and float(c.iloc[-1]) > float(e200.iloc[-1])
        price = float(c.iloc[-1])
        if vol_expanding and broke_down:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.SHORT, 0.9, price,
                          f"regime shift: ATR spike + break below EMA200")
        if vol_expanding and broke_up:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.LONG, 0.9, price,
                          f"regime shift: ATR spike + break above EMA200")
        return None
