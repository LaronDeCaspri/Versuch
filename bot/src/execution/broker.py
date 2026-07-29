from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone

from ..strategies.base import Side


@dataclass
class Order:
    id: str
    symbol: str
    side: Side
    qty: float
    price: float
    kind: str = "market"                     # market | limit | stop
    status: str = "open"
    filled_qty: float = 0.0
    avg_price: float = 0.0
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    metadata: dict = field(default_factory=dict)


@dataclass
class Position:
    symbol: str
    side: Side
    qty: float
    entry_price: float
    stop: float
    take_profits: list[tuple[float, float]] = field(default_factory=list)      # (price, absolute qty)
    opened_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    realized_pnl: float = 0.0
    original_qty: float = 0.0
    metadata: dict = field(default_factory=dict)


class Broker(ABC):
    @abstractmethod
    def equity(self) -> float: ...

    @abstractmethod
    def cash(self) -> float: ...

    @abstractmethod
    def positions(self) -> dict[str, Position]: ...

    @abstractmethod
    def submit_market(self, symbol: str, side: Side, qty: float, price_hint: float, metadata: dict | None = None) -> Order: ...

    @abstractmethod
    def close_position(self, symbol: str, price_hint: float, fraction: float = 1.0) -> Order | None: ...

    @abstractmethod
    def on_price(self, symbol: str, price: float) -> list[Order]: ...
