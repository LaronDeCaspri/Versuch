from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from tabulate import tabulate

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.backtest.runner import Backtest
from src.core.config import Config
from src.core.logger import setup
from src.data.market_data import MarketData
from src.strategies import Ensemble, REGISTRY


def main(days: int = 60) -> None:
    cfg = Config.load("config.yaml")
    setup(cfg.logging.get("level", "INFO"))
    md = MarketData(cfg)
    ensemble = Ensemble.from_config(cfg, REGISTRY)
    since = int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp() * 1000)
    rows = []
    for symbol in cfg.universe.symbols:
        primary_tf = cfg.universe.primary_timeframe
        try:
            primary = md.fetch_history(symbol, primary_tf, since_ms=since)
            higher = {tf: md.fetch_history(symbol, tf, since_ms=since)
                      for tf in cfg.universe.timeframes if tf != primary_tf}
        except Exception as e:
            print(f"skip {symbol}: {e}")
            continue
        bt = Backtest(cfg, ensemble)
        res = bt.run(primary, higher, symbol)
        rows.append([symbol, res.trades, res.wins, res.losses,
                     f"{res.pnl:.2f}", f"{res.final_equity:.2f}", f"{res.max_drawdown_pct:.2f}%"])
    print(tabulate(rows,
                   headers=["symbol", "trades", "wins", "losses", "pnl", "final", "max_dd"],
                   tablefmt="github"))


if __name__ == "__main__":
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    main(days=days)
