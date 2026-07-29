from __future__ import annotations

import hmac
import json
import os
from typing import Callable

from flask import Flask, jsonify, request

from ..core.logger import get
from ..strategies.base import Side

log = get(__name__)


def _verify(secret: str, header_sig: str, body: bytes) -> bool:
    if not secret:
        return True
    if not header_sig:
        return False
    calc = hmac.new(secret.encode(), body, "sha256").hexdigest()
    return hmac.compare_digest(calc, header_sig)


def create_app(handler: Callable[[dict], None]) -> Flask:
    """
    handler receives a dict like:
      {"symbol": "BTC/USDT", "side": "long", "price": 65000, "strategy": "tv_alert"}
    from TradingView alert JSON payloads.
    """
    app = Flask(__name__)
    secret = os.environ.get("WEBHOOK_SECRET", "")

    @app.get("/health")
    def health():
        return jsonify(status="ok")

    @app.post("/tv")
    def tradingview():
        body = request.get_data()
        if not _verify(secret, request.headers.get("X-Signature", ""), body):
            return jsonify(error="bad signature"), 401
        try:
            data = json.loads(body.decode() or "{}")
        except json.JSONDecodeError:
            return jsonify(error="bad json"), 400
        side_str = str(data.get("side", "")).lower()
        try:
            data["side"] = Side(side_str) if side_str in {"long", "short", "flat"} else Side.FLAT
        except ValueError:
            data["side"] = Side.FLAT
        log.info(f"webhook received: {data}")
        try:
            handler(data)
        except Exception as e:
            log.exception(f"webhook handler failed: {e}")
            return jsonify(error="handler error"), 500
        return jsonify(status="accepted")

    return app


def run_server(app: Flask, host: str = "0.0.0.0", port: int = 8080) -> None:
    app.run(host=host, port=port, debug=False, use_reloader=False)
