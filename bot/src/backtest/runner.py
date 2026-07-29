from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .. import indicators as ta
from ..core.config import Config
from ..core.logger import get
from ..execution.paper import PaperBroker
from ..risk.manager import RiskManager
from ..strategies import Ensemble, Side, StrategyContext

log = get(__name__)


@dataclass
class BacktestResult:
    trades: int
    wins: int
    losses: int
    pnl: float
    final_equity: float
    max_drawdown_pct: float
    equity_curve: list[tuple[pd.Timestamp, float]] = field(default_factory=list)

    def summary(self) -> str:
        wr = (self.wins / self.trades * 100) if self.trades else 0.0
        return (f"trades={self.trades} win_rate={wr:.1f}% pnl={self.pnl:.2f} "
                f"final_equity={self.final_equity:.2f} max_dd={self.max_drawdown_pct:.2f}%")


class Backtest:
    def __init__(self, cfg: Config, ensemble: Ensemble, starting_balance: float = 10_000.0):
        self.cfg = cfg
        self.ensemble = ensemble
        self.broker = PaperBroker(starting_balance=starting_balance)
        self.risk = RiskManager(cfg.risk)

    def run(self, primary: pd.DataFrame, higher: dict[str, pd.DataFrame], symbol: str) -> BacktestResult:
        equity_curve: list[tuple[pd.Timestamp, float]] = []
        peak = self.broker.equity({})
        max_dd = 0.0
        trades = wins = losses = 0
        primary = primary.copy().sort_index()
        warmup = self.cfg.engine.warmup_candles
        if len(primary) < warmup + 10:
            log.warning(f"not enough candles ({len(primary)}) for warmup {warmup}")
            warmup = max(60, len(primary) // 4)

        for i in range(warmup, len(primary)):
            window = primary.iloc[: i + 1]
            ts = window.index[-1]
            price = float(window["close"].iloc[-1])
            trig_orders = self.broker.on_price(symbol, price)
            for o in trig_orders:
                pnl = o.metadata.get("pnl", 0.0)
                if o.metadata.get("closing"):
                    trades += 1
                    if pnl > 0:
                        wins += 1
                    elif pnl < 0:
                        losses += 1
            higher_slice = {}
            for tf, hdf in higher.items():
                higher_slice[tf] = hdf.loc[:ts]
            ctx = StrategyContext(symbol=symbol, timeframe=self.cfg.universe.primary_timeframe,
                                  candles=window, higher_tf_candles=higher_slice)
            side, score, _ = self.ensemble.score(ctx)
            positions = self.broker.positions()
            if side is not Side.FLAT and symbol not in positions and len(positions) < self.cfg.risk.max_open_positions:
                atr = float(ta.atr(window["high"], window["low"], window["close"], 14).iloc[-1])
                if not np.isnan(atr):
                    equity = self.broker.equity({symbol: price})
                    plan = self.risk.plan(side, price, atr, equity)
                    if plan and plan.size > 0:
                        self.broker.submit_market(symbol, side, plan.size, price,
                                                  metadata={"stop": plan.stop, "take_profits": plan.take_profits})
            eq = self.broker.equity({symbol: price})
            peak = max(peak, eq)
            if peak > 0:
                dd = (peak - eq) / peak * 100
                max_dd = max(max_dd, dd)
            equity_curve.append((ts, eq))

        final = self.broker.equity({symbol: float(primary["close"].iloc[-1])})
        pnl = final - equity_curve[0][1] if equity_curve else 0.0
        return BacktestResult(trades=trades, wins=wins, losses=losses, pnl=pnl,
                              final_equity=final, max_drawdown_pct=max_dd, equity_curve=equity_curve)
