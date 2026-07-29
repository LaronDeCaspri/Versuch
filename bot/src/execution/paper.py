from __future__ import annotations

import uuid
from datetime import datetime, timezone

from ..core.logger import get
from ..strategies.base import Side
from .broker import Broker, Order, Position

log = get(__name__)


class PaperBroker(Broker):
    def __init__(self, starting_balance: float = 10_000.0, fee_bps: float = 4.0,
                 announcements=None):
        self._cash = starting_balance
        self._positions: dict[str, Position] = {}
        self._orders: list[Order] = []
        self.fee_bps = fee_bps
        self.equity_history: list[tuple[datetime, float]] = []
        self.announcements = announcements

    def equity(self, mark: dict[str, float] | None = None) -> float:
        eq = self._cash
        for sym, pos in self._positions.items():
            price = (mark or {}).get(sym, pos.entry_price)
            if pos.side is Side.LONG:
                eq += pos.qty * price
            else:
                eq += pos.qty * (2 * pos.entry_price - price)
        return eq

    def cash(self) -> float:
        return self._cash

    def positions(self) -> dict[str, Position]:
        return self._positions

    def _fee(self, notional: float) -> float:
        return notional * self.fee_bps / 10_000

    def submit_market(self, symbol: str, side: Side, qty: float, price_hint: float, metadata: dict | None = None) -> Order:
        oid = str(uuid.uuid4())
        notional = qty * price_hint
        fee = self._fee(notional)
        existing = self._positions.get(symbol)
        if existing and existing.side is not side:
            self.close_position(symbol, price_hint, fraction=1.0)
            existing = None
        if side is Side.LONG:
            self._cash -= notional + fee
        else:
            self._cash += notional - fee
        if existing:
            new_qty = existing.qty + qty
            existing.entry_price = (existing.entry_price * existing.qty + price_hint * qty) / new_qty
            existing.qty = new_qty
            existing.original_qty = new_qty
        else:
            tp_fracs: list[tuple[float, float]] = (metadata or {}).get("take_profits", [])
            tps_abs = [(p, qty * f) for p, f in tp_fracs]
            self._positions[symbol] = Position(
                symbol=symbol, side=side, qty=qty, entry_price=price_hint,
                stop=(metadata or {}).get("stop", 0.0),
                take_profits=tps_abs,
                original_qty=qty,
                metadata=metadata or {},
            )
        order = Order(id=oid, symbol=symbol, side=side, qty=qty, price=price_hint,
                      status="filled", filled_qty=qty, avg_price=price_hint, metadata=metadata or {})
        self._orders.append(order)
        log.info(f"PAPER {side.value.upper()} {symbol} qty={qty:.6f} @ {price_hint:.4f} fee={fee:.4f} cash={self._cash:.2f}")
        return order

    def close_position(self, symbol: str, price_hint: float, fraction: float = 1.0) -> Order | None:
        pos = self._positions.get(symbol)
        if pos is None or fraction <= 0:
            return None
        qty = pos.qty * min(fraction, 1.0)
        notional = qty * price_hint
        fee = self._fee(notional)
        if pos.side is Side.LONG:
            pnl = (price_hint - pos.entry_price) * qty - fee
            self._cash += notional - fee
        else:
            pnl = (pos.entry_price - price_hint) * qty - fee
            self._cash -= notional + fee
            self._cash += 2 * pos.entry_price * qty
        pos.realized_pnl += pnl
        pos.qty -= qty
        if pos.qty <= 1e-12:
            del self._positions[symbol]
        oid = str(uuid.uuid4())
        order = Order(id=oid, symbol=symbol, side=Side.SHORT if pos.side is Side.LONG else Side.LONG,
                      qty=qty, price=price_hint, status="filled", filled_qty=qty, avg_price=price_hint,
                      metadata={"closing": True, "pnl": pnl})
        self._orders.append(order)
        log.info(f"PAPER CLOSE {symbol} qty={qty:.6f} @ {price_hint:.4f} pnl={pnl:.4f}")
        return order

    def on_price(self, symbol: str, price: float) -> list[Order]:
        pos = self._positions.get(symbol)
        if pos is None:
            return []
        triggered: list[Order] = []
        if pos.stop:
            if pos.side is Side.LONG and price <= pos.stop:
                o = self.close_position(symbol, price, 1.0)
                if o:
                    triggered.append(o)
                    self._announce_close(symbol, "sl", o.metadata.get("pnl", 0.0))
                return triggered
            if pos.side is Side.SHORT and price >= pos.stop:
                o = self.close_position(symbol, price, 1.0)
                if o:
                    triggered.append(o)
                    self._announce_close(symbol, "sl", o.metadata.get("pnl", 0.0))
                return triggered
        remaining_tps: list[tuple[float, float]] = []
        for tp_price, tp_qty in pos.take_profits:
            hit_long = pos.side is Side.LONG and price >= tp_price
            hit_short = pos.side is Side.SHORT and price <= tp_price
            if hit_long or hit_short:
                cur_pos = self._positions.get(symbol)
                if cur_pos is None or cur_pos.qty <= 0:
                    continue
                frac = min(1.0, tp_qty / cur_pos.qty)
                o = self.close_position(symbol, price, frac)
                if o:
                    triggered.append(o)
                    self._announce_close(symbol, "tp", o.metadata.get("pnl", 0.0))
            else:
                remaining_tps.append((tp_price, tp_qty))
        if symbol in self._positions:
            self._positions[symbol].take_profits = remaining_tps
        return triggered

    def _announce_close(self, symbol: str, kind: str, pnl: float) -> None:
        if self.announcements is None:
            return
        from ..notify import format_close
        level = "success" if pnl >= 0 else "warn"
        self.announcements.push(format_close(symbol, kind, pnl), level=level)
