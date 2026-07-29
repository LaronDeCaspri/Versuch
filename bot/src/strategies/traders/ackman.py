from __future__ import annotations

from ... import indicators as ta
from ..base import Side, Signal, Strategy, StrategyContext


class AckmanConviction(Strategy):
    """
    Ackman: concentrated, high-conviction. We fire only when ALL of the
    following align: EMA20 > EMA50 > EMA200 (or reverse), ADX > 25 (real
    trend), MACD hist positive (or negative) for 3 bars, MFI > 55 (or < 45).
    Rare but powerful.
    """
    name = "ackman_conviction"

    def evaluate(self, ctx: StrategyContext) -> Signal | None:
        df = ctx.candles
        if len(df) < 210:
            return None
        c = df["close"]
        e20, e50, e200 = ta.ema(c, 20), ta.ema(c, 50), ta.ema(c, 200)
        adx_v = ta.adx(df["high"], df["low"], c, 14)["adx"].iloc[-1]
        m = ta.macd(c)
        hist3 = m["hist"].iloc[-3:]
        mfi_v = ta.mfi(df["high"], df["low"], c, df["volume"], 14).iloc[-1]
        price = float(c.iloc[-1])
        stack_up = e20.iloc[-1] > e50.iloc[-1] > e200.iloc[-1] and price > float(e20.iloc[-1])
        stack_dn = e20.iloc[-1] < e50.iloc[-1] < e200.iloc[-1] and price < float(e20.iloc[-1])
        if stack_up and float(adx_v) > 25 and (hist3 > 0).all() and float(mfi_v) > 55:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.LONG, 1.0, price,
                          f"conviction long: EMA stacked, ADX={adx_v:.1f}, MFI={mfi_v:.1f}")
        if stack_dn and float(adx_v) > 25 and (hist3 < 0).all() and float(mfi_v) < 45:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.SHORT, 1.0, price,
                          f"conviction short: EMA stacked, ADX={adx_v:.1f}, MFI={mfi_v:.1f}")
        return None
