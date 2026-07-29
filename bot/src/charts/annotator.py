from __future__ import annotations

import io
from typing import Iterable

import matplotlib
matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from .. import indicators as ta


plt.rcParams.update({
    "figure.facecolor": "#0d1117", "axes.facecolor": "#0d1117",
    "axes.edgecolor": "#30363d", "axes.labelcolor": "#f0f6fc",
    "xtick.color": "#8b949e", "ytick.color": "#8b949e",
    "grid.color": "#21262d", "text.color": "#f0f6fc",
    "font.family": "DejaVu Sans", "font.size": 9,
})


def render_annotated_chart(df: pd.DataFrame, *, symbol: str, timeframe: str,
                           entry: float | None = None, stop: float | None = None,
                           take_profits: Iterable[float] = (),
                           patterns: Iterable[dict] = (),
                           side: str = "long", width: int = 900, height: int = 520) -> bytes:
    """
    Draw a professional-looking candlestick chart with:
      - candlesticks
      - EMA 20 / 50 / 200
      - Bollinger Bands (20, 2)
      - Volume subplot
      - Entry line (green for long, red for short)
      - Stop-Loss line (red dashed)
      - Take-Profit lines (green dashed)
      - Pattern labels on the right edge
    Returns PNG bytes.
    """
    df = df.iloc[-160:].copy()
    fig, (ax, axv) = plt.subplots(
        2, 1, figsize=(width / 100, height / 100),
        gridspec_kw={"height_ratios": [4, 1]}, sharex=True,
    )
    ax.set_title(f"{symbol}  ·  {timeframe}", loc="left", fontweight="bold")

    x = mdates.date2num(df.index.to_pydatetime())
    width_d = (x[1] - x[0]) * 0.7 if len(x) > 1 else 0.01
    up = df["close"] >= df["open"]
    down = ~up
    ax.vlines(x, df["low"], df["high"], color="#c9d1d9", linewidth=0.8)
    ax.bar(x[up], (df["close"] - df["open"])[up], bottom=df["open"][up],
           width=width_d, color="#3fb950", edgecolor="#3fb950", linewidth=0.5)
    ax.bar(x[down], (df["open"] - df["close"])[down], bottom=df["close"][down],
           width=width_d, color="#f85149", edgecolor="#f85149", linewidth=0.5)

    e20 = ta.ema(df["close"], 20)
    e50 = ta.ema(df["close"], 50)
    e200 = ta.ema(df["close"], 200)
    ax.plot(x, e20, color="#58a6ff", linewidth=1.0, label="EMA 20")
    ax.plot(x, e50, color="#d29922", linewidth=1.0, label="EMA 50")
    ax.plot(x, e200, color="#8957e5", linewidth=1.2, label="EMA 200")

    bb = ta.bollinger(df["close"], 20, 2.0)
    ax.plot(x, bb["upper"], color="#30363d", linewidth=0.7)
    ax.plot(x, bb["lower"], color="#30363d", linewidth=0.7)
    ax.fill_between(x, bb["lower"], bb["upper"], color="#30363d", alpha=0.10)

    if entry is not None:
        color = "#3fb950" if side == "long" else "#f85149"
        ax.axhline(entry, color=color, linewidth=1.4, label=f"Entry {entry:.4f}")
        ax.annotate(f" Entry {entry:.4f}", xy=(x[-1], entry), xytext=(x[-1], entry),
                    color=color, fontweight="bold", fontsize=9,
                    verticalalignment="center", horizontalalignment="left")
    if stop is not None:
        ax.axhline(stop, color="#f85149", linewidth=1.2, linestyle="--", label=f"Stop {stop:.4f}")
        ax.annotate(f" SL {stop:.4f}", xy=(x[-1], stop), color="#f85149",
                    verticalalignment="center", horizontalalignment="left", fontsize=8)
    for i, tp in enumerate(take_profits, 1):
        ax.axhline(tp, color="#3fb950", linewidth=0.9, linestyle=":", alpha=0.7)
        ax.annotate(f" TP{i} {tp:.4f}", xy=(x[-1], tp), color="#3fb950",
                    verticalalignment="center", horizontalalignment="left", fontsize=8)

    for i, pat in enumerate(list(patterns)[:3]):
        color = {"bullish": "#3fb950", "bearish": "#f85149", "neutral": "#d29922"}.get(pat.get("direction"), "#8b949e")
        ax.text(0.01, 0.97 - i * 0.06, f"⬤ {pat.get('name_de', pat.get('name', ''))}",
                transform=ax.transAxes, color=color, fontsize=9, fontweight="bold",
                verticalalignment="top")

    ax.legend(loc="upper right", frameon=False, fontsize=7, ncol=3)
    ax.grid(True, alpha=0.25)
    ax.xaxis_date()
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%m-%d\n%H:%M"))

    vol_colors = ["#3fb950" if u else "#f85149" for u in up]
    axv.bar(x, df["volume"], width=width_d, color=vol_colors, alpha=0.6)
    axv.set_ylabel("Vol")
    axv.grid(True, alpha=0.15)

    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=110, facecolor=fig.get_facecolor())
    plt.close(fig)
    return buf.getvalue()
