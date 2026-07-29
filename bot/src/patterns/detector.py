"""
Chart pattern recognition. Each detection returns a Pattern with:

- name         : short technical name (English + German)
- direction    : bullish | bearish | neutral
- why          : one-line explanation of the geometry ("was zeigt das?")
- means        : practical trading implication ("was bedeutet das?")
- action       : what a trader would typically do
- confidence   : 0..1

The point is educational transparency: every card on the phone answers
warum / weshalb / wieso, not just "pattern detected".
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

import numpy as np
import pandas as pd

from .. import indicators as ta


@dataclass
class Pattern:
    name: str
    name_de: str
    direction: str                          # bullish | bearish | neutral
    why: str
    means: str
    action: str
    confidence: float
    at_index: int
    price: float

    def to_dict(self) -> dict:
        return asdict(self)


class PatternDetector:
    def detect(self, df: pd.DataFrame) -> list[Pattern]:
        if len(df) < 60:
            return []
        out: list[Pattern] = []
        out.extend(self._candlesticks(df))
        out.extend(self._structure(df))
        out.extend(self._trendlines(df))
        # dedupe by name at same latest bar
        seen = set()
        unique = []
        for p in reversed(out):
            key = (p.name, p.at_index)
            if key in seen:
                continue
            seen.add(key)
            unique.append(p)
        return list(reversed(unique))

    # ------- candlestick patterns ------------------------------------------
    def _candlesticks(self, df: pd.DataFrame) -> list[Pattern]:
        o, h, l, c = df["open"], df["high"], df["low"], df["close"]
        out: list[Pattern] = []
        i = len(df) - 1
        body = abs(c.iloc[i] - o.iloc[i])
        rng = h.iloc[i] - l.iloc[i]
        upper_wick = h.iloc[i] - max(c.iloc[i], o.iloc[i])
        lower_wick = min(c.iloc[i], o.iloc[i]) - l.iloc[i]
        price = float(c.iloc[i])

        # Doji
        if rng > 0 and body / rng < 0.10:
            out.append(Pattern(
                "doji", "Doji", "neutral",
                "Eröffnung und Schluss liegen fast auf gleicher Höhe – Käufer und Verkäufer sind unentschlossen.",
                "Der aktuelle Trend hat den Schwung verloren. Nach einem starken Trend ist das ein Warnsignal für eine mögliche Wende.",
                "Nicht direkt handeln. Auf Bestätigung durch die nächste Kerze warten.",
                0.55, i, price,
            ))
        # Hammer (bullish)
        if body > 0 and lower_wick > 2 * body and upper_wick < body:
            trend_before = float(c.iloc[i - 1] - c.iloc[i - 10]) if i >= 10 else 0
            if trend_before < 0:
                out.append(Pattern(
                    "hammer", "Hammer (bullisch)", "bullish",
                    "Kleiner Körper oben, langer Docht nach unten – Verkäufer haben tief gedrückt, Käufer haben wieder zurückerobert.",
                    "Nach einem Abwärtstrend ein klassisches Umkehr-Zeichen. Käuferdruck kehrt zurück.",
                    "Auf Bestätigung der Folgekerze warten, dann Long-Einstieg mit Stop unter dem Docht.",
                    0.7, i, price,
                ))
        # Shooting Star (bearish)
        if body > 0 and upper_wick > 2 * body and lower_wick < body:
            trend_before = float(c.iloc[i - 1] - c.iloc[i - 10]) if i >= 10 else 0
            if trend_before > 0:
                out.append(Pattern(
                    "shooting_star", "Shooting Star (bärisch)", "bearish",
                    "Kleiner Körper unten, langer Docht nach oben – Käufer sind hochgestiegen, Verkäufer haben brutal zurückgedrückt.",
                    "Nach einem Aufwärtstrend eine typische Ober-Warnung. Kauflaune verpufft.",
                    "Short-Setup, Stop über dem Docht. Oder Longs sichern.",
                    0.7, i, price,
                ))
        # Bullish/Bearish engulfing
        if i >= 1:
            body_prev = abs(c.iloc[i - 1] - o.iloc[i - 1])
            green_now = c.iloc[i] > o.iloc[i]
            red_prev = c.iloc[i - 1] < o.iloc[i - 1]
            if green_now and red_prev and c.iloc[i] > o.iloc[i - 1] and o.iloc[i] < c.iloc[i - 1] and body > body_prev:
                out.append(Pattern(
                    "bullish_engulfing", "Bullish Engulfing", "bullish",
                    "Eine grosse grüne Kerze schluckt die vorherige rote Kerze komplett – Käufer übernehmen die Kontrolle.",
                    "Starkes Umkehrsignal, besonders nach einem Abwärtstrend. Käuferseite dominiert klar.",
                    "Long-Einstieg auf der Folgekerze, Stop unter dem Tief der Formation.",
                    0.75, i, price,
                ))
            green_prev = c.iloc[i - 1] > o.iloc[i - 1]
            red_now = c.iloc[i] < o.iloc[i]
            if red_now and green_prev and c.iloc[i] < o.iloc[i - 1] and o.iloc[i] > c.iloc[i - 1] and body > body_prev:
                out.append(Pattern(
                    "bearish_engulfing", "Bearish Engulfing", "bearish",
                    "Eine grosse rote Kerze schluckt die vorherige grüne Kerze komplett – Verkäufer übernehmen die Kontrolle.",
                    "Starkes Umkehrsignal, besonders nach einem Aufwärtstrend.",
                    "Short-Einstieg auf der Folgekerze, Stop über dem Hoch der Formation.",
                    0.75, i, price,
                ))
        # Morning star (3-bar bullish)
        if i >= 2:
            c1 = c.iloc[i - 2] < o.iloc[i - 2]                                # first red
            small_body = abs(c.iloc[i - 1] - o.iloc[i - 1]) < abs(c.iloc[i - 2] - o.iloc[i - 2]) * 0.4
            c3 = c.iloc[i] > o.iloc[i] and c.iloc[i] > (o.iloc[i - 2] + c.iloc[i - 2]) / 2
            if c1 and small_body and c3:
                out.append(Pattern(
                    "morning_star", "Morning Star", "bullish",
                    "Rote Kerze – kleine Kerze (Wende) – grosse grüne Kerze schliesst über der Mitte der ersten.",
                    "Klassische Boden-Formation. Der Verkaufsdruck ist ausgelaufen, Käufer übernehmen.",
                    "Long-Einstieg, Stop unter dem Tief der mittleren Kerze.",
                    0.8, i, price,
                ))
            c1b = c.iloc[i - 2] > o.iloc[i - 2]
            c3b = c.iloc[i] < o.iloc[i] and c.iloc[i] < (o.iloc[i - 2] + c.iloc[i - 2]) / 2
            if c1b and small_body and c3b:
                out.append(Pattern(
                    "evening_star", "Evening Star", "bearish",
                    "Grüne Kerze – kleine Kerze – grosse rote Kerze schliesst unter der Mitte der ersten.",
                    "Klassische Top-Formation. Die Kaufkraft verpufft, Verkäufer übernehmen.",
                    "Short-Einstieg, Stop über dem Hoch der mittleren Kerze.",
                    0.8, i, price,
                ))
        # Three white soldiers / black crows
        if i >= 2:
            three_up = all(c.iloc[i - k] > o.iloc[i - k] for k in range(3)) \
                       and c.iloc[i - 2] < c.iloc[i - 1] < c.iloc[i]
            three_dn = all(c.iloc[i - k] < o.iloc[i - k] for k in range(3)) \
                       and c.iloc[i - 2] > c.iloc[i - 1] > c.iloc[i]
            if three_up:
                out.append(Pattern(
                    "three_white_soldiers", "Three White Soldiers", "bullish",
                    "Drei grüne Kerzen in Folge, jede höher schliessend als die vorherige.",
                    "Sehr starke Trendbestätigung nach unten oder aus einer Basis heraus.",
                    "Long-Trend läuft. Einstiege in Rücksetzern nutzen, nicht in die Kerzen hineinkaufen.",
                    0.7, i, price,
                ))
            if three_dn:
                out.append(Pattern(
                    "three_black_crows", "Three Black Crows", "bearish",
                    "Drei rote Kerzen in Folge, jede tiefer schliessend als die vorherige.",
                    "Sehr starke Abwärtsbewegung, oft Beginn eines Abverkaufs.",
                    "Short-Trend läuft. Longs schliessen. Auf Pullbacks für Shorts warten.",
                    0.7, i, price,
                ))
        return out

    # ------- structural patterns -------------------------------------------
    def _structure(self, df: pd.DataFrame) -> list[Pattern]:
        out: list[Pattern] = []
        c = df["close"]
        i = len(df) - 1
        price = float(c.iloc[i])

        # Double top / double bottom (last 60 bars)
        window = df.iloc[-60:]
        highs = window["high"]
        lows = window["low"]
        top1_idx = int(highs.iloc[:30].idxmax() == highs.iloc[:30].max()) if False else 0
        # simpler peak clustering
        peaks = _find_peaks(highs.values, distance=5)
        troughs = _find_peaks(-lows.values, distance=5)
        if len(peaks) >= 2:
            p1, p2 = peaks[-2], peaks[-1]
            v1, v2 = highs.values[p1], highs.values[p2]
            if abs(v1 - v2) / max(v1, 1e-9) < 0.015 and p2 - p1 >= 5:
                neckline = float(lows.iloc[p1:p2].min())
                if price < v2 and c.iloc[i - 1] < neckline * 1.005:
                    out.append(Pattern(
                        "double_top", "Doppel-Top", "bearish",
                        f"Zwei fast identische Hochs bei {v1:.2f} / {v2:.2f} mit einem Tal dazwischen (Nackenlinie ≈ {neckline:.2f}).",
                        "Käufer haben zweimal versucht durchzubrechen und sind gescheitert. Verkäufer gewinnen die Oberhand.",
                        "Short, wenn die Nackenlinie durchbrochen wird. Kursziel ≈ Höhe der Formation unter der Nackenlinie.",
                        0.75, i, price,
                    ))
        if len(troughs) >= 2:
            p1, p2 = troughs[-2], troughs[-1]
            v1, v2 = lows.values[p1], lows.values[p2]
            if abs(v1 - v2) / max(v1, 1e-9) < 0.015 and p2 - p1 >= 5:
                neckline = float(highs.iloc[p1:p2].max())
                if price > v2 and c.iloc[i - 1] > neckline * 0.995:
                    out.append(Pattern(
                        "double_bottom", "Doppel-Boden", "bullish",
                        f"Zwei fast identische Tiefs bei {v1:.2f} / {v2:.2f} mit einem Hoch dazwischen (Nackenlinie ≈ {neckline:.2f}).",
                        "Verkäufer sind zweimal am Support gescheitert. Käufer übernehmen.",
                        "Long, wenn die Nackenlinie überschritten wird. Kursziel ≈ Höhe der Formation über der Nackenlinie.",
                        0.75, i, price,
                    ))

        # Head & Shoulders (very rough)
        if len(peaks) >= 3:
            a, b, cc = peaks[-3], peaks[-2], peaks[-1]
            va, vb, vc = highs.values[a], highs.values[b], highs.values[cc]
            if vb > va and vb > vc and abs(va - vc) / max(va, 1e-9) < 0.03:
                neckline = float(min(lows.values[a:cc].min(), lows.values[cc:].min() if cc < len(lows) - 1 else lows.values[cc]))
                out.append(Pattern(
                    "head_shoulders", "Kopf-Schulter-Formation", "bearish",
                    f"Drei Hochs: Schulter ({va:.2f}), Kopf ({vb:.2f}), Schulter ({vc:.2f}) mit Nackenlinie bei {neckline:.2f}.",
                    "Die klassische Top-Formation. Nach zwei Fehlversuchen bricht der Kurs meist nach unten durch.",
                    "Short beim Bruch der Nackenlinie. Kursziel ≈ Höhe des Kopfes über der Nackenlinie, gespiegelt nach unten.",
                    0.8, i, price,
                ))
            if vb < va and vb < vc and abs(va - vc) / max(va, 1e-9) < 0.03:
                out.append(Pattern(
                    "inv_head_shoulders", "Inverse Kopf-Schulter", "bullish",
                    f"Spiegelbild: Drei Tiefs mit einem tieferen mittleren.",
                    "Klassische Boden-Formation. Verkaufsdruck endet.",
                    "Long beim Bruch der Nackenlinie.",
                    0.8, i, price,
                ))
        return out

    # ------- trend / channel patterns --------------------------------------
    def _trendlines(self, df: pd.DataFrame) -> list[Pattern]:
        out: list[Pattern] = []
        c = df["close"]
        i = len(df) - 1
        price = float(c.iloc[i])
        window = df.iloc[-50:]
        xs = np.arange(len(window))
        # slope of highs and lows
        try:
            high_slope = np.polyfit(xs, window["high"].values, 1)[0]
            low_slope = np.polyfit(xs, window["low"].values, 1)[0]
        except np.linalg.LinAlgError:
            return out
        rng = window["high"].max() - window["low"].min()

        if abs(high_slope) < rng / 200 and low_slope > rng / 200:
            out.append(Pattern(
                "ascending_triangle", "Aufsteigendes Dreieck", "bullish",
                "Waagerechte obere Kante, steigende Tiefs – Käufer erhöhen den Einsatz gegen einen festen Widerstand.",
                "Ein Ausbruch nach oben ist wahrscheinlich, weil der Verkaufsdruck oben stufenweise abgearbeitet wird.",
                "Long bei Ausbruch über den Widerstand, Stop unter der letzten Trendline.",
                0.65, i, price,
            ))
        if high_slope < -rng / 200 and abs(low_slope) < rng / 200:
            out.append(Pattern(
                "descending_triangle", "Absteigendes Dreieck", "bearish",
                "Waagerechte untere Kante, fallende Hochs – Verkäufer drücken auf einen festen Support.",
                "Bruch nach unten wahrscheinlich, weil die Kaufkraft am Support abnimmt.",
                "Short bei Ausbruch unter Support.",
                0.65, i, price,
            ))
        if high_slope < -rng / 400 and low_slope > rng / 400 and abs(high_slope) + low_slope > rng / 200:
            out.append(Pattern(
                "symmetric_triangle", "Symmetrisches Dreieck", "neutral",
                "Hochs fallen, Tiefs steigen – Volatilität wird komprimiert.",
                "Kein Richtungssignal für sich – nach der Kompression folgt fast immer ein starker Ausbruch, meist in Trendrichtung.",
                "Ausbruch abwarten und in Ausbruchsrichtung handeln.",
                0.55, i, price,
            ))
        # Bull / bear flag
        if len(df) >= 60:
            prior = df.iloc[-60:-20]
            recent = df.iloc[-20:]
            prior_change = (prior["close"].iloc[-1] - prior["close"].iloc[0]) / prior["close"].iloc[0]
            recent_range = recent["close"].max() - recent["close"].min()
            recent_change = (recent["close"].iloc[-1] - recent["close"].iloc[0]) / recent["close"].iloc[0]
            if prior_change > 0.10 and abs(recent_change) < 0.04 and recent_range < prior["close"].iloc[-1] * 0.05:
                out.append(Pattern(
                    "bull_flag", "Bullen-Flagge", "bullish",
                    "Kräftige Aufwärtsbewegung, dann enge Konsolidierung nach unten oder seitwärts.",
                    "Fortsetzungsformation. Käufer nehmen kurz Gewinne, sammeln Kraft für den nächsten Schub.",
                    "Long beim Ausbruch aus der Flagge über das jüngste Hoch.",
                    0.7, i, price,
                ))
            if prior_change < -0.10 and abs(recent_change) < 0.04 and recent_range < prior["close"].iloc[-1] * 0.05:
                out.append(Pattern(
                    "bear_flag", "Bären-Flagge", "bearish",
                    "Kräftige Abwärtsbewegung, dann enge Konsolidierung nach oben oder seitwärts.",
                    "Fortsetzungsformation nach unten. Verkäufer atmen kurz durch.",
                    "Short beim Bruch unter das jüngste Tief.",
                    0.7, i, price,
                ))
        return out


def _find_peaks(x: np.ndarray, distance: int = 5) -> list[int]:
    peaks: list[int] = []
    for i in range(distance, len(x) - distance):
        window = x[i - distance:i + distance + 1]
        if x[i] == window.max() and x[i] > x[i - 1]:
            if not peaks or i - peaks[-1] >= distance:
                peaks.append(i)
    return peaks
