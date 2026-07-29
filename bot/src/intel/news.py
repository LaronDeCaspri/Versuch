"""
News aggregator over free public feeds. Deduplicates by title, sorts by time.
All sources are free and do not require an API key.

Sources:
  - Cointelegraph RSS
  - CoinDesk RSS
  - CryptoPanic public JSON
  - Reddit /r/cryptocurrency hot JSON
"""
from __future__ import annotations

import json
import re
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from ..core.logger import get

log = get(__name__)


@dataclass
class NewsItem:
    ts: str
    source: str
    title: str
    url: str
    summary: str = ""
    importance: int = 1                                  # 1..3

    def to_dict(self) -> dict:
        return asdict(self)


class NewsFeed:
    _HIGH_IMPACT = re.compile(
        r"(SEC|Fed|ETF|hack|exploit|liquidation|halving|approval|indict|ban|regulation|"
        r"Elon|Musk|Trump|Powell|CPI|inflation|rate hike|bankrupt|delisting)",
        re.IGNORECASE,
    )

    def __init__(self, cache_seconds: int = 300, ua: str = "TradingBot/0.1"):
        self.cache_seconds = cache_seconds
        self.ua = ua
        self._lock = threading.Lock()
        self._items: list[NewsItem] = []
        self._last_fetch: float = 0
        self._seen_ids: set[str] = set()

    def latest(self, limit: int = 30, min_importance: int = 1) -> list[NewsItem]:
        if time.time() - self._last_fetch > self.cache_seconds:
            self.refresh()
        with self._lock:
            return [n for n in self._items[:limit] if n.importance >= min_importance]

    def refresh(self) -> None:
        items: list[NewsItem] = []
        for fn in (self._fetch_cointelegraph, self._fetch_coindesk,
                   self._fetch_cryptopanic, self._fetch_reddit):
            try:
                items.extend(fn())
            except Exception as e:
                log.warning(f"news source failed: {fn.__name__}: {e}")
        # dedupe by title
        seen: set[str] = set()
        deduped: list[NewsItem] = []
        for i in sorted(items, key=lambda x: x.ts, reverse=True):
            key = i.title.lower().strip()
            if key in seen:
                continue
            seen.add(key)
            deduped.append(i)
        with self._lock:
            self._items = deduped[:100]
            self._last_fetch = time.time()

    def _http_get(self, url: str) -> bytes:
        req = urllib.request.Request(url, headers={"User-Agent": self.ua, "Accept": "*/*"})
        with urllib.request.urlopen(req, timeout=8) as r:
            return r.read()

    def _classify(self, text: str) -> int:
        if self._HIGH_IMPACT.search(text or ""):
            return 3
        if re.search(r"(BTC|Bitcoin|ETH|Ethereum|rally|crash|surge|dump)", text or "", re.IGNORECASE):
            return 2
        return 1

    def _parse_rss(self, xml_bytes: bytes, source: str) -> list[NewsItem]:
        root = ET.fromstring(xml_bytes)
        ns = {"content": "http://purl.org/rss/1.0/modules/content/"}
        out: list[NewsItem] = []
        for item in root.iter("item"):
            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            pub = (item.findtext("pubDate") or "").strip()
            desc = re.sub("<[^<]+?>", "", item.findtext("description") or "")[:280].strip()
            try:
                ts = datetime.strptime(pub[:25], "%a, %d %b %Y %H:%M:%S").replace(tzinfo=timezone.utc).isoformat()
            except Exception:
                ts = datetime.now(timezone.utc).isoformat()
            out.append(NewsItem(ts=ts, source=source, title=title, url=link,
                                summary=desc, importance=self._classify(title + " " + desc)))
        return out

    def _fetch_cointelegraph(self) -> list[NewsItem]:
        return self._parse_rss(self._http_get("https://cointelegraph.com/rss"), "Cointelegraph")

    def _fetch_coindesk(self) -> list[NewsItem]:
        return self._parse_rss(self._http_get("https://www.coindesk.com/arc/outboundfeeds/rss/"), "CoinDesk")

    def _fetch_cryptopanic(self) -> list[NewsItem]:
        raw = self._http_get("https://cryptopanic.com/api/free/v1/posts/?public=true")
        data = json.loads(raw.decode())
        out: list[NewsItem] = []
        for post in data.get("results", []):
            title = post.get("title", "")
            url = post.get("url", "")
            ts = post.get("published_at", datetime.now(timezone.utc).isoformat())
            src = (post.get("source") or {}).get("title", "CryptoPanic")
            out.append(NewsItem(ts=ts, source=src, title=title, url=url,
                                summary="", importance=self._classify(title)))
        return out

    def _fetch_reddit(self) -> list[NewsItem]:
        raw = self._http_get("https://www.reddit.com/r/cryptocurrency/hot.json?limit=20")
        data = json.loads(raw.decode())
        out: list[NewsItem] = []
        for post in data.get("data", {}).get("children", []):
            d = post.get("data", {})
            title = d.get("title", "")
            url = "https://reddit.com" + d.get("permalink", "")
            ts = datetime.fromtimestamp(d.get("created_utc", 0), tz=timezone.utc).isoformat()
            out.append(NewsItem(ts=ts, source="r/cryptocurrency", title=title, url=url,
                                summary=d.get("selftext", "")[:200],
                                importance=self._classify(title)))
        return out
