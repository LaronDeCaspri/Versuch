"""
Announcement queue for the Jarvis voice assistant. The bot writes short
German phrases here whenever something noteworthy happens; the phone
frontend polls and speaks them via the browser's Web Speech API.
"""
from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, asdict
from datetime import datetime, timezone


@dataclass
class Announcement:
    id: str
    ts: str
    level: str                            # info | warn | alert | success
    text: str

    def to_dict(self) -> dict:
        return asdict(self)


class AnnouncementQueue:
    def __init__(self, max_items: int = 50):
        self._items: list[Announcement] = []
        self._delivered: set[str] = set()
        self._lock = threading.Lock()
        self._max = max_items

    def push(self, text: str, level: str = "info") -> Announcement:
        a = Announcement(
            id=str(uuid.uuid4())[:8],
            ts=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            level=level, text=text,
        )
        with self._lock:
            self._items.append(a)
            if len(self._items) > self._max:
                self._items = self._items[-self._max:]
        return a

    def pending(self) -> list[Announcement]:
        with self._lock:
            return [a for a in self._items if a.id not in self._delivered]

    def mark_delivered(self, ids: list[str]) -> None:
        with self._lock:
            for i in ids:
                self._delivered.add(i)

    def all(self, limit: int = 30) -> list[Announcement]:
        with self._lock:
            return self._items[-limit:]


def format_signal(action: str, symbol: str, entry: float, stop: float,
                  weighted_profit: float | None = None) -> str:
    pair = symbol.replace("/", " gegen ")
    verb = "Kaufsignal" if action == "BUY" else "Verkaufssignal" if action == "SELL" else "Ausstiegs-Signal"
    parts = [f"Neues {verb} für {pair} bei {entry:,.2f} Dollar",
             f"Stop-Loss bei {stop:,.2f}"]
    if weighted_profit is not None:
        parts.append(f"Prognose plus {weighted_profit:,.0f} Dollar")
    return ". ".join(parts) + "."


def format_close(symbol: str, kind: str, pnl: float) -> str:
    pair = symbol.replace("/", " gegen ")
    if kind == "tp":
        return f"Take Profit erreicht bei {pair}. Gewinn {pnl:,.2f} Dollar realisiert."
    if kind == "sl":
        return f"Stop-Loss ausgelöst bei {pair}. Verlust {abs(pnl):,.2f} Dollar."
    return f"Position geschlossen bei {pair}. PnL {pnl:,.2f} Dollar."


def format_news(title: str, source: str) -> str:
    return f"Wichtige Nachricht von {source}: {title}"


def format_fng(value: int, label: str) -> str:
    if value <= 20:
        return f"Extreme Angst im Markt: {value}. Templeton würde jetzt kaufen."
    if value >= 80:
        return f"Extreme Gier: {value}. Vorsicht, Soros und Paulson bereiten Shorts vor."
    return f"Marktstimmung {label}: {value}."
