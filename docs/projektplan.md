# Masar — Navi für Saudi-Arabien (Projektplan)

> Arbeitstitel **Masar** (مسار = „Spur / Route"). Name ist noch offen.

## Das Problem, das wir lösen
Google Maps und Radarbot zeigen in Saudi-Arabien **nicht zuverlässig die Fahrspuren**.
Auf mehrspurigen Stadtautobahnen (Riad, Jeddah, Dammam) weiß man dadurch oft nicht,
**auf welcher Spur** man fahren muss und **wann genau** man abfahren soll.
Genau das ist die Kernfunktion dieser App: **präziser Fahrspur-Assistent mit Countdown bis zur Abfahrt.**

## Entscheidungen (Stand: bisherige Abstimmung)
| Thema | Entscheidung |
|---|---|
| Plattform | Handy-App für **iOS + Android** |
| Technik | **Flutter** (eine Codebasis) |
| Karten-/Routing-Daten | **HERE** (Spur-Führung, Junction View, MENA-Abdeckung) |
| Offline-Karten | **Pflicht** (HERE Offline-Kartenpakete) |
| Blitzer-Daten | **Kombination**: eigene DB + Community-Meldungen, Import öffentlicher Daten, HERE Safety Cameras |
| Sprache | **Arabisch + Englisch** (RTL), gesprochene Ansagen |
| HERE-Zugang | Start mit **kostenlosem Kontingent** |
| Vorgehen | **Plan + Prototyp parallel** |

## Kernfunktionen
1. **Fahrspur-Assistent** — welche Spur, hervorgehoben, mit Entfernung/Countdown bis zum Abbiegen; realistische Kreuzungsbilder (Junction View).
2. **Blitzer-/Radar-Warnung** — feste & mobile Saher-Blitzer, Tempolimit-Anzeige, akustische Warnung.
3. **Live-Verkehr & Staus** — Verkehrslage, Stauumfahrung, realistische Ankunftszeit.
4. **Sprachnavigation** — Ansagen auf Arabisch/Englisch, RTL-Oberfläche.
5. **Offline-Modus** — vollständige Navigation ohne Netz.

## Technischer Aufbau (grob)
```
Flutter App (iOS/Android)
├─ HERE SDK for Flutter
│   ├─ Karten-Rendering + Offline-Kartenpakete
│   ├─ Routing (mit lane guidance / junction views)
│   ├─ Turn-by-turn Navigation + Sprachausgabe
│   └─ Live-Verkehr
├─ Fahrspur-Modul (eigene UI über HERE-Spurdaten)  ← unser Alleinstellungsmerkmal
├─ Blitzer-Modul
│   ├─ HERE Safety Cameras (falls SA verfügbar)
│   ├─ Import: OpenStreetMap „enforcement"-Daten
│   └─ Community-Meldungen  →  eigenes Backend
├─ Backend (später): Blitzer-DB, Nutzer-Meldungen, Sync
│   └─ z. B. Supabase / Firebase (Auth, Datenbank, Push)
└─ Lokal: Einstellungen, zuletzt gefahrene Ziele, Offline-Pakete
```

## Fahrplan (Meilensteine)
- **M0 — Vorschau (fertig):** interaktiver Fahrspur-Bildschirm als HTML-Prototyp (`prototyp/fahrspur-vorschau.html`). Zeigt Spur-Führung, Countdown, Blitzer-Chip, DE/EN/AR, Tag/Nacht.
- **M1 — Flutter-Grundgerüst:** Projekt aufsetzen, HERE-SDK einbinden, Karte + Standort anzeigen.
- **M2 — Navigation:** Route berechnen, Turn-by-turn, Sprachansagen (EN/AR).
- **M3 — Fahrspur-Assistent:** Spurdaten aus HERE in die eigene UI übersetzen (Kernfunktion).
- **M4 — Offline:** Kartenpakete für Regionen (Riad, Jeddah, Dammam …) herunterladen/verwalten.
- **M5 — Blitzer:** Datenquellen zusammenführen, Warn-Logik, Community-Meldung.
- **M6 — Live-Verkehr & ETA-Feinschliff.**
- **M7 — Feinschliff, Tests, Store-Veröffentlichung.**

## Getroffene Entscheidungen (vom Nutzer delegiert)
- **Name:** Arbeitstitel bleibt **Masar** (später leicht änderbar).
- **Testgerät:** **Android** (Flutter baut iOS trotzdem mit; wir testen zuerst auf Android).
- **Monetarisierung:** Start **kostenlos** auf HERE-Gratis-Kontingent. Später optional „Masar Pro" (Offline-Pakete/werbefrei), falls die API-Kosten steigen.
- **Sprach-Ansagen:** Start mit systemeigener TTS (Android `flutter_tts`, EN/AR). HERE-eigene Ansagen später, wenn wir das SDK anbinden.
- **Backend (Community-Blitzer):** **Supabase** (einfacher Start, Postgres + Auth + Realtime).
- **Zusatzfunktionen:** Kern zuerst. Danach in dieser Reihenfolge: Tankstellen, **Android Auto** (passt zu Android), Gebetszeiten-Hinweis, Parkplätze. CarPlay erst mit iOS-Fokus.

## Offene Punkte (später)
- Logo/Branding-Feinschliff
- Endgültiger Name
- Preis-/Abo-Modell konkretisieren
