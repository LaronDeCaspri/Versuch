# Sicherheitscheck (Android)

Kleine App, die die wichtigsten Sicherheits- und Datenschutz-Einstellungen deines Handys prüft
und dich mit einem Tipp direkt zur passenden Einstellung bringt.

- **Ändert nichts selbst** – sie zeigt nur an.
- **Kein Internetzugriff** – die App hat keine Internet-Berechtigung und kann nichts senden.
- Ab Android 9.

## Was geprüft wird

| Prüfung | automatisch? |
|---|---|
| Alter des Sicherheitspatches | ja |
| Displaysperre aktiv | ja |
| Geräteadministratoren (typisch für Spionage-Apps) | ja |
| Bedienungshilfen (können Bildschirm mitlesen) | ja |
| Zugriff auf Benachrichtigungen | ja (sonst Hinweis) |
| USB-/WLAN-Debugging | ja |
| Privates DNS / Werbeblocker | ja |
| Apps mit Zugriff auf Mikrofon, Kamera, Standort, SMS, Kontakte | ja |
| „Unbekannte Apps installieren“ | Liste, Erlaubnis selbst prüfen |
| Werbe-ID, Google-Konto, Play Protect | selbst prüfen (Link) |

Ampel: **Handeln** (rot) · **Prüfen** (orange) · **Selbst prüfen** (grau) · **Info** (blau) · **OK** (grün).
Nach jeder Rückkehr aus den Einstellungen prüft die App automatisch neu.

## Installieren

1. Auf dem Handy unter *Releases* dieses Repos die neueste `Sicherheitscheck.apk` herunterladen.
2. Datei öffnen. Android fragt, ob der Browser/Dateimanager Apps installieren darf → einmal erlauben.
3. Nach der Installation diese Erlaubnis **sofort wieder entziehen** (die App erinnert dich daran).
4. Play Protect warnt evtl., weil die App nicht aus dem Play Store kommt – „Trotzdem installieren“.

Jede Version ist mit einem anderen Schlüssel signiert: für ein Update die alte Version vorher deinstallieren.

## Bauen

Die APK baut GitHub Actions automatisch (`.github/workflows/sicherheitscheck.yml`).
Lokal mit Android-SDK: `./gradlew assembleRelease`.
