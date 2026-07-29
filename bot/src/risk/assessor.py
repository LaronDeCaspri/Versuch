"""
Risk assessment for a candidate trade. Produces a 0..100 score with a
human-readable classification, plus a breakdown of the individual factors so
the user can see WHY it is risky.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import numpy as np
import pandas as pd

from .. import indicators as ta
from ..strategies.base import Side


@dataclass
class RiskAssessment:
    score: int                                 # 0 = safe, 100 = extreme
    label: str                                 # niedrig | moderat | erhöht | hoch | extrem
    color: str                                 # green | yellow | orange | red | purple
    factors: list[dict]
    max_expected_drawdown_pct: float
    portfolio_exposure_pct: float
    correlation_risk: float

    def to_dict(self) -> dict:
        return {
            "score": self.score, "label": self.label, "color": self.color,
            "factors": self.factors,
            "max_expected_drawdown_pct": round(self.max_expected_drawdown_pct, 2),
            "portfolio_exposure_pct": round(self.portfolio_exposure_pct, 2),
            "correlation_risk": round(self.correlation_risk, 2),
        }


def _label(score: int) -> tuple[str, str]:
    if score < 20:  return "niedrig", "green"
    if score < 40:  return "moderat", "yellow"
    if score < 60:  return "erhöht", "orange"
    if score < 80:  return "hoch", "red"
    return "extrem", "purple"


def assess(side: Side, entry: float, stop: float, risk_amount: float, equity: float,
           candles: pd.DataFrame, open_positions_symbols: Iterable[str],
           other_candles: dict[str, pd.DataFrame] | None = None,
           symbol: str = "") -> RiskAssessment:
    factors: list[dict] = []
    total = 0.0

    # 1. Position risk vs equity
    position_pct = risk_amount / equity * 100 if equity > 0 else 100
    penalty = min(position_pct * 4, 40)                     # 1% = 4 pts
    total += penalty
    factors.append({"name": "Positionsrisiko",
                    "value": f"{position_pct:.2f}% des Depots",
                    "impact": round(penalty, 1)})

    # 2. Volatility regime (ATR14 vs 50-bar avg)
    if len(candles) >= 60:
        atr14 = ta.atr(candles["high"], candles["low"], candles["close"], 14)
        atr_ratio = float(atr14.iloc[-1]) / max(float(atr14.rolling(50).mean().iloc[-1]), 1e-9)
        p = min((atr_ratio - 1) * 20, 25) if atr_ratio > 1 else 0
        total += max(p, 0)
        factors.append({"name": "Volatilitätsregime",
                        "value": f"ATR jetzt {atr_ratio:.2f}× 50-Bar-Ø",
                        "impact": round(max(p, 0), 1)})

    # 3. Trend context: entering against 200-EMA
    if len(candles) >= 210:
        e200 = ta.ema(candles["close"], 200).iloc[-1]
        against = (side is Side.LONG and entry < e200) or (side is Side.SHORT and entry > e200)
        p = 15 if against else 0
        total += p
        factors.append({"name": "Trend-Kontext",
                        "value": "gegen EMA200" if against else "mit EMA200",
                        "impact": p})

    # 4. RSI extreme (buying at 80+ or selling at 20-)
    r = float(ta.rsi(candles["close"], 14).iloc[-1])
    if side is Side.LONG and r > 75: p = (r - 75) * 1.2
    elif side is Side.SHORT and r < 25: p = (25 - r) * 1.2
    else: p = 0
    total += p
    factors.append({"name": "RSI-Extrem",
                    "value": f"RSI {r:.1f}",
                    "impact": round(p, 1)})

    # 5. Drawdown state (crude, based on 50-bar peak)
    if len(candles) >= 60:
        peak = float(candles["close"].rolling(50).max().iloc[-1])
        dd = (peak - entry) / peak * 100 if peak > 0 else 0
        p = min(dd, 10) * (0.5 if side is Side.LONG else -0.3)
        total += max(p, 0)
        factors.append({"name": "Drawdown-Kontext",
                        "value": f"{dd:.1f}% vom 50-Bar-Peak",
                        "impact": round(max(p, 0), 1)})

    # 6. Correlation risk with open positions
    corr_risk = 0.0
    if other_candles and open_positions_symbols:
        my = candles["close"].pct_change().dropna().iloc[-50:]
        for sym in open_positions_symbols:
            if sym == symbol:
                continue
            other = other_candles.get(sym)
            if other is None or len(other) < 50:
                continue
            corr = my.corr(other["close"].pct_change().dropna().iloc[-50:])
            if corr is not None and not np.isnan(corr):
                corr_risk = max(corr_risk, abs(corr))
        p = corr_risk * 20
        total += p
        factors.append({"name": "Korrelationsrisiko",
                        "value": f"max ρ = {corr_risk:.2f}",
                        "impact": round(p, 1)})

    # 7. Portfolio exposure penalty
    positions_count = len(list(open_positions_symbols))
    exposure_pct = position_pct + positions_count * 1.0
    if positions_count >= 3:
        p = min((positions_count - 2) * 3, 15)
        total += p
        factors.append({"name": "Depot-Auslastung",
                        "value": f"{positions_count} offene Positionen",
                        "impact": p})

    score = int(min(max(total, 0), 100))
    label, color = _label(score)
    # rough max expected drawdown if trade fails hard = 2× risk_amount as %
    max_dd = min(position_pct * 2, 100)
    return RiskAssessment(score=score, label=label, color=color, factors=factors,
                          max_expected_drawdown_pct=max_dd,
                          portfolio_exposure_pct=exposure_pct,
                          correlation_risk=corr_risk)
