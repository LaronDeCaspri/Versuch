from __future__ import annotations

from ... import indicators as ta
from ..base import Side, Signal, Strategy, StrategyContext


class LivermorePivot(Strategy):
    """
    Livermore's 'pivotal point' concept: after a base, wait for the decisive break
    of a recent multi-week high on expanding volume. No entry on the first attempt
    unless volume confirms. Symmetric for downside.
    """
    name = "livermore_pivot"

    def evaluate(self, ctx: StrategyContext) -> Signal | None:
        df = ctx.candles
        n = int(self.params.get("pivot_lookback", 60))
        if len(df) < n + 5:
            return None
        c = df["close"]
        v = df["volume"]
        hh = float(c.iloc[-n - 1:-1].max())
        ll = float(c.iloc[-n - 1:-1].min())
        vol_now = float(v.iloc[-1])
        vol_avg = float(v.iloc[-n:-1].mean())
        price = float(c.iloc[-1])
        vol_ok = vol_now > vol_avg * 1.5
        if price > hh and vol_ok:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.LONG, 0.9, price,
                          f"pivotal high break {hh:.2f}, volume {vol_now:.0f}>{vol_avg:.0f}")
        if price < ll and vol_ok:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.SHORT, 0.9, price,
                          f"pivotal low break {ll:.2f}, volume {vol_now:.0f}>{vol_avg:.0f}")
        return None
