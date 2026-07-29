from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from ..core.config import RiskCfg
from ..core.logger import get
from ..strategies.base import Side

log = get(__name__)


@dataclass
class PositionPlan:
    side: Side
    entry: float
    stop: float
    take_profits: list[tuple[float, float]]     # (price, fraction)
    size: float
    risk_amount: float


class RiskManager:
    def __init__(self, cfg: RiskCfg):
        self.cfg = cfg
        self.peak_equity: float = 0.0
        self.daily_start_equity: float = 0.0
        self.today: date | None = None
        self.halted: bool = False

    def new_day(self, equity: float) -> None:
        today = date.today()
        if self.today != today:
            self.today = today
            self.daily_start_equity = equity
            self.halted = False

    def check_kill_switch(self, equity: float) -> bool:
        if equity > self.peak_equity:
            self.peak_equity = equity
        if self.peak_equity > 0:
            dd = (self.peak_equity - equity) / self.peak_equity * 100
            if dd >= self.cfg.max_drawdown_pct:
                log.error(f"MAX DRAWDOWN reached: {dd:.2f}% >= {self.cfg.max_drawdown_pct}%")
                self.halted = True
        if self.daily_start_equity > 0:
            daily = (self.daily_start_equity - equity) / self.daily_start_equity * 100
            if daily >= self.cfg.max_daily_loss_pct:
                log.error(f"DAILY LOSS reached: {daily:.2f}% >= {self.cfg.max_daily_loss_pct}%")
                self.halted = True
        return self.halted

    def plan(self, side: Side, entry: float, atr: float, equity: float) -> PositionPlan | None:
        if atr <= 0 or entry <= 0 or equity <= 0:
            return None
        risk_amount = equity * self.cfg.risk_per_trade_pct / 100
        stop_distance = self.cfg.atr_stop_multiplier * atr
        if side is Side.LONG:
            stop = entry - stop_distance
        elif side is Side.SHORT:
            stop = entry + stop_distance
        else:
            return None
        if stop_distance <= 0:
            return None
        size = risk_amount / stop_distance
        tps: list[tuple[float, float]] = []
        remainder = 1.0
        for i, r in enumerate(self.cfg.take_profit_r_multiple):
            frac = 1.0 / len(self.cfg.take_profit_r_multiple) if i < len(self.cfg.take_profit_r_multiple) - 1 else remainder
            price = entry + r * stop_distance if side is Side.LONG else entry - r * stop_distance
            tps.append((price, frac))
            remainder -= frac
        return PositionPlan(side=side, entry=entry, stop=stop, take_profits=tps, size=size, risk_amount=risk_amount)
