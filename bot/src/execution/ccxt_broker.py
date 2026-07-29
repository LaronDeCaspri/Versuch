from __future__ import annotations

import uuid

from ..core.logger import get
from ..data.market_data import MarketData
from ..strategies.base import Side
from .broker import Broker, Order, Position

log = get(__name__)


class CcxtBroker(Broker):
    """
    Broker backed by a real exchange via ccxt. Works with any exchange sandbox
    (Binance testnet, Bybit testnet, OKX demo, etc.). Stops and TPs are tracked
    client-side and executed as market orders when the price crosses.
    """

    def __init__(self, market_data: MarketData, quote: str = "USDT"):
        self.md = market_data
        self.ex = market_data.exchange
        self.quote = quote
        self._positions: dict[str, Position] = {}

    def _balance(self) -> dict:
        return self.ex.fetch_balance()

    def cash(self) -> float:
        b = self._balance()
        return float(b.get(self.quote, {}).get("free", 0.0) or 0.0)

    def equity(self, mark: dict[str, float] | None = None) -> float:
        b = self._balance()
        total = float(b.get(self.quote, {}).get("total", 0.0) or 0.0)
        for sym, pos in self._positions.items():
            price = (mark or {}).get(sym)
            if price is None:
                try:
                    price = float(self.md.ticker(sym)["last"])
                except Exception:
                    price = pos.entry_price
            if pos.side is Side.LONG:
                total += pos.qty * price
            else:
                total += pos.qty * (2 * pos.entry_price - price)
        return total

    def positions(self) -> dict[str, Position]:
        return self._positions

    def submit_market(self, symbol: str, side: Side, qty: float, price_hint: float, metadata: dict | None = None) -> Order:
        ccxt_side = "buy" if side is Side.LONG else "sell"
        result = self.ex.create_order(symbol, "market", ccxt_side, qty)
        fill_price = float(result.get("average") or result.get("price") or price_hint)
        oid = str(result.get("id") or uuid.uuid4())
        tp_fracs: list[tuple[float, float]] = (metadata or {}).get("take_profits", [])
        tps_abs = [(p, qty * f) for p, f in tp_fracs]
        self._positions[symbol] = Position(
            symbol=symbol, side=side, qty=qty, entry_price=fill_price,
            stop=(metadata or {}).get("stop", 0.0),
            take_profits=tps_abs,
            original_qty=qty,
            metadata=metadata or {},
        )
        log.info(f"LIVE {ccxt_side.upper()} {symbol} qty={qty} @ {fill_price} id={oid}")
        return Order(id=oid, symbol=symbol, side=side, qty=qty, price=fill_price,
                     status="filled", filled_qty=qty, avg_price=fill_price, metadata=metadata or {})

    def close_position(self, symbol: str, price_hint: float, fraction: float = 1.0) -> Order | None:
        pos = self._positions.get(symbol)
        if pos is None or fraction <= 0:
            return None
        qty = pos.qty * min(fraction, 1.0)
        ccxt_side = "sell" if pos.side is Side.LONG else "buy"
        result = self.ex.create_order(symbol, "market", ccxt_side, qty)
        fill_price = float(result.get("average") or result.get("price") or price_hint)
        pos.qty -= qty
        if pos.qty <= 1e-12:
            del self._positions[symbol]
        oid = str(result.get("id") or uuid.uuid4())
        log.info(f"LIVE CLOSE {symbol} qty={qty} @ {fill_price} id={oid}")
        return Order(id=oid, symbol=symbol, side=Side.SHORT if pos.side is Side.LONG else Side.LONG,
                     qty=qty, price=fill_price, status="filled", filled_qty=qty, avg_price=fill_price)

    def on_price(self, symbol: str, price: float) -> list[Order]:
        pos = self._positions.get(symbol)
        if pos is None:
            return []
        triggered: list[Order] = []
        if pos.stop:
            if pos.side is Side.LONG and price <= pos.stop:
                o = self.close_position(symbol, price, 1.0)
                if o: triggered.append(o)
                return triggered
            if pos.side is Side.SHORT and price >= pos.stop:
                o = self.close_position(symbol, price, 1.0)
                if o: triggered.append(o)
                return triggered
        remaining: list[tuple[float, float]] = []
        for tp_price, tp_qty in pos.take_profits:
            hit_long = pos.side is Side.LONG and price >= tp_price
            hit_short = pos.side is Side.SHORT and price <= tp_price
            if hit_long or hit_short:
                cur_pos = self._positions.get(symbol)
                if cur_pos is None or cur_pos.qty <= 0:
                    continue
                frac = min(1.0, tp_qty / cur_pos.qty)
                o = self.close_position(symbol, price, frac)
                if o: triggered.append(o)
            else:
                remaining.append((tp_price, tp_qty))
        if symbol in self._positions:
            self._positions[symbol].take_profits = remaining
        return triggered
