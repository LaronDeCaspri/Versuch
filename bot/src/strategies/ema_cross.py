from __future__ import annotations

from .. import indicators as ta
from .base import Side, Signal, Strategy, StrategyContext


class EmaCross(Strategy):
    name = "ema_cross"

    def evaluate(self, ctx: StrategyContext) -> Signal | None:
        p = self.params
        fast, slow, tf_ema = int(p.get("fast", 20)), int(p.get("slow", 50)), int(p.get("trend_filter_ema", 200))
        c = ctx.candles["close"]
        if len(c) < tf_ema + 5:
            return None
        ef, es, et = ta.ema(c, fast), ta.ema(c, slow), ta.ema(c, tf_ema)
        cross_up = ef.iloc[-2] <= es.iloc[-2] and ef.iloc[-1] > es.iloc[-1]
        cross_dn = ef.iloc[-2] >= es.iloc[-2] and ef.iloc[-1] < es.iloc[-1]
        price = float(c.iloc[-1])
        above_trend = price > float(et.iloc[-1])
        if cross_up and above_trend:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.LONG, 0.75, price,
                          f"EMA{fast}>EMA{slow} + price>EMA{tf_ema}")
        if cross_dn and not above_trend:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.SHORT, 0.75, price,
                          f"EMA{fast}<EMA{slow} + price<EMA{tf_ema}")
        return None
