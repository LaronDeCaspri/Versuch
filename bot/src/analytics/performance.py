from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np
import pandas as pd


@dataclass
class PerformanceReport:
    trades: int = 0
    wins: int = 0
    losses: int = 0
    win_rate: float = 0.0
    pnl_total: float = 0.0
    avg_r: float = 0.0
    expectancy: float = 0.0
    profit_factor: float = 0.0
    max_drawdown_pct: float = 0.0
    sharpe: float = 0.0
    sortino: float = 0.0
    by_strategy: dict[str, dict] = field(default_factory=dict)
    by_symbol: dict[str, dict] = field(default_factory=dict)


def compute_performance(closed_entries: list[dict]) -> PerformanceReport:
    r = PerformanceReport()
    if not closed_entries:
        return r
    pnls = [e.get("pnl", 0.0) for e in closed_entries]
    rs = [e.get("r_multiple", 0.0) for e in closed_entries]
    r.trades = len(pnls)
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    r.wins = len(wins)
    r.losses = len(losses)
    r.win_rate = r.wins / r.trades * 100 if r.trades else 0
    r.pnl_total = sum(pnls)
    r.avg_r = float(np.mean(rs)) if rs else 0.0
    r.expectancy = float(np.mean(pnls)) if pnls else 0.0
    r.profit_factor = (sum(wins) / abs(sum(losses))) if losses else float("inf") if wins else 0.0
    equity = np.cumsum(pnls)
    peak = np.maximum.accumulate(equity) if len(equity) else np.array([0])
    dd = (peak - equity) / np.where(peak == 0, 1, peak) * 100 if len(equity) else np.array([0])
    r.max_drawdown_pct = float(dd.max()) if len(dd) else 0.0
    returns = np.diff(np.concatenate([[0], equity]))
    if returns.size > 1 and returns.std() > 0:
        r.sharpe = float(returns.mean() / returns.std() * np.sqrt(252))
        downside = returns[returns < 0]
        if downside.size > 0 and downside.std() > 0:
            r.sortino = float(returns.mean() / downside.std() * np.sqrt(252))
    by_strat: dict[str, list[float]] = defaultdict(list)
    by_sym: dict[str, list[float]] = defaultdict(list)
    for e in closed_entries:
        by_strat[e.get("strategy") or "unknown"].append(e.get("pnl", 0.0))
        by_sym[e.get("symbol", "")].append(e.get("pnl", 0.0))
    r.by_strategy = {k: {"trades": len(v), "pnl": round(sum(v), 4), "win_rate": round(sum(1 for x in v if x > 0)/len(v)*100, 1) if v else 0} for k, v in by_strat.items()}
    r.by_symbol = {k: {"trades": len(v), "pnl": round(sum(v), 4), "win_rate": round(sum(1 for x in v if x > 0)/len(v)*100, 1) if v else 0} for k, v in by_sym.items()}
    return r


def correlation_matrix(closes: dict[str, pd.Series]) -> pd.DataFrame:
    if not closes:
        return pd.DataFrame()
    df = pd.DataFrame({k: v for k, v in closes.items()})
    df = df.pct_change().dropna(how="all")
    return df.corr().round(3)
