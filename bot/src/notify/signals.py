from __future__ import annotations

import json
import os
import threading
import time
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Callable

from ..core.logger import get
from ..strategies.base import Side

log = get(__name__)


@dataclass
class SignalEvent:
    ts: str
    symbol: str
    action: str                     # BUY, SELL, EXIT
    side: str                       # long, short, flat
    entry: float
    stop: float
    take_profits: list[float]
    score: float
    reasons: list[str]
    r_multiple_targets: list[float] = field(default_factory=list)

    def summary(self) -> str:
        tps = " / ".join(f"{tp:.2f}" for tp in self.take_profits) if self.take_profits else "–"
        return (f"{self.action} {self.symbol}  entry {self.entry:.2f}  "
                f"SL {self.stop:.2f}  TP {tps}  score {self.score:.2f}")

    def to_dict(self) -> dict:
        return asdict(self)


class Notifier:
    """
    Fans a SignalEvent out to multiple sinks:
      * console (rich log)
      * ntfy.sh push  — appears on the Android lock screen with sound
      * webhook       — user-defined URL, JSON POST
      * in-memory queue for the PWA to poll
    Deduplicated per (symbol, action) within `cooldown_seconds`.
    """

    def __init__(self,
                 ntfy_topic: str | None = None,
                 ntfy_server: str = "https://ntfy.sh",
                 webhook_url: str | None = None,
                 cooldown_seconds: int = 900,
                 max_history: int = 100):
        self.ntfy_topic = ntfy_topic or os.environ.get("NTFY_TOPIC")
        self.ntfy_server = ntfy_server.rstrip("/")
        self.webhook_url = webhook_url or os.environ.get("SIGNAL_WEBHOOK")
        self.cooldown_seconds = cooldown_seconds
        self.max_history = max_history
        self._history: list[SignalEvent] = []
        self._last_fired: dict[tuple[str, str], float] = {}
        self._lock = threading.Lock()
        self._subscribers: list[Callable[[SignalEvent], None]] = []

    def subscribe(self, cb: Callable[[SignalEvent], None]) -> None:
        self._subscribers.append(cb)

    def fire(self, event: SignalEvent) -> bool:
        key = (event.symbol, event.action)
        now = time.time()
        with self._lock:
            last = self._last_fired.get(key, 0)
            if now - last < self.cooldown_seconds:
                return False
            self._last_fired[key] = now
            self._history.append(event)
            if len(self._history) > self.max_history:
                self._history = self._history[-self.max_history:]
        log.warning(f"SIGNAL {event.summary()}")
        for cb in self._subscribers:
            try:
                cb(event)
            except Exception as e:
                log.warning(f"subscriber failed: {e}")
        self._send_ntfy(event)
        self._send_webhook(event)
        return True

    def latest(self) -> SignalEvent | None:
        with self._lock:
            return self._history[-1] if self._history else None

    def history(self) -> list[SignalEvent]:
        with self._lock:
            return list(self._history)

    def _send_ntfy(self, event: SignalEvent) -> None:
        if not self.ntfy_topic:
            return
        url = f"{self.ntfy_server}/{self.ntfy_topic}"
        headers = {
            "Title": f"{event.action}  {event.symbol}  @  {event.entry:.2f}".encode(),
            "Priority": b"5",                            # max = lock-screen wake + sound
            "Tags": ("chart_with_upwards_trend" if event.side == "long"
                     else "chart_with_downwards_trend" if event.side == "short"
                     else "octagonal_sign").encode(),
            "Click": b"https://claude.ai",               # replace with your own dashboard URL
        }
        tp_str = " / ".join(f"{tp:.2f}" for tp in event.take_profits) or "-"
        body = (f"{event.action} {event.symbol}\n"
                f"Entry {event.entry:.2f}\n"
                f"Stop  {event.stop:.2f}\n"
                f"TP    {tp_str}\n"
                f"Score {event.score:.2f}\n"
                f"{', '.join(event.reasons[:3])}").encode()
        req = urllib.request.Request(url, data=body, method="POST", headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=5) as _:
                pass
        except Exception as e:
            log.warning(f"ntfy push failed: {e}")

    def _send_webhook(self, event: SignalEvent) -> None:
        if not self.webhook_url:
            return
        body = json.dumps(event.to_dict()).encode()
        req = urllib.request.Request(self.webhook_url, data=body, method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=5) as _:
                pass
        except Exception as e:
            log.warning(f"webhook post failed: {e}")


def event_from(symbol: str, side: Side, entry: float, stop: float,
               take_profits: list[float], score: float, reasons: list[str]) -> SignalEvent:
    action = "BUY" if side is Side.LONG else "SELL" if side is Side.SHORT else "EXIT"
    r = abs(entry - stop)
    r_targets = [abs(tp - entry) / r if r > 0 else 0.0 for tp in take_profits]
    return SignalEvent(
        ts=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        symbol=symbol, action=action, side=side.value,
        entry=entry, stop=stop, take_profits=take_profits,
        score=score, reasons=reasons, r_multiple_targets=r_targets,
    )
