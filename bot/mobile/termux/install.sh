#!/data/data/com.termux/files/usr/bin/bash
# Install and run the trading bot directly on your Android phone via Termux.
# 1. Install Termux from F-Droid: https://f-droid.org/en/packages/com.termux/
# 2. Open Termux, then run:
#      curl -O https://raw.githubusercontent.com/<owner>/<repo>/<branch>/bot/mobile/termux/install.sh
#      bash install.sh
set -euo pipefail

echo "[1/4] updating packages ..."
pkg update -y && pkg upgrade -y
pkg install -y python git rust clang libjpeg-turbo libcrypt openssl libffi make

echo "[2/4] cloning repo ..."
cd "$HOME"
if [ ! -d Versuch ]; then
    git clone https://github.com/LaronDeCaspri/Versuch.git
fi
cd Versuch
git fetch origin
git checkout claude/trading-bot-system-owbxye
git pull origin claude/trading-bot-system-owbxye

echo "[3/4] python deps ..."
cd bot
pip install --upgrade pip wheel
pip install -r requirements.txt

echo "[4/4] start PWA on port 8090 ..."
export PWA_HOST=127.0.0.1
python -m mobile.pwa.server
