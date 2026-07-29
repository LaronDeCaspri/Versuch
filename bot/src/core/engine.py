from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from .. import indicators as ta
from ..data.market_data import MarketData
from ..execution.broker import Broker
from ..execution.pending import PendingStore
from ..journal import Journal, JournalEntry
from ..notify import Notifier
from ..notify.signals import event_from
from ..risk.manager import RiskManager
from ..strategies import Ensemble, REGISTRY, Side, StrategyContext
from .config import Config
from .logger import get

log = get(__name__)


class Engine:
    def __init__(self, cfg: Config, market: MarketData, broker: Broker, ensemble: Ensemble,
                 risk: RiskManager, notifier: Notifier | None = None,
                 pending: PendingStore | None = None, require_confirmation: bool = True,
                 journal: Journal | None = None):
        self.cfg = cfg
        self.market = market
        self.broker = broker
        self.ensemble = ensemble
        self.risk = risk
        self.notifier = notifier or Notifier()
        self.pending = pending or PendingStore()
        self.require_confirmation = require_confirmation
        self.journal = journal
        self._last_marks: dict[str, float] = {}

    def _log(self, kind: str, symbol: str, side: str, price: float, **kw) -> None:
        if self.journal is None:
            return
        try:
            self.journal.log(JournalEntry(
                ts=self.journal.now(), kind=kind, symbol=symbol, side=side, price=price,
                qty=kw.get("qty", 0.0), pnl=kw.get("pnl", 0.0),
                r_multiple=kw.get("r_multiple", 0.0),
                strategy=kw.get("strategy", ""),
                reasons=kw.get("reasons", []),
                metadata=kw.get("metadata", {}),
            ))
        except Exception as e:
            log.warning(f"journal log failed: {e}")

    def confirm_pending(self, pid: str) -> bool:
        p = self.pending.pop(pid)
        if p is None:
            return False
        metadata = {"stop": p.stop, "take_profits": p.take_profits, "score": p.score}
        try:
            self.broker.submit_market(p.symbol, p.side, p.size, p.entry, metadata=metadata)
            return True
        except Exception as e:
            log.error(f"confirm order failed {p.symbol}: {e}")
            return False

    def cancel_pending(self, pid: str) -> bool:
        return self.pending.pop(pid) is not None

    def _scan_symbol(self, symbol: str) -> tuple[str, Side, float, list]:
        primary_tf = self.cfg.universe.primary_timeframe
        candles = self.market.get(symbol, primary_tf)
        if candles is None or len(candles) < 60:
            return symbol, Side.FLAT, 0.0, []
        higher = {tf: self.market.get(symbol, tf) for tf in self.cfg.universe.timeframes
                  if tf != primary_tf and self.market.get(symbol, tf) is not None}
        ctx = StrategyContext(symbol=symbol, timeframe=primary_tf, candles=candles, higher_tf_candles=higher)
        side, score, sigs = self.ensemble.score(ctx)
        return symbol, side, score, sigs

    def _refresh(self) -> None:
        self.market.refresh_all(
            self.cfg.universe.symbols,
            self.cfg.universe.timeframes,
            self.cfg.engine.warmup_candles,
        )

    def _current_marks(self) -> dict[str, float]:
        marks: dict[str, float] = {}
        for s in self.cfg.universe.symbols:
            df = self.market.get(s, self.cfg.universe.primary_timeframe)
            if df is not None and len(df):
                marks[s] = float(df["close"].iloc[-1])
        self._last_marks = marks
        return marks

    def _manage_open_positions(self, marks: dict[str, float]) -> None:
        for sym, price in marks.items():
            self.broker.on_price(sym, price)

    def _act_on_signal(self, symbol: str, side: Side, score: float, sigs: list | None = None) -> None:
        if side is Side.FLAT:
            return
        positions = self.broker.positions()
        if symbol in positions:
            return
        if len(positions) >= self.cfg.risk.max_open_positions:
            log.info(f"max open positions reached, skipping {symbol}")
            return
        df = self.market.get(symbol, self.cfg.universe.primary_timeframe)
        if df is None or len(df) < 20:
            return
        price = float(df["close"].iloc[-1])
        atr = float(ta.atr(df["high"], df["low"], df["close"], 14).iloc[-1])
        equity = self.broker.equity(mark=self._last_marks) if hasattr(self.broker, "equity") else self.broker.cash()
        plan = self.risk.plan(side, price, atr, equity)
        if plan is None or plan.size <= 0:
            return
        metadata = {"stop": plan.stop, "take_profits": plan.take_profits, "score": score}
        tp_prices = [tp[0] for tp in plan.take_profits]
        reasons = [f"{s.strategy}: {s.reason}" for s in (sigs or [])][:5] or [f"score={score:.2f}"]
        event = event_from(symbol, side, price, plan.stop, tp_prices, score, reasons=reasons)
        self.notifier.fire(event)
        self._log("signal", symbol, side.value, price,
                  qty=plan.size, strategy=",".join(s.strategy for s in (sigs or []))[:80],
                  reasons=reasons, metadata={"stop": plan.stop, "tps": tp_prices, "score": score})
        if self.require_confirmation:
            self.pending.add(side, symbol, price, plan.stop, plan.take_profits, plan.size,
                             plan.risk_amount, score, reasons)
        else:
            try:
                self.broker.submit_market(symbol, side, plan.size, price, metadata=metadata)
            except Exception as e:
                log.error(f"order submit failed {symbol}: {e}")

    def tick(self) -> None:
        self._refresh()
        marks = self._current_marks()
        equity = self.broker.equity(mark=marks) if hasattr(self.broker, "equity") else self.broker.cash()
        self.risk.new_day(equity)
        if self.risk.check_kill_switch(equity):
            log.error("kill switch active, only managing open positions")
            self._manage_open_positions(marks)
            return
        self._manage_open_positions(marks)
        with ThreadPoolExecutor(max_workers=self.cfg.engine.parallel_scans) as pool:
            futs = {pool.submit(self._scan_symbol, s): s for s in self.cfg.universe.symbols}
            for fut in as_completed(futs):
                try:
                    symbol, side, score, sigs = fut.result()
                except Exception as e:
                    log.warning(f"scan failure: {e}")
                    continue
                if side is not Side.FLAT:
                    reasons = "; ".join(f"{s.strategy}={s.reason}" for s in sigs)
                    log.info(f"SIGNAL {symbol} {side.value} score={score:.2f} :: {reasons}")
                    self._act_on_signal(symbol, side, score, sigs)

    def run(self) -> None:
        log.info(f"engine start: {len(self.cfg.universe.symbols)} symbols, TF={self.cfg.universe.primary_timeframe}")
        while True:
            start = time.time()
            try:
                self.tick()
            except KeyboardInterrupt:
                log.info("interrupted by user")
                break
            except Exception as e:
                log.exception(f"tick error: {e}")
            elapsed = time.time() - start
            sleep_for = max(1.0, self.cfg.engine.loop_interval_seconds - elapsed)
            time.sleep(sleep_for)
