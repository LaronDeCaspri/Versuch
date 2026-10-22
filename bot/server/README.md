# 24/7-Papierhandel-Server

Der Browser-Bot läuft nur, solange der Tab offen ist. Dieser Server führt **dieselbe Engine** (`lib.js` + `pro.js`) rund um die Uhr aus, liefert die App aus und zeigt seinen Zustand in der App an.

**Ausschließlich Papierhandel.** Der Server kennt keine Börsenschlüssel, blockiert jeden schreibenden oder privaten Aufruf an Börsen und verweigert den Start, wenn Variablen wie `BINANCE_API_KEY` gesetzt sind.

## Starten

Voraussetzung: Node.js 22 oder neuer. Keine weiteren Abhängigkeiten.

```bash
cd bot/server
npm start                 # Binance-Live-Daten, Papierhandel
npm run mock              # synthetische Daten, ohne Internet
npm test                  # Engine-Tests
```

Danach im Browser `http://127.0.0.1:8787` öffnen. Auf der Übersicht erscheint die Karte **24/7-Server**.

### Auf einem kleinen VPS (z. B. 4 €/Monat)

```bash
docker build -f server/Dockerfile -t trading-bot-paper .      # im Ordner bot/
docker run -d --name tbot --restart unless-stopped -p 127.0.0.1:8787:8787 -v tbot-data:/data trading-bot-paper
```

Der Port ist absichtlich nur lokal gebunden. Für Zugriff vom Handy einen Tunnel wie Tailscale oder einen Reverse-Proxy mit Login davorschalten. Die API ist rein lesend, zeigt aber dein Papier-Depot.

## Einstellungen (Umgebungsvariablen)

| Variable | Standard | Bedeutung |
|---|---|---|
| `TB_SYMBOLS` | `BTC/USDT,ETH/USDT,SOL/USDT,BNB/USDT,XRP/USDT,ADA/USDT,AVAX/USDT,LINK/USDT` | gehandelte Paare |
| `TB_STRICT` | `0` | `1` = nur Symbole mit validierter Edge handeln |
| `TB_RESEARCH_DAYS` | `180` | Historie für den täglichen Walk-Forward |
| `TB_STATE_DIR` | `server/state` | Depot, Journal, Ereignis-Log |
| `PORT` / `TB_HOST` | `8787` / `127.0.0.1` | Server-Adresse |
| `TB_MOCK` | `0` | `1` = synthetische Daten |

## Was der Server tut

- scannt alle 30 Sekunden die 15-Minuten-Kerzen und prüft Stops/Targets bei jedem Trade-Tick aus dem Binance-Stream
- trifft Entscheidungen ausschließlich mit der Signal-Logik, die im Walk-Forward getestet wurde
- rechnet jeden Fill mit 7,5 bps Gebühr und Slippage aus dem Live-Orderbuch
- handelt jeden Trade mit regulärer Größe: 0,5 % Risiko des Depots bis zum Stop
- stoppt neue Einstiege bei 3 % Tagesverlust, überfülltem Funding, weitem Spread oder starkem Gegenfluss
- schreibt jedes Ereignis nach `state/events.log`

## Endpunkte

- `GET /api/status` — Depot, Positionen, letzte Trades, Engine-Zustand, Markt, Walk-Forward-Ergebnis
- `GET /api/health` — Lebenszeichen für Monitoring
- alles andere: die App (nur `GET`/`HEAD`)
