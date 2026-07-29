[app]
title = Trading Bot
package.name = tradingbot
package.domain = de.versuch
source.dir = .
source.include_exts = py,png,jpg,kv,atlas,yaml,txt,json
version = 0.1.0

requirements = python3,kivy==2.3.0,pyyaml,python-dotenv,ccxt,pandas,numpy,requests,aiohttp,flask,rich,click,tabulate

orientation = portrait
fullscreen = 0
android.permissions = INTERNET,ACCESS_NETWORK_STATE,WAKE_LOCK,FOREGROUND_SERVICE
android.api = 33
android.minapi = 24
android.ndk_api = 24
android.archs = arm64-v8a,armeabi-v7a
android.allow_backup = True

# Ship the bot package alongside the Kivy app.
source.include_patterns = ../../src/**/*.py,../../config.yaml,../../.env.example

[buildozer]
log_level = 2
warn_on_root = 1
