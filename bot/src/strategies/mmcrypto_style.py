from __future__ import annotations

from .. import indicators as ta
from .base import Side, Signal, Strategy, StrategyContext


class MmCryptoStyle(Strategy):
    """
    Multi-timeframe trend continuation, inspired by MMCrypto's public setups:
      - Higher timeframe (4h/1d) defines the macro trend via EMA(200).
      - Lower timeframe (15m/1h) provides the entry via EMA(21/55) cross.
      - RSI must not be exhausted (< 70 for longs, > 30 for shorts).
      - Volume on the trigger candle must exceed the recent average, confirming participation.
      - Skips entries when price is stretched too far from the trigger EMA (mean-reversion risk).
    """

    name = "mmcrypto_style"

    def evaluate(self, ctx: StrategyContext) -> Signal | None:
        p = self.params
        htf_key = p.get("higher_tf", "4h")
        htf = ctx.higher_tf_candles.get(htf_key)
        if htf is None or len(htf) < int(p.get("ema_htf", 200)) + 5:
            return None

        htf_ema = ta.ema(htf["close"], int(p.get("ema_htf", 200)))
        macro_up = float(htf["close"].iloc[-1]) > float(htf_ema.iloc[-1])
        macro_dn = float(htf["close"].iloc[-1]) < float(htf_ema.iloc[-1])

        c = ctx.candles["close"]
        v = ctx.candles["volume"]
        if len(c) < max(int(p.get("ema_ltf_slow", 55)), 60):
            return None

        fast = ta.ema(c, int(p.get("ema_ltf_fast", 21)))
        slow = ta.ema(c, int(p.get("ema_ltf_slow", 55)))
        r = ta.rsi(c, int(p.get("rsi_period", 14)))
        vol_avg = v.rolling(int(p.get("volume_lookback", 20))).mean()
        atr = ta.atr(ctx.candles["high"], ctx.candles["low"], c, 14)

        price = float(c.iloc[-1])
        cross_up = fast.iloc[-2] <= slow.iloc[-2] and fast.iloc[-1] > slow.iloc[-1]
        cross_dn = fast.iloc[-2] >= slow.iloc[-2] and fast.iloc[-1] < slow.iloc[-1]
        vol_ok = float(v.iloc[-1]) >= float(vol_avg.iloc[-1]) * float(p.get("volume_multiplier", 1.5))
        rsi_now = float(r.iloc[-1])
        distance_atr = abs(price - float(fast.iloc[-1])) / max(float(atr.iloc[-1]), 1e-9)
        not_stretched = distance_atr < 2.5

        if macro_up and cross_up and vol_ok and rsi_now < 70 and not_stretched:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.LONG, 0.9, price,
                          f"HTF up + LTF EMA21>EMA55 + vol {v.iloc[-1]:.0f}>avg + RSI {rsi_now:.1f}")
        if macro_dn and cross_dn and vol_ok and rsi_now > 30 and not_stretched:
            return Signal(self.name, ctx.symbol, ctx.timeframe, Side.SHORT, 0.9, price,
                          f"HTF down + LTF EMA21<EMA55 + vol {v.iloc[-1]:.0f}>avg + RSI {rsi_now:.1f}")
        return None
