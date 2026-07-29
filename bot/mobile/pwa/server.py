"""
Mobile control panel for the trading bot. Runs a Flask server that also serves
a PWA (installable on Android from Chrome via 'Add to Home Screen'). Exposes
JSON endpoints so the frontend can start/stop the bot, list positions, browse
signals, and inspect the equity curve.

Usage:
    cd bot
    python -m mobile.pwa.server

Then open http://<host>:8090 on your phone in Chrome, tap the menu and choose
"App installieren" / "Add to Home Screen". The bot backend runs in a background
thread inside this process.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
import urllib.request
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_from_directory

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from dataclasses import asdict as _asdict

def asdict_safe(x):
    return _asdict(x)

from src import indicators as ta
from src.analytics import compute_performance, correlation_matrix
from src.charts import render_annotated_chart
from src.intel import MarketIntel, NewsFeed
from src.journal import Journal
from src.patterns import PatternDetector
from src.risk.assessor import assess as assess_risk
from src.strategies import Side, StrategyContext
from src.core.config import Config
from src.core.engine import Engine
from src.core.logger import setup
from src.data.market_data import MarketData
from src.execution.paper import PaperBroker
from src.knowledge import PRINCIPLES, READING_LIST, RULEBOOK
from src.notify import AnnouncementQueue, Notifier, format_fng, format_news
from src.risk.manager import RiskManager
from src.strategies import Ensemble, REGISTRY


BASE = Path(__file__).parent


class BotService:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.market = MarketData(cfg)
        self.broker = PaperBroker(float(os.environ.get("PAPER_START_BALANCE", "10000")))
        self.ensemble = Ensemble.from_config(cfg, REGISTRY)
        self.risk = RiskManager(cfg.risk)
        self.notifier = Notifier(
            ntfy_topic=os.environ.get("NTFY_TOPIC"),
            ntfy_server=os.environ.get("NTFY_SERVER", "https://ntfy.sh"),
            cooldown_seconds=int(os.environ.get("SIGNAL_COOLDOWN", "600")),
        )
        self.announcements = AnnouncementQueue()
        self.broker.announcements = self.announcements
        self.journal = Journal(os.environ.get("JOURNAL_PATH", "data/journal.sqlite"))
        self.engine = Engine(cfg, self.market, self.broker, self.ensemble, self.risk,
                             notifier=self.notifier, journal=self.journal,
                             announcements=self.announcements)
        self._last_fng_bucket: int | None = None
        self._seen_news_ids: set[str] = set()
        self.news = NewsFeed(cache_seconds=300)
        self.intel = MarketIntel(cache_seconds=600)
        self._thread: threading.Thread | None = None
        self._running = False
        self._last_signals: list[dict] = []

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._running = False

    def _loop(self) -> None:
        while self._running:
            try:
                self.engine.tick()
            except Exception as e:
                print(f"engine error: {e}", file=sys.stderr)
            time.sleep(self.cfg.engine.loop_interval_seconds)

    def status(self) -> dict:
        marks = {s: float(self.market.get(s, self.cfg.universe.primary_timeframe)["close"].iloc[-1])
                 for s in self.cfg.universe.symbols
                 if self.market.get(s, self.cfg.universe.primary_timeframe) is not None
                 and len(self.market.get(s, self.cfg.universe.primary_timeframe))}
        return {
            "running": self._running,
            "equity": self.broker.equity(marks),
            "cash": self.broker.cash(),
            "positions": [
                {"symbol": p.symbol, "side": p.side.value, "qty": p.qty,
                 "entry": p.entry_price, "stop": p.stop, "pnl": p.realized_pnl}
                for p in self.broker.positions().values()
            ],
            "marks": marks,
        }

    def scan_once(self) -> list[dict]:
        self.market.refresh_all(self.cfg.universe.symbols, self.cfg.universe.timeframes,
                                self.cfg.engine.warmup_candles)
        rows = []
        for sym in self.cfg.universe.symbols:
            s, side, score, sigs = self.engine._scan_symbol(sym)
            rows.append({"symbol": s, "side": side.value, "score": round(score, 2),
                         "signals": [{"strategy": x.strategy, "reason": x.reason} for x in sigs]})
        self._last_signals = rows
        return rows


def create_app(service: "BotService | None" = None) -> Flask:
    setup("INFO", "logs/bot.log")
    cfg = Config.load("config.yaml")
    service = service or BotService(cfg)

    app = Flask(__name__, template_folder=str(BASE / "templates"), static_folder=str(BASE / "static"))

    @app.get("/")
    def index():
        return render_template("index.html", symbols=cfg.universe.symbols,
                               strategies=sorted(REGISTRY))

    @app.get("/manifest.json")
    def manifest():
        return send_from_directory(BASE / "static", "manifest.json", mimetype="application/manifest+json")

    @app.get("/sw.js")
    def service_worker():
        return send_from_directory(BASE / "static", "sw.js", mimetype="application/javascript")

    @app.get("/api/status")
    def status_api():
        return jsonify(service.status())

    @app.post("/api/start")
    def start_api():
        service.start()
        return jsonify({"running": True})

    @app.post("/api/stop")
    def stop_api():
        service.stop()
        return jsonify({"running": False})

    @app.post("/api/scan")
    def scan_api():
        return jsonify(service.scan_once())

    @app.get("/api/knowledge")
    def knowledge():
        return jsonify({"rulebook": RULEBOOK, "principles": PRINCIPLES, "reading_list": READING_LIST})

    @app.get("/api/current-signal")
    def current_signal():
        ev = service.notifier.latest()
        return jsonify(ev.to_dict() if ev else None)

    @app.get("/api/signal-history")
    def signal_history():
        return jsonify([e.to_dict() for e in service.notifier.history()])

    @app.get("/api/light")
    def traffic_light():
        """
        Simple traffic-light for the phone: returns BUY / SELL / HOLD based on
        the strongest current ensemble score across the whole universe.
        """
        best_side = "flat"
        best_score = 0.0
        best_symbol = None
        best_sigs = []
        for sym in cfg.universe.symbols:
            s, side, score, sigs = service.engine._scan_symbol(sym)
            if score > best_score:
                best_side, best_score, best_symbol, best_sigs = side.value, score, sym, sigs
        action = "BUY" if best_side == "long" else "SELL" if best_side == "short" else "HOLD"
        color = "green" if action == "BUY" else "red" if action == "SELL" else "grey"
        return jsonify({
            "action": action,
            "color": color,
            "symbol": best_symbol,
            "score": round(best_score, 2),
            "reasons": [{"strategy": x.strategy, "reason": x.reason} for x in best_sigs],
        })

    @app.get("/api/pending")
    def list_pending():
        out = []
        det = PatternDetector()
        for p in service.engine.pending.list():
            d = p.to_dict()
            df = service.market.get(p.symbol, cfg.universe.primary_timeframe)
            if df is not None and len(df) >= 60:
                other = {s: service.market.get(s, cfg.universe.primary_timeframe)
                         for s in service.broker.positions()}
                ra = assess_risk(p.side, p.entry, p.stop, p.risk_amount,
                                 service.broker.equity({p.symbol: p.entry}),
                                 df, list(service.broker.positions().keys()),
                                 other, symbol=p.symbol)
                d["risk"] = ra.to_dict()
                d["patterns"] = [pat.to_dict() for pat in det.detect(df)[:3]]
                d["chart_url"] = f"/api/chart/{p.symbol.replace('/', '_')}.png?pid={p.id}"
            out.append(d)
        return jsonify(out)

    @app.get("/api/chart/<sym>.png")
    def chart_png(sym: str):
        from flask import Response, request as flask_req
        symbol = sym.replace("_", "/")
        df = service.market.get(symbol, cfg.universe.primary_timeframe)
        if df is None or len(df) < 60:
            return Response(status=404)
        entry = stop = None
        tps: list[float] = []
        side = "long"
        pid = flask_req.args.get("pid")
        pat_list: list[dict] = []
        if pid:
            p = service.engine.pending.get(pid)
            if p:
                entry, stop, side = p.entry, p.stop, p.side.value
                tps = [t[0] for t in p.take_profits]
        try:
            det = PatternDetector()
            pat_list = [x.to_dict() for x in det.detect(df)[:3]]
        except Exception:
            pass
        png = render_annotated_chart(df, symbol=symbol, timeframe=cfg.universe.primary_timeframe,
                                     entry=entry, stop=stop, take_profits=tps,
                                     patterns=pat_list, side=side)
        return Response(png, mimetype="image/png",
                        headers={"Cache-Control": "no-store"})

    @app.post("/api/mode")
    def set_mode():
        from flask import request as flask_req
        auto = flask_req.args.get("auto", "false").lower() == "true"
        service.engine.require_confirmation = not auto
        return jsonify({"auto": auto})

    @app.get("/api/mode")
    def get_mode():
        return jsonify({"auto": not service.engine.require_confirmation})

    @app.post("/api/pending/<pid>/confirm")
    def confirm_pending(pid: str):
        ok = service.engine.confirm_pending(pid)
        return jsonify({"ok": ok})

    @app.post("/api/pending/<pid>/cancel")
    def cancel_pending(pid: str):
        ok = service.engine.cancel_pending(pid)
        return jsonify({"ok": ok})

    @app.get("/api/fear-greed")
    def fear_greed():
        """
        Crypto Fear & Greed Index — free public API by alternative.me.
        No key needed. Values 0..100 (0 = extreme fear, 100 = extreme greed).
        Templeton buys < 20, Buffett quietly loads < 30, Soros / Paulson
        prepare shorts > 80. Cached in-process for 30 minutes.
        """
        cache = getattr(fear_greed, "_cache", None)
        if cache and time.time() - cache["ts"] < 1800:
            return jsonify(cache["data"])
        try:
            with urllib.request.urlopen("https://api.alternative.me/fng/?limit=1", timeout=5) as r:
                raw = json.loads(r.read().decode())
                d = raw["data"][0]
                data = {"value": int(d["value"]), "classification": d["value_classification"]}
        except Exception as e:
            data = {"value": 50, "classification": "Neutral", "error": str(e)}
        fear_greed._cache = {"ts": time.time(), "data": data}
        # announce regime shifts (extreme fear / greed)
        bucket = 1 if data["value"] <= 20 else (2 if data["value"] >= 80 else 0)
        if bucket != 0 and service._last_fng_bucket != bucket:
            service.announcements.push(format_fng(data["value"], data.get("classification", "")),
                                       level="alert" if bucket else "info")
        service._last_fng_bucket = bucket
        return jsonify(data)

    @app.get("/api/confluence")
    def confluence():
        """
        For each active symbol, count how many indicators point up vs down
        (same set as MegaConfluence). Returns a normalized 0..100 confluence
        score per symbol plus per-timeframe direction dots.
        """
        result = []
        for sym in cfg.universe.symbols:
            row = {"symbol": sym, "tf": {}}
            long_v = short_v = total = 0
            for tf in cfg.universe.timeframes:
                df = service.market.get(sym, tf)
                if df is None or len(df) < 210:
                    row["tf"][tf] = "flat"
                    continue
                h, l, c, v = df["high"], df["low"], df["close"], df["volume"]
                votes = 0
                e20, e50, e200 = ta.ema(c, 20), ta.ema(c, 50), ta.ema(c, 200)
                votes += 1 if e20.iloc[-1] > e50.iloc[-1] else -1
                votes += 1 if e50.iloc[-1] > e200.iloc[-1] else -1
                m = ta.macd(c)
                votes += 1 if m["hist"].iloc[-1] > 0 else -1
                r = ta.rsi(c, 14).iloc[-1]
                votes += 1 if float(r) > 50 else -1
                o = ta.obv(c, v)
                votes += 1 if float(o.iloc[-1]) > float(o.rolling(20).mean().iloc[-1]) else -1
                row["tf"][tf] = "up" if votes >= 2 else ("down" if votes <= -2 else "flat")
                total += 5
                long_v += max(votes, 0)
                short_v += max(-votes, 0)
            score = 0
            if total:
                score = int((long_v - short_v) / total * 100)
            row["score"] = score
            result.append(row)
        return jsonify(result)

    @app.get("/api/announcements")
    def announcements_pending():
        return jsonify([a.to_dict() for a in service.announcements.pending()])

    @app.post("/api/announcements/ack")
    def announcements_ack():
        ids = request.get_json(silent=True) or []
        service.announcements.mark_delivered(list(ids))
        return jsonify({"ok": True})

    @app.post("/api/announcements/say")
    def announcements_say():
        data = request.get_json(silent=True) or {}
        text = str(data.get("text", "")).strip()
        if text:
            service.announcements.push(text, level=str(data.get("level", "info")))
        return jsonify({"ok": True})

    @app.get("/api/news")
    def news():
        items = service.news.latest(limit=30)
        # push high-importance news that we haven't announced yet
        for i in items:
            if i.importance >= 3 and i.title not in service._seen_news_ids:
                service._seen_news_ids.add(i.title)
                service.announcements.push(format_news(i.title, i.source), level="warn")
        return jsonify([i.to_dict() for i in items])

    @app.get("/api/news/important")
    def news_important():
        items = service.news.latest(limit=10, min_importance=3)
        return jsonify([i.to_dict() for i in items])

    @app.get("/api/intel")
    def intel():
        snap = service.intel.snapshot(cfg.universe.symbols)
        return jsonify(snap.to_dict())

    @app.get("/api/analytics")
    def analytics():
        closed = service.journal.all_closed()
        report = compute_performance(closed)
        return jsonify(asdict_safe(report))

    @app.get("/api/journal")
    def journal_recent():
        return jsonify(service.journal.recent(limit=100))

    @app.get("/api/correlation")
    def correlation():
        closes = {}
        for sym in cfg.universe.symbols:
            df = service.market.get(sym, cfg.universe.primary_timeframe)
            if df is not None and len(df) > 50:
                closes[sym] = df["close"]
        m = correlation_matrix(closes)
        return jsonify({"symbols": list(m.columns), "matrix": m.values.tolist()})

    @app.get("/api/tv-widget/<path:symbol>")
    def tv_widget(symbol: str):
        """
        Redirect to a public TradingView widget URL for embedding real charts
        into an iframe on the phone. Free, no key required.
        """
        binance_symbol = "BINANCE:" + symbol.replace("/", "").upper()
        return jsonify({
            "widget_url": f"https://s.tradingview.com/widgetembed/?symbol={binance_symbol}&interval=15&theme=dark&style=1&locale=en",
            "chart_url": f"https://www.tradingview.com/chart/?symbol={binance_symbol}",
        })

    @app.post("/api/history-backfill")
    def history_backfill():
        from datetime import datetime, timedelta, timezone
        days = int(request.args.get("days", 365))
        since = int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp() * 1000)
        count = 0
        for sym in cfg.universe.symbols:
            for tf in ["1d", "4h", "1h"]:
                try:
                    df = service.market.fetch_history(sym, tf, since_ms=since)
                    count += len(df)
                except Exception as e:
                    log_msg = str(e)[:120]
                    print(f"backfill {sym} {tf}: {log_msg}")
        return jsonify({"loaded_candles": count, "days": days})

    @app.get("/api/patterns")
    def patterns():
        det = PatternDetector()
        out = []
        for sym in cfg.universe.symbols:
            for tf in cfg.universe.timeframes:
                df = service.market.get(sym, tf)
                if df is None or len(df) < 60:
                    continue
                pats = det.detect(df)
                for p in pats:
                    d = p.to_dict()
                    d["symbol"] = sym
                    d["timeframe"] = tf
                    out.append(d)
        out.sort(key=lambda x: x["confidence"], reverse=True)
        return jsonify(out[:30])

    @app.get("/api/council")
    def council():
        """
        Which of the 10 trader personas fired for which symbol right now.
        Presents their verdict as a mini scoreboard on the phone.
        """
        traders = [k for k in REGISTRY if k in {
            "soros_reflexivity", "buffett_value", "ptj_crash", "paulson_bubble",
            "livermore_pivot", "einhorn_bear", "dalio_allweather",
            "templeton_pessimism", "tepper_distressed", "ackman_conviction",
        }]
        out = []
        strategies_active = {k: REGISTRY[k](cfg.strategies.get(k, {})) for k in traders}
        for sym in cfg.universe.symbols:
            df = service.market.get(sym, cfg.universe.primary_timeframe)
            if df is None or len(df) < 60:
                continue
            higher = {tf: service.market.get(sym, tf) for tf in cfg.universe.timeframes
                      if tf != cfg.universe.primary_timeframe and service.market.get(sym, tf) is not None}
            ctx = StrategyContext(symbol=sym, timeframe=cfg.universe.primary_timeframe,
                                  candles=df, higher_tf_candles=higher)
            for name, strat in strategies_active.items():
                try:
                    sig = strat.evaluate(ctx)
                except Exception:
                    continue
                if sig is None or sig.side is Side.FLAT:
                    continue
                out.append({"trader": name, "symbol": sym, "side": sig.side.value, "reason": sig.reason})
        return jsonify(out)

    @app.get("/api/config")
    def config_api():
        return jsonify({
            "exchange": cfg.exchange.name,
            "testnet": cfg.exchange.testnet,
            "symbols": cfg.universe.symbols,
            "timeframes": cfg.universe.timeframes,
            "primary_timeframe": cfg.universe.primary_timeframe,
            "strategies": {k: bool(v.get("enabled")) for k, v in cfg.strategies.items()},
            "risk": {
                "risk_per_trade_pct": cfg.risk.risk_per_trade_pct,
                "max_open_positions": cfg.risk.max_open_positions,
                "max_daily_loss_pct": cfg.risk.max_daily_loss_pct,
                "max_drawdown_pct": cfg.risk.max_drawdown_pct,
            },
        })

    return app


def main() -> None:
    host = os.environ.get("PWA_HOST", "0.0.0.0")
    port = int(os.environ.get("PWA_PORT", "8090"))
    app = create_app()
    print(f"open http://{host}:{port} on your phone", flush=True)
    app.run(host=host, port=port, debug=False, use_reloader=False, threaded=True)


if __name__ == "__main__":
    main()
