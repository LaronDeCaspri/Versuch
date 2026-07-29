"""
Persistent journal (SQLite). Every filled order, every signal, every
kill-switch event is logged for later analytics.
"""
from __future__ import annotations

import json
import sqlite3
import threading
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path


@dataclass
class JournalEntry:
    ts: str
    kind: str                                            # signal | order | close | kill
    symbol: str
    side: str
    price: float
    qty: float = 0.0
    pnl: float = 0.0
    r_multiple: float = 0.0
    strategy: str = ""
    reasons: list[str] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


class Journal:
    def __init__(self, path: str | Path = "data/journal.sqlite"):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init()

    def _init(self) -> None:
        with self._conn() as c:
            c.execute("""CREATE TABLE IF NOT EXISTS entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                kind TEXT NOT NULL,
                symbol TEXT NOT NULL,
                side TEXT NOT NULL,
                price REAL NOT NULL,
                qty REAL NOT NULL DEFAULT 0,
                pnl REAL NOT NULL DEFAULT 0,
                r_multiple REAL NOT NULL DEFAULT 0,
                strategy TEXT NOT NULL DEFAULT '',
                reasons TEXT NOT NULL DEFAULT '[]',
                metadata TEXT NOT NULL DEFAULT '{}'
            )""")
            c.execute("CREATE INDEX IF NOT EXISTS idx_entries_ts ON entries(ts)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_entries_symbol ON entries(symbol)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_entries_strategy ON entries(strategy)")

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, isolation_level=None, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def log(self, entry: JournalEntry) -> None:
        with self._lock, self._conn() as c:
            c.execute("""INSERT INTO entries
                (ts, kind, symbol, side, price, qty, pnl, r_multiple, strategy, reasons, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (entry.ts, entry.kind, entry.symbol, entry.side, entry.price, entry.qty,
                 entry.pnl, entry.r_multiple, entry.strategy,
                 json.dumps(entry.reasons), json.dumps(entry.metadata)))

    def now(self) -> str:
        return datetime.now(timezone.utc).isoformat(timespec="seconds")

    def recent(self, limit: int = 100, kind: str | None = None) -> list[dict]:
        with self._conn() as c:
            if kind:
                rows = c.execute("SELECT * FROM entries WHERE kind = ? ORDER BY id DESC LIMIT ?",
                                 (kind, limit)).fetchall()
            else:
                rows = c.execute("SELECT * FROM entries ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [self._row(r) for r in rows]

    def all_closed(self) -> list[dict]:
        with self._conn() as c:
            rows = c.execute("SELECT * FROM entries WHERE kind = 'close' ORDER BY id").fetchall()
        return [self._row(r) for r in rows]

    def _row(self, r: sqlite3.Row) -> dict:
        d = dict(r)
        d["reasons"] = json.loads(d.get("reasons") or "[]")
        d["metadata"] = json.loads(d.get("metadata") or "{}")
        return d
