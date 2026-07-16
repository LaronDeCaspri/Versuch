# Masar aufs Android-Handy bringen (mit Computer)

Diese Anleitung bringt die App vom Computer auf dein Android-Handy. Für Einsteiger geschrieben.
Es gibt **vier Schritte**: Werkzeuge installieren → Projekt holen → vorbereiten → aufs Handy.

---

## Schritt 1: Werkzeuge installieren (einmalig, dauert am längsten)

Du brauchst **Flutter** und **Android Studio** (liefert das Android-SDK mit).

- Offizielle Anleitung: https://docs.flutter.dev/get-started/install
- Video, das genau das zeigt: https://www.youtube.com/watch?v=EmDhceZE3Vs

**Windows**
1. Flutter SDK herunterladen und z. B. nach `C:\flutter` entpacken.
2. `C:\flutter\bin` zur „PATH"-Umgebungsvariable hinzufügen.
3. Android Studio installieren → beim ersten Start das **Android SDK** mitinstallieren lassen.

**Mac**
1. Flutter installieren (am einfachsten mit Homebrew: `brew install --cask flutter`) oder SDK entpacken.
2. Android Studio installieren → **Android SDK** mitinstallieren lassen.

**Prüfen** (Terminal / Eingabeaufforderung):
```bash
flutter doctor
```
Wichtig sind grüne Haken bei **Flutter** und **Android toolchain**. Was `flutter doctor`
noch anmeckert (z. B. Lizenzen), löst du mit:
```bash
flutter doctor --android-licenses
```
(mehrfach „y" bestätigen).

---

## Schritt 2: Das Masar-Projekt holen

```bash
git clone -b claude/saudi-arabia-navigation-l6zvfi https://github.com/LaronDeCaspri/Versuch.git
cd Versuch/app
```

---

## Schritt 3: App vorbereiten

Der Android-Ordner ist bereits dabei (mit den nötigen **Standort-Berechtigungen**),
du musst also nichts erzeugen. Nur die Pakete holen:
```bash
flutter pub get
```

---

## Schritt 4: Aufs Handy bringen

1. Am Handy **Entwickleroptionen** freischalten:
   Einstellungen → *Über das Telefon* → 7× auf *Build-Nummer* tippen.
2. In den **Entwickleroptionen** → **USB-Debugging** einschalten.
3. Handy per **USB-Kabel** an den Computer, am Handy „**Zulassen**" antippen.
4. Prüfen, ob es erkannt wird:
   ```bash
   flutter devices
   ```
   Dein Handy sollte in der Liste stehen.
5. Starten:
   ```bash
   flutter run
   ```
   Beim ersten Mal dauert es ein paar Minuten. Danach öffnet sich **Masar** auf dem Handy.

### So benutzt du die App
1. Beim ersten Start fragt das Handy nach der **Standort-Berechtigung** → **Zulassen**
   (am besten „Beim Verwenden der App"). Ohne sie kann das Navi dich nicht orten.
2. Die Karte zentriert auf deinen **echten Standort** (blauer Pfeil zeigt die Blickrichtung).
3. Oben ins Suchfeld ein **Ziel** eingeben → aus den Vorschlägen tippen. Die Route
   wird als grüne Linie gezeichnet, unten stehen Distanz und Fahrzeit.
4. Auf den grünen **Start-Knopf** (unten rechts) tippen → die **Sprachansagen** beginnen
   („In 300 Metern rechts abbiegen …"), die Karte folgt dir automatisch.
5. Rechts: **+/–** zum Zoomen, das **Fadenkreuz** zentriert wieder auf dich.

> Hinweis: GPS, Karte und Ansagen funktionieren nur auf dem **echten Handy** (nicht im
> Browser/Emulator ohne Standort). Zum Testen ohne Fahrt kannst du in den
> Entwickleroptionen einen „simulierten Standort" setzen.

### Lieber eine feste App-Datei (APK) statt Kabel?
```bash
flutter build apk --release
```
Die fertige Datei liegt dann unter:
`build/app/outputs/flutter-apk/app-release.apk`
Diese `.apk` aufs Handy kopieren und installieren (dafür „Installieren aus unbekannten Quellen"
für den Datei-Manager erlauben).

---

## Wenn etwas klemmt
Kopiere die **komplette Fehlermeldung** aus dem Terminal in den Chat – ich sage dir genau,
was zu tun ist. Häufige Stolpersteine:
- `flutter: command not found` → PATH (Schritt 1) stimmt noch nicht.
- Android-Lizenzen → `flutter doctor --android-licenses`.
- Handy taucht nicht bei `flutter devices` auf → anderes USB-Kabel/Port, USB-Debugging prüfen,
  am Handy „Zulassen" bestätigen.
