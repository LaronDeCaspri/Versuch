"""
Aggregate free public data sources for a bigger picture:

- CoinGecko /global                  → BTC dominance, total market cap, 24h vol
- CoinGecko /coins/markets           → top 20 coins price + 24h/7d change
- Binance /fapi/v1/premiumIndex      → funding rate per symbol
- Binance /futures/data/globalLongShortAccountRatio → long/short ratio
- Blockchain.info                    → BTC hashrate, mempool
- Alternative.me F&G                 → Crypto fear & greed

None of these require a key.
"""
from __future__ import annotations

import json
import threading
import time
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass, field

from ..core.logger import get

log = get(__name__)


@dataclass
class GlobalSnapshot:
    btc_dominance: float = 0.0
    total_market_cap_usd: float = 0.0
    total_volume_usd: float = 0.0
    active_cryptocurrencies: int = 0
    fear_greed: int = 50
    fear_greed_label: str = "Neutral"
    top_movers_24h: list[dict] = field(default_factory=list)
    funding_rates: dict[str, float] = field(default_factory=dict)
    long_short_ratio: dict[str, float] = field(default_factory=dict)
    btc_hashrate: float | None = None
    btc_mempool_txs: int | None = None
    updated_at: float = 0.0

    def to_dict(self) -> dict:
        return asdict(self)


class MarketIntel:
    def __init__(self, cache_seconds: int = 600, ua: str = "TradingBot/0.1"):
        self.cache = cache_seconds
        self.ua = ua
        self._lock = threading.Lock()
        self._snapshot = GlobalSnapshot()

    def snapshot(self, symbols: list[str] | None = None) -> GlobalSnapshot:
        if time.time() - self._snapshot.updated_at < self.cache:
            return self._snapshot
        s = GlobalSnapshot()
        try:
            data = json.loads(self._get("https://api.coingecko.com/api/v3/global"))
            d = data.get("data", {})
            s.btc_dominance = float(d.get("market_cap_percentage", {}).get("btc", 0))
            s.total_market_cap_usd = float(d.get("total_market_cap", {}).get("usd", 0))
            s.total_volume_usd = float(d.get("total_volume", {}).get("usd", 0))
            s.active_cryptocurrencies = int(d.get("active_cryptocurrencies", 0))
        except Exception as e:
            log.warning(f"coingecko global failed: {e}")
        try:
            data = json.loads(self._get(
                "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd"
                "&order=market_cap_desc&per_page=20&page=1&price_change_percentage=24h"))
            for coin in data:
                s.top_movers_24h.append({
                    "symbol": coin["symbol"].upper(),
                    "name": coin["name"],
                    "price": coin["current_price"],
                    "change_24h_pct": coin.get("price_change_percentage_24h", 0),
                    "mkt_cap": coin["market_cap"],
                })
            s.top_movers_24h.sort(key=lambda x: abs(x["change_24h_pct"] or 0), reverse=True)
        except Exception as e:
            log.warning(f"coingecko markets failed: {e}")
        try:
            data = json.loads(self._get("https://api.alternative.me/fng/?limit=1"))
            s.fear_greed = int(data["data"][0]["value"])
            s.fear_greed_label = data["data"][0]["value_classification"]
        except Exception as e:
            log.warning(f"fear&greed failed: {e}")
        symbols = symbols or ["BTC/USDT", "ETH/USDT", "SOL/USDT"]
        for sym in symbols:
            base_quote = sym.replace("/", "")
            try:
                url = f"https://fapi.binance.com/fapi/v1/premiumIndex?symbol={base_quote}"
                data = json.loads(self._get(url))
                s.funding_rates[sym] = float(data.get("lastFundingRate", 0)) * 100
            except Exception:
                pass
            try:
                url = (f"https://fapi.binance.com/futures/data/globalLongShortAccountRatio"
                       f"?symbol={base_quote}&period=1h&limit=1")
                data = json.loads(self._get(url))
                if data:
                    s.long_short_ratio[sym] = float(data[0].get("longShortRatio", 0))
            except Exception:
                pass
        try:
            s.btc_hashrate = float(self._get("https://blockchain.info/q/hashrate").decode())
        except Exception:
            pass
        try:
            data = json.loads(self._get("https://blockchain.info/q/unconfirmedcount?format=json"))
            s.btc_mempool_txs = int(data) if isinstance(data, int) else None
        except Exception:
            pass
        s.updated_at = time.time()
        with self._lock:
            self._snapshot = s
        return s

    def _get(self, url: str) -> bytes:
        req = urllib.request.Request(url, headers={"User-Agent": self.ua, "Accept": "*/*"})
        with urllib.request.urlopen(req, timeout=8) as r:
            return r.read()
