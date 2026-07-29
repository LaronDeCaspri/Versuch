"""Run the PWA with seeded demo data ($10k play money)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mobile.pwa.server import BotService, create_app
from src.core.config import Config
from scripts.demo_seed import seed


def main() -> None:
    cfg = Config.load("config.yaml")
    svc = BotService(cfg)
    seed(svc)
    app = create_app(svc)
    host = os.environ.get("PWA_HOST", "0.0.0.0")
    port = int(os.environ.get("PWA_PORT", "8090"))
    print(f"open http://{host}:{port} on your phone", flush=True)
    app.run(host=host, port=port, debug=False, use_reloader=False, threaded=True)


if __name__ == "__main__":
    main()
