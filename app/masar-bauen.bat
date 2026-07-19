@echo off
chcp 1252 >nul
title Masar bauen
cd /d "%~dp0"

echo ============================================
echo   MASAR - App bauen (einfach warten)
echo ============================================
echo.

echo [1/4] Alten Bau-Ordner aufraeumen (macht Platz)...
if exist build rmdir /s /q build

echo [2/4] Neueste Version von Masar holen...
git pull

echo [3/4] App bauen - das dauert ein paar Minuten, bitte warten...
call flutter build apk --release
if errorlevel 1 (
  echo.
  echo !!! Beim Bauen ist ein Fehler passiert.
  echo Bitte den obigen Text kopieren und Claude schicken.
  echo.
  pause
  exit /b 1
)

echo [4/4] Ordner mit der fertigen App oeffnen...
start "" explorer "%~dp0build\app\outputs\apk\release"

echo.
echo ============================================
echo   FERTIG!  Die Datei  app-release.apk
echo   liegt im gerade geoeffneten Ordner.
echo.
echo   Naechster Schritt:
echo   1) app-release.apk bei drive.google.com hochladen
echo   2) am Handy in Google Drive herunterladen
echo   3) antippen und installieren (drueber-installieren)
echo ============================================
echo.
pause
