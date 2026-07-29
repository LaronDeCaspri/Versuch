from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.core.config import Config
from src.data.market_data import MarketData


def main(quote: str = "USDT") -> None:
    cfg = Config.load("config.yaml")
    md = MarketData(cfg)
    markets = md.load_markets()
    pairs = sorted(s for s in markets if s.endswith(f"/{quote}") and markets[s].get("active", True))
    print(f"{len(pairs)} pairs vs {quote} on {cfg.exchange.name}:")
    for p in pairs:
        print(p)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "USDT")
