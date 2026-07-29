from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from ..core.logger import get
from ..strategies.base import Side

log = get(__name__)


@dataclass
class PendingSignal:
    id: str
    ts: str
    symbol: str
    side: Side
    entry: float
    stop: float
    take_profits: list[tuple[float, float]]                # (price, fraction)
    size: float
    risk_amount: float
    score: float
    reasons: list[str] = field(default_factory=list)

    def action(self) -> str:
        return "BUY" if self.side is Side.LONG else "SELL" if self.side is Side.SHORT else "EXIT"

    def forecast(self) -> dict:
        r = abs(self.entry - self.stop)
        weighted_profit = 0.0
        max_profit = 0.0
        r_targets: list[float] = []
        for tp_price, frac in self.take_profits:
            diff = (tp_price - self.entry) if self.side is Side.LONG else (self.entry - tp_price)
            weighted_profit += diff * self.size * frac
            max_profit = max(max_profit, diff * self.size)
            r_targets.append(round(diff / r, 2) if r > 0 else 0.0)
        loss_at_stop = self.risk_amount
        # simple probabilistic EV: assume 50% loss, then weight remaining 50% across TPs
        remaining_prob = 0.5
        ev = -0.5 * loss_at_stop
        for i, (tp_price, frac) in enumerate(self.take_profits):
            share = remaining_prob / len(self.take_profits)
            diff = (tp_price - self.entry) if self.side is Side.LONG else (self.entry - tp_price)
            ev += share * diff * self.size
        return {
            "loss_at_stop": round(loss_at_stop, 2),
            "weighted_profit": round(weighted_profit, 2),
            "max_profit_full_run": round(max_profit, 2),
            "expected_value_50_50": round(ev, 2),
            "r_multiples": r_targets,
            "risk_reward_final": round((r_targets[-1] if r_targets else 0.0), 2),
        }

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "ts": self.ts,
            "symbol": self.symbol,
            "action": self.action(),
            "side": self.side.value,
            "entry": self.entry,
            "stop": self.stop,
            "take_profits": [{"price": p, "fraction": f} for p, f in self.take_profits],
            "size": self.size,
            "risk_amount": self.risk_amount,
            "score": self.score,
            "reasons": self.reasons,
            "forecast": self.forecast(),
        }


class PendingStore:
    def __init__(self, max_pending: int = 20):
        self._items: dict[str, PendingSignal] = {}
        self._lock = threading.Lock()
        self._max = max_pending

    def add(self, side: Side, symbol: str, entry: float, stop: float,
            take_profits: list[tuple[float, float]], size: float, risk_amount: float,
            score: float, reasons: list[str]) -> PendingSignal:
        p = PendingSignal(
            id=str(uuid.uuid4())[:8],
            ts=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            symbol=symbol, side=side, entry=entry, stop=stop,
            take_profits=take_profits, size=size, risk_amount=risk_amount,
            score=score, reasons=reasons,
        )
        with self._lock:
            for k in list(self._items):
                if self._items[k].symbol == symbol:      # newer beats older for same symbol
                    del self._items[k]
            self._items[p.id] = p
            if len(self._items) > self._max:
                oldest = sorted(self._items.values(), key=lambda x: x.ts)[0]
                del self._items[oldest.id]
        log.info(f"PENDING {p.action()} {p.symbol} entry={p.entry:.4f} stop={p.stop:.4f} id={p.id}")
        return p

    def list(self) -> list[PendingSignal]:
        with self._lock:
            return sorted(self._items.values(), key=lambda x: x.ts, reverse=True)

    def get(self, pid: str) -> PendingSignal | None:
        with self._lock:
            return self._items.get(pid)

    def pop(self, pid: str) -> PendingSignal | None:
        with self._lock:
            return self._items.pop(pid, None)

    def clear_symbol(self, symbol: str) -> None:
        with self._lock:
            for k in [k for k, v in self._items.items() if v.symbol == symbol]:
                del self._items[k]
