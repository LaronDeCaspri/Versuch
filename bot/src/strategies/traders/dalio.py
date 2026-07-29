from __future__ import annotations

from ... import indicators as ta
from ..base import Side, Signal, Strategy, StrategyContext


class DalioAllWeather(Strategy):
    """
    Dalio's all-weather thinking is risk-parity across regimes. As a single-asset
    signal we translate it as: only take long trades when short-term (20) and
    long-term (200) trends AGREE, and when volatility is normal (Choppiness > 38
    and < 61). Provides a stable regime filter, low frequency, high conviction.
    """
    name = "dalio_allweather"

    def evaluate(self, ctx: StrategyContext) -> Signal | None:
        df = ctx.candles
        if len(df) < 210:
            return None
        c = df["close"]
        e20, e200 = ta.ema(c, 20), ta.ema(c, 200)
        chop = ta.choppiness(df["high"], df["low"], c, 14)
        both_up = float(c.iloc[-1]) > float(e20.iloc[-1]) > float(e200.iloc[-1])
        both_dn = float(c.iloc[-1]) < float(e20.iloc[-1]) < float(e200.iloc[-1])
        regime_ok = 38 < float(chop.iloc[-1]) < 61
        price = float(c.iloc[-1])
        prev_above = float(c.iloc[-2]) > float(e20.iloc[-2])
        prev_below = float(c.iloc[-2]) < float(e20.iloc[-2])
        if both_up and regime_ok and not prev_above:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.LONG, 0.75, price,
                          f"regime aligned up, chop={chop.iloc[-1]:.1f}")
        if both_dn and regime_ok and not prev_below:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.SHORT, 0.75, price,
                          f"regime aligned down, chop={chop.iloc[-1]:.1f}")
        return None
