from __future__ import annotations

import logging
import sys
from pathlib import Path

from rich.logging import RichHandler


def setup(level: str = "INFO", file: str | None = None) -> logging.Logger:
    root = logging.getLogger()
    if root.handlers:
        return root
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    root.addHandler(RichHandler(rich_tracebacks=True, show_path=False))
    if file:
        Path(file).parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(file)
        fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        root.addHandler(fh)
    logging.getLogger("ccxt").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    return root


def get(name: str) -> logging.Logger:
    return logging.getLogger(name)
