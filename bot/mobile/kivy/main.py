"""
Kivy Android app skeleton — packages the bot as a real APK via Buildozer.
Runs the engine in a background thread and lets the user start/stop/scan.

Build (on a Linux host with buildozer/Java/Android SDK):
    cd bot/mobile/kivy
    pip install buildozer cython
    buildozer -v android debug
The APK lands in bin/. On the phone, allow installation from unknown sources.
"""
from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

from kivy.app import App
from kivy.clock import Clock
from kivy.uix.boxlayout import BoxLayout
from kivy.uix.button import Button
from kivy.uix.label import Label
from kivy.uix.scrollview import ScrollView

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from src.core.config import Config
from src.core.engine import Engine
from src.core.logger import setup
from src.data.market_data import MarketData
from src.execution.paper import PaperBroker
from src.risk.manager import RiskManager
from src.strategies import Ensemble, REGISTRY


class Root(BoxLayout):
    def __init__(self, **kw):
        super().__init__(orientation="vertical", padding=12, spacing=8, **kw)
        setup("INFO")
        self.cfg = Config.load(str(Path(__file__).resolve().parents[2] / "config.yaml"))
        self.market = MarketData(self.cfg)
        self.broker = PaperBroker(10_000)
        self.ensemble = Ensemble.from_config(self.cfg, REGISTRY)
        self.risk = RiskManager(self.cfg.risk)
        self.engine = Engine(self.cfg, self.market, self.broker, self.ensemble, self.risk)
        self.running = False

        self.status = Label(text="idle", size_hint_y=None, height=40, color=(0.6, 0.7, 0.9, 1))
        self.equity = Label(text="Equity: –", size_hint_y=None, height=40)
        self.positions = Label(text="", size_hint_y=None, halign="left", valign="top")
        self.positions.bind(size=lambda _, s: setattr(self.positions, "text_size", (s[0], None)))
        self.signals = Label(text="", size_hint_y=None, halign="left", valign="top")
        self.signals.bind(size=lambda _, s: setattr(self.signals, "text_size", (s[0], None)))

        buttons = BoxLayout(size_hint_y=None, height=64, spacing=6)
        start_btn = Button(text="Start"); start_btn.bind(on_press=lambda _: self.start())
        stop_btn = Button(text="Stop");   stop_btn.bind(on_press=lambda _: self.stop())
        scan_btn = Button(text="Scan");   scan_btn.bind(on_press=lambda _: self.scan())
        buttons.add_widget(start_btn); buttons.add_widget(stop_btn); buttons.add_widget(scan_btn)

        self.add_widget(self.status)
        self.add_widget(self.equity)
        self.add_widget(buttons)
        scroll = ScrollView()
        inner = BoxLayout(orientation="vertical", size_hint_y=None, spacing=8, padding=[0, 8])
        inner.bind(minimum_height=inner.setter("height"))
        inner.add_widget(Label(text="Positionen", size_hint_y=None, height=28))
        inner.add_widget(self.positions)
        inner.add_widget(Label(text="Signale", size_hint_y=None, height=28))
        inner.add_widget(self.signals)
        scroll.add_widget(inner)
        self.add_widget(scroll)
        Clock.schedule_interval(lambda _dt: self.refresh(), 5)

    def start(self):
        if self.running: return
        self.running = True
        threading.Thread(target=self._loop, daemon=True).start()
        self.status.text = "running"

    def stop(self):
        self.running = False
        self.status.text = "stopped"

    def _loop(self):
        while self.running:
            try:
                self.engine.tick()
            except Exception as e:
                Clock.schedule_once(lambda _dt, msg=str(e): setattr(self.status, "text", f"error: {msg[:50]}"))
            time.sleep(self.cfg.engine.loop_interval_seconds)

    def scan(self):
        def _do():
            self.market.refresh_all(self.cfg.universe.symbols, self.cfg.universe.timeframes,
                                    self.cfg.engine.warmup_candles)
            lines = []
            for s in self.cfg.universe.symbols:
                sym, side, score, sigs = self.engine._scan_symbol(s)
                strategies_hit = ", ".join(x.strategy for x in sigs) or "-"
                lines.append(f"{sym:10s} {side.value:5s} score={score:.2f}  [{strategies_hit}]")
            Clock.schedule_once(lambda _dt: setattr(self.signals, "text", "\n".join(lines)))
        threading.Thread(target=_do, daemon=True).start()

    def refresh(self):
        marks = {s: float(self.market.get(s, self.cfg.universe.primary_timeframe)["close"].iloc[-1])
                 for s in self.cfg.universe.symbols
                 if self.market.get(s, self.cfg.universe.primary_timeframe) is not None
                 and len(self.market.get(s, self.cfg.universe.primary_timeframe))}
        eq = self.broker.equity(marks)
        self.equity.text = f"Equity: {eq:.2f} USDT   Cash: {self.broker.cash():.2f}"
        pos = self.broker.positions()
        if not pos:
            self.positions.text = "keine offenen Positionen"
        else:
            self.positions.text = "\n".join(
                f"{p.symbol}  {p.side.value.upper()}  qty={p.qty:.6f}  entry={p.entry_price:.4f}  SL={p.stop:.4f}"
                for p in pos.values()
            )


class TradingBotApp(App):
    title = "Trading Bot"

    def build(self):
        return Root()


if __name__ == "__main__":
    TradingBotApp().run()
