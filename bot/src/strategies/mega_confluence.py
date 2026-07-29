from __future__ import annotations

from .. import indicators as ta
from .base import Side, Signal, Strategy, StrategyContext


class MegaConfluence(Strategy):
    """
    Reads 15+ indicators in one pass and votes internally:
    trend  : EMA20>EMA50, EMA50>EMA200, Supertrend, PSAR, ADX>20 with +DI>-DI, Aroon Osc
    momo   : RSI, MACD hist, Stoch %K vs %D, CCI, Williams %R, TRIX, PPO hist
    volume : OBV slope, MFI, CMF, Force Index
    Publishes side when >=70% of voters agree.
    """
    name = "mega_confluence"

    def evaluate(self, ctx: StrategyContext) -> Signal | None:
        df = ctx.candles
        if len(df) < 220:
            return None
        h, l, c, v, o = df["high"], df["low"], df["close"], df["volume"], df["open"]

        votes: list[int] = []                                     # +1 long, -1 short, 0 neutral

        e20, e50, e200 = ta.ema(c, 20), ta.ema(c, 50), ta.ema(c, 200)
        votes.append(1 if e20.iloc[-1] > e50.iloc[-1] else -1)
        votes.append(1 if e50.iloc[-1] > e200.iloc[-1] else -1)
        st = ta.supertrend(h, l, c, 10, 3.0)["trend"].iloc[-1]
        votes.append(int(st))
        psar = ta.parabolic_sar(h, l)
        votes.append(1 if c.iloc[-1] > psar.iloc[-1] else -1)
        adxdf = ta.adx(h, l, c, 14)
        if float(adxdf["adx"].iloc[-1]) > 20:
            votes.append(1 if adxdf["plus_di"].iloc[-1] > adxdf["minus_di"].iloc[-1] else -1)
        ar = ta.aroon(h, l, 25)
        votes.append(1 if float(ar["osc"].iloc[-1]) > 0 else -1)
        r = float(ta.rsi(c, 14).iloc[-1])
        votes.append(1 if r > 50 else -1)
        macd_h = float(ta.macd(c)["hist"].iloc[-1])
        votes.append(1 if macd_h > 0 else -1)
        s = ta.stoch(h, l, c)
        votes.append(1 if s["k"].iloc[-1] > s["d"].iloc[-1] else -1)
        c_val = float(ta.cci(h, l, c, 20).iloc[-1])
        votes.append(1 if c_val > 0 else -1)
        wr = float(ta.williams_r(h, l, c, 14).iloc[-1])
        votes.append(1 if wr > -50 else -1)
        tx = ta.trix(c, 15)
        votes.append(1 if float(tx.iloc[-1]) > float(tx.iloc[-2]) else -1)
        p_h = float(ta.ppo(c)["hist"].iloc[-1])
        votes.append(1 if p_h > 0 else -1)
        o_val = ta.obv(c, v)
        votes.append(1 if float(o_val.iloc[-1]) > float(o_val.rolling(20).mean().iloc[-1]) else -1)
        m = float(ta.mfi(h, l, c, v, 14).iloc[-1])
        votes.append(1 if m > 50 else -1)
        cm = float(ta.cmf(h, l, c, v, 20).iloc[-1])
        votes.append(1 if cm > 0 else -1)
        fi = ta.force_index(c, v, 13)
        votes.append(1 if float(fi.iloc[-1]) > 0 else -1)

        total = len(votes)
        long_pct = sum(1 for x in votes if x > 0) / total
        short_pct = sum(1 for x in votes if x < 0) / total
        price = float(c.iloc[-1])
        threshold = float(self.params.get("agreement_pct", 0.70))
        if long_pct >= threshold:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.LONG, min(1.0, long_pct),
                          price, f"{int(long_pct*100)}% of {total} indicators bullish")
        if short_pct >= threshold:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.SHORT, min(1.0, short_pct),
                          price, f"{int(short_pct*100)}% of {total} indicators bearish")
        return None
