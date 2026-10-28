# AeroTrack

Live-Flugtracker auf Basis offener ADS-B-Daten. Eigene Oberfläche, eigener Renderer, keine kopierten Assets.

## Starten

```bash
cd aerotrack
npm install
npm start          # Live-Daten von adsb.lol  → http://localhost:8080
npm run demo       # Simulierte Daten, funktioniert offline
npm test           # Unit-Tests
```

Node.js ≥ 18. Port per `PORT=…`, alternative readsb-kompatible API per `ADSB_API=…`.

## Funktionen

| Bereich | Umfang |
|---|---|
| Karte | Canvas-Renderer für tausende Luftfahrzeuge, flüssige Bewegung zwischen den Abfragen (Dead Reckoning), eigene Silhouetten je Klasse |
| Klassen | Linienflug, Großraum, **Business-Jet**, Kleinflugzeug, Hubschrauber, **Militär**, Segelflug, Bodenfahrzeug |
| Details | Höhe (baro/GNSS), Steigrate, Geschwindigkeit, Kurs, Squawk, Registrierungsland, Datenquelle (ADS-B/MLAT/TIS-B), Flags PIA/LADD |
| Route | Start → Ziel mit Fortschrittsbalken, Restdistanz und geschätzter Restflugzeit |
| Profil | Höhen- und Geschwindigkeitsdiagramm aus der aufgezeichneten Spur |
| Spuren | Ausgewählter Flug farbcodiert nach Höhe, optional Spuren für alle |
| Suche | Lokal (sofort) und weltweit über Rufzeichen, Kennzeichen, ICAO-Hex, Typ |
| Filter | Kategorie, Höhenband, Mindestgeschwindigkeit, Textfilter, Bodenverkehr, nur Notfälle |
| Alarme | Watchlist (weltweit, alle 20 s), Überwachungszone mit Radius und Klassenfilter, Notfall-Squawks 7500/7600/7700; In-App + Systembenachrichtigung |
| Ebenen | Dunkel/Hell/Satellit/OSM, Tag/Nacht-Grenze, Niederschlagsradar, Entfernungsringe, Militär weltweit |
| Analyse | Sichtbare/geladene Anzahl, Kategorien, häufigste Typen, höchste und schnellste Flüge |
| Sonstiges | Teilbare Links (`#zoom/lat/lon/hex`), Folgen-Modus, Tastenkürzel, mobil nutzbar, Einstellungen bleiben gespeichert |

## Grenzen (ehrlich)

- **Abdeckung**: adsb.lol ist ein Community-Netz. Über Europa und Nordamerika gut, über Ozeanen und Teilen Afrikas/Asiens lückenhaft. Kein Satelliten-ADS-B.
- **Radius**: Pro Abfrage maximal 250 NM um die Kartenmitte. Weiter herausgezoomt zeigt die App einen Hinweis.
- **Historie**: Spuren werden erst ab dem Öffnen der App aufgezeichnet. Kein Archiv vergangener Flüge.
- **Routen**: Kommen aus einer Community-Datenbank (nach Rufzeichen) und können falsch sein; unsichere Routen sind markiert.
- **Militär**: Sichtbar ist nur, was mit eingeschaltetem Transponder fliegt (Transport, Tanker, Aufklärung). Kampfeinsätze, Drohnen und Raketen erscheinen nicht.
- **Privatjets**: Werden angezeigt, auch solche auf der LADD-Sperrliste. Jets mit **PIA** (wechselnde anonyme ICAO-Adresse) lassen sich nicht über Zeit einem Eigentümer zuordnen.
- **Benachrichtigungen**: Nur solange der Tab geöffnet ist (kein Push-Server).

## Datenquellen und Lizenzen

- Flugdaten: [adsb.lol](https://adsb.lol), Open Database License (ODbL) – Namensnennung in der App vorhanden.
- Fotos: [Planespotters.net](https://www.planespotters.net) Public API – Fotograf und Link werden angezeigt.
- Kartenkacheln: OpenStreetMap, CARTO, Esri.
- Niederschlagsradar: [RainViewer](https://www.rainviewer.com).

Vor einer öffentlichen oder kommerziellen Nutzung die Nutzungsbedingungen dieser Dienste prüfen.

## Aufbau

```
server.js           HTTP-Server, statische Dateien, API-Proxy
lib/adsb.js         Upstream-Client mit Cache und Normalisierung
lib/sim.js          Verkehrssimulation für den Demo-Modus
public/js/main.js   Verdrahtung von Karte, Polling und UI
public/js/layer.js  Canvas-Renderer
public/js/store.js  Zustand, Positionsvorhersage, Spuren
public/js/panel.js  Detailpanel
public/js/alerts.js Watchlist, Zone, Notfälle
public/js/filters.js, classify.js, country.js, geo.js, prefs.js, api.js
```
