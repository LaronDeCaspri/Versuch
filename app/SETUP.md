# Masar – App starten (Android)

Dieses Verzeichnis enthält den **Fahrspur-Assistenten als lauffähige Flutter-App**
mit Demo-Daten. Kein HERE nötig, um es zu sehen – es läuft sofort auf deinem Android-Handy.

## 1. Flutter installieren (einmalig)
- Flutter SDK: https://docs.flutter.dev/get-started/install
- Prüfen mit:
  ```bash
  flutter --version
  flutter doctor
  ```
  `flutter doctor` zeigt, ob Android-Toolchain & Gerät bereit sind. Alle grünen Haken bei „Android" reichen.

## 2. Plattform-Ordner erzeugen
Der Quellcode (`lib/`, `pubspec.yaml`) ist da, aber die Android-Projektdateien fehlen bewusst
(werden nicht eingecheckt). Einmalig erzeugen – **überschreibt `lib/` nicht**:
```bash
cd app
flutter create --org com.masar --project-name masar .
```

## 3. Auf dem Handy starten
- Android-Handy per USB anstecken, **USB-Debugging** in den Entwickleroptionen aktivieren.
- Dann:
  ```bash
  flutter devices        # dein Handy sollte auftauchen
  flutter run
  ```
- Tippe im App-Bildschirm auf **„Fahrt simulieren"**. Du siehst die Spur-Führung,
  den Countdown, die Blitzer-Warnung und kannst DE/EN/AR sowie Tag/Nacht umschalten.

## Was hier schon drin ist
| Datei | Inhalt |
|---|---|
| `lib/main.dart` | App-Start, Hochformat, dunkles Theme |
| `lib/lane_guidance_screen.dart` | Der Fahrspur-Bildschirm (Kernfunktion) + Fahr-Simulation |
| `lib/painters.dart` | Perspektivische Straße + Spur-Pfeile (CustomPainter) |
| `lib/route_data.dart` | Datenmodell + Demo-Route + Übersetzungen |

## Nächster Schritt: echte HERE-Daten (M2/M3)
Heute läuft alles mit `demoRoute`. So binden wir HERE an:
1. Kostenloses Projekt anlegen: https://platform.here.com → **App-ID + Access Key**.
2. In `pubspec.yaml` das `here_sdk` aktivieren (Zeilen sind schon als Kommentar drin) und das
   SDK-Paket laut HERE-Anleitung einbinden.
3. Zugangsdaten in eine **nicht eingecheckte** Datei legen (`lib/here_credentials.dart`,
   steht schon in `.gitignore`).
4. Die HERE-Navigations-Events liefern Entfernung, Spuren und Junction Views –
   die füttern denselben Zustand, den heute `demoRoute` liefert. Die UI bleibt gleich.

> Wichtig: HERE-Keys **niemals** ins Repo committen.
