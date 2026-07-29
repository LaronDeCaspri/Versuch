from __future__ import annotations

import os
import sys
from pathlib import Path

import click
from tabulate import tabulate

sys.path.insert(0, str(Path(__file__).parent))

from src.core.config import Config
from src.core.engine import Engine
from src.core.logger import setup
from src.data.market_data import MarketData
from src.execution.ccxt_broker import CcxtBroker
from src.execution.paper import PaperBroker
from src.risk.manager import RiskManager
from src.strategies import Ensemble, REGISTRY
from src.knowledge import RULEBOOK


@click.group()
@click.option("--config", "config_path", default="config.yaml", show_default=True)
@click.pass_context
def cli(ctx: click.Context, config_path: str) -> None:
    cfg = Config.load(config_path)
    setup(cfg.logging.get("level", "INFO"), cfg.logging.get("file"))
    ctx.obj = cfg


@cli.command("rulebook")
def rulebook() -> None:
    for line in RULEBOOK:
        click.echo(line)


@cli.command("scan")
@click.pass_obj
def scan(cfg: Config) -> None:
    md = MarketData(cfg)
    md.refresh_all(cfg.universe.symbols, cfg.universe.timeframes, cfg.engine.warmup_candles)
    ensemble = Ensemble.from_config(cfg, REGISTRY)
    engine = Engine(cfg, md, PaperBroker(1.0), ensemble, RiskManager(cfg.risk))
    rows = []
    for sym in cfg.universe.symbols:
        s, side, score, sigs = engine._scan_symbol(sym)
        rows.append([s, side.value, f"{score:.2f}", ", ".join(x.strategy for x in sigs) or "-"])
    click.echo(tabulate(rows, headers=["symbol", "side", "score", "confirming"], tablefmt="github"))


@cli.command("run")
@click.option("--live", is_flag=True, help="Use real exchange (testnet honored via config).")
@click.pass_obj
def run(cfg: Config, live: bool) -> None:
    md = MarketData(cfg)
    if live:
        broker = CcxtBroker(md, quote=cfg.risk.account_currency)
        click.echo(f"broker: ccxt {cfg.exchange.name} (testnet={cfg.exchange.testnet})")
    else:
        start = float(os.environ.get("PAPER_START_BALANCE", "10000"))
        broker = PaperBroker(starting_balance=start)
        click.echo(f"broker: local paper (start={start} {cfg.risk.account_currency})")
    ensemble = Ensemble.from_config(cfg, REGISTRY)
    risk = RiskManager(cfg.risk)
    Engine(cfg, md, broker, ensemble, risk).run()


@cli.command("backtest")
@click.option("--symbol", required=True)
@click.option("--days", default=60, show_default=True)
@click.pass_obj
def backtest(cfg: Config, symbol: str, days: int) -> None:
    from datetime import datetime, timedelta, timezone
    from src.backtest.runner import Backtest

    md = MarketData(cfg)
    since = int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp() * 1000)
    primary_tf = cfg.universe.primary_timeframe
    click.echo(f"downloading {symbol} {primary_tf} for {days}d ...")
    primary = md.fetch_history(symbol, primary_tf, since_ms=since)
    higher = {}
    for tf in cfg.universe.timeframes:
        if tf == primary_tf:
            continue
        click.echo(f"downloading {symbol} {tf} ...")
        higher[tf] = md.fetch_history(symbol, tf, since_ms=since)
    ensemble = Ensemble.from_config(cfg, REGISTRY)
    bt = Backtest(cfg, ensemble, starting_balance=float(os.environ.get("PAPER_START_BALANCE", "10000")))
    result = bt.run(primary, higher, symbol)
    click.echo(result.summary())


@cli.command("webhook")
@click.pass_obj
def webhook(cfg: Config) -> None:
    from src.webhook import create_app, run_server

    md = MarketData(cfg)
    broker = PaperBroker(float(os.environ.get("PAPER_START_BALANCE", "10000")))
    risk = RiskManager(cfg.risk)

    def handler(payload: dict) -> None:
        symbol = payload.get("symbol")
        side = payload.get("side")
        price = float(payload.get("price") or md.ticker(symbol)["last"])
        if symbol is None or side is None:
            return
        from src.strategies.base import Side
        if side not in (Side.LONG, Side.SHORT):
            broker.close_position(symbol, price, 1.0)
            return
        df = md.fetch_ohlcv(symbol, cfg.universe.primary_timeframe, limit=200)
        from src.indicators import atr as atr_fn
        atr = float(atr_fn(df["high"], df["low"], df["close"], 14).iloc[-1])
        plan = risk.plan(side, price, atr, broker.equity({symbol: price}))
        if plan and plan.size > 0:
            broker.submit_market(symbol, side, plan.size, price,
                                 metadata={"stop": plan.stop, "take_profits": plan.take_profits})

    app = create_app(handler)
    host = os.environ.get("WEBHOOK_HOST", "0.0.0.0")
    port = int(os.environ.get("WEBHOOK_PORT", "8080"))
    click.echo(f"webhook listening on {host}:{port}/tv")
    run_server(app, host=host, port=port)


if __name__ == "__main__":
    cli()
