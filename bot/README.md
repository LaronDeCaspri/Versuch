# Trading Bot

Voll funktionstüchtiger, modularer Krypto-Trading-Bot in Python. Betrieb entweder
gegen ein exchange-eigenes Demokonto (Binance Testnet, Bybit Testnet, OKX Demo)
oder mit dem eingebauten lokalen Paper-Broker – ohne API-Keys.

## Was drin ist

- `src/data/` — Marktdaten via `ccxt` (OHLCV der grossen Börsen, gleiche Datenquelle die TradingView anzeigt)
- `src/indicators/` — nativ implementiert: SMA/EMA/WMA, RSI, MACD, Bollinger, ATR, ADX, Stoch, StochRSI, OBV, VWAP, Donchian, Keltner, Ichimoku
- `src/strategies/` — EMA-Cross, MACD-Trend, RSI-Mean-Reversion, Bollinger-Squeeze, Donchian-Breakout, VWAP-Reversion, **MMCrypto-Style Multi-TF** und **Ensemble-Voting**
- `src/risk/` — 1R-Sizing, ATR-Stops, TP-Ladder, Daily-Loss & Max-Drawdown Kill-Switch
- `src/execution/` — Paper-Broker + ccxt-Broker (Live/Testnet)
- `src/backtest/` — Backtester über echte historische Candles
- `src/webhook/` — Flask-Empfänger für TradingView-Pine-Alerts mit HMAC-Signatur
- `src/knowledge/` — komprimiertes Rulebook aus öffentlicher Trading-Literatur

## Installation

```
cd bot
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # (optional) API-Keys ergänzen
```

## Kommandos

```
python run.py rulebook                       # Trading-Regeln anzeigen
python run.py scan                           # einmaliger Scan aller Symbole
python run.py run                            # Live-Loop, lokaler Paper-Broker
python run.py run --live                     # Live-Loop, Exchange-Sandbox (nutzt config.exchange.testnet)
python run.py backtest --symbol BTC/USDT --days 90
python run.py webhook                        # TradingView Webhook-Empfänger
python scripts/backtest_all.py 60            # Backtest aller Symbole der Universe
python scripts/list_symbols.py USDT          # verfügbare Paare an der Börse
```

## Konfiguration

`config.yaml` steuert Exchange, Universe (Symbole + Timeframes), Risiko und
Aktivierung/Gewichtung jeder Strategie. `min_score` und `agreement_required` im
`ensemble`-Block bestimmen, wie viele Strategien übereinstimmen müssen, bevor
eine Order ausgelöst wird.

## Demokonto einrichten

1. **Binance Testnet**: https://testnet.binance.vision/ – API-Keys anlegen, in `.env` eintragen (`BINANCE_API_KEY`, `BINANCE_API_SECRET`), `USE_TESTNET=true`.
2. **Bybit Testnet**: https://testnet.bybit.com/ – analog, `EXCHANGE=bybit`.
3. **OKX Demo Trading**: `EXCHANGE=okx`, Passphrase in `OKX_PASSPHRASE`.

Ohne Keys läuft alles gegen den lokalen `PaperBroker` (Startsaldo per `PAPER_START_BALANCE`).

## TradingView-Integration

Neben der direkten Datenanbindung via `ccxt` liest die Webhook-Route Pine-Alerts:

```json
{"symbol": "BTC/USDT", "side": "long", "price": 65000, "strategy": "my_pine"}
```

Alert-URL: `https://<host>:8080/tv`, optional `X-Signature` als HMAC-SHA256 mit
`WEBHOOK_SECRET`.

## Tests

```
pip install pytest
pytest -q
```

## Mobile / Android

Drei Wege, das Ding aufs Handy zu bringen:

### 1. PWA (schnellster Weg – kein Play-Store nötig)

```
python -m mobile.pwa.server        # Port 8090
```

Am Handy in Chrome `http://<IP>:8090` öffnen → Menü → **App installieren**.
Dashboard mit Start/Stop/Scan-Buttons, Live-Equity, offenen Positionen, letzten
Signalen, Rulebook. Läuft offline-fähig via Service Worker.

### 2. Native APK via Kivy + Buildozer

```
cd bot/mobile/kivy
pip install buildozer cython
buildozer -v android debug
```
Die fertige APK landet unter `bin/tradingbot-*-debug.apk`. Auf dem Handy
installieren (Unbekannte-Quellen erlauben).

### 3. Direkt in Termux auf dem Handy

Termux von F-Droid installieren, dann:

```
bash <(curl -sL https://raw.githubusercontent.com/LaronDeCaspri/Versuch/claude/trading-bot-system-owbxye/bot/mobile/termux/install.sh)
```

Bot läuft nativ auf dem Handy, PWA-UI unter `http://127.0.0.1:8090`.

## Trader-Wissen

- `python run.py strategies` – alle 18 Strategien listen
- `python run.py principles` – Prinzipien aus Trading-Literatur + Top-10-Trader
- `python run.py reading-list` – 19 empfohlene Bücher

## Sicherheits-Hinweise

- Standardmässig läuft alles im Sandbox-/Paper-Modus.
- Bevor du `run --live` gegen ein Live-Konto (nicht Testnet) startest: `testnet: false` in `config.yaml`, ausreichend backtesten, Position-Sizing prüfen.
- Der Kill-Switch stoppt neue Einstiege, verwaltet aber offene Positionen weiter.
