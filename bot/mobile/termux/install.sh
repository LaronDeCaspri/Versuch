#!/data/data/com.termux/files/usr/bin/bash
# Trading-Bot-Installer für Termux (Android)
#
# 1. Termux von F-Droid installieren: https://f-droid.org/en/packages/com.termux/
# 2. Termux öffnen und ausführen:
#      bash <(curl -sL https://raw.githubusercontent.com/LaronDeCaspri/Versuch/claude/trading-bot-system-owbxye/bot/mobile/termux/install.sh)
#
# Nutzt VORKOMPILIERTE Termux-Pakete (numpy, pandas, matplotlib) statt Compile
# vom Source. Spart ca. 1 GB Speicher (kein rust/clang/llvm nötig).

set -e

echo "[0/6] APT-Cache reparieren ..."
mkdir -p "$PREFIX/var/cache/apt/archives/partial"
mkdir -p "$PREFIX/var/log/apt"
pkg autoclean -y || true
apt clean || true

echo "[1/6] Termux-Pakete aktualisieren ..."
pkg update -y

echo "[2/6] Python + vorkompilierte wissenschaftliche Pakete (kein Compile nötig) ..."
pkg install -y python git python-numpy python-pandas python-matplotlib python-pillow

echo "[3/6] Speicher-Berechtigung ..."
termux-setup-storage 2>/dev/null || true

echo "[4/6] Repo klonen ..."
cd "$HOME"
if [ ! -d Versuch ]; then
    git clone https://github.com/LaronDeCaspri/Versuch.git
fi
cd Versuch
git fetch origin
git checkout claude/trading-bot-system-owbxye
git pull origin claude/trading-bot-system-owbxye

echo "[5/6] Nur die Python-Deps installieren die noch fehlen (schlanke Liste) ..."
cd bot
pip install --no-cache-dir --upgrade pip
pip install --no-cache-dir ccxt pyyaml python-dotenv rich click flask tabulate aiohttp websockets

echo "[6/6] Demo-Server auf Port 8090 starten ..."
export PWA_HOST=127.0.0.1
export PWA_PORT=8090
echo ""
echo "Öffne im Chrome auf dem Handy:  http://127.0.0.1:8090"
echo ""
python scripts/run_demo.py
