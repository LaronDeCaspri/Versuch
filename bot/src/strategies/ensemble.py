from __future__ import annotations

from collections import defaultdict

from ..core.config import Config
from ..core.logger import get
from .base import Side, Signal, Strategy, StrategyContext

log = get(__name__)


class Ensemble:
    def __init__(self, strategies: list[tuple[Strategy, float]], min_score: float, agreement: int):
        self.strategies = strategies
        self.min_score = min_score
        self.agreement = agreement

    @classmethod
    def from_config(cls, cfg: Config, registry: dict[str, type[Strategy]]) -> "Ensemble":
        strategies: list[tuple[Strategy, float]] = []
        for key, params in cfg.strategies.items():
            if not params.get("enabled", False):
                continue
            klass = registry.get(key)
            if klass is None:
                log.warning(f"unknown strategy in config: {key}")
                continue
            strategies.append((klass(params), float(params.get("weight", 1.0))))
        log.info(f"ensemble loaded with {len(strategies)} strategies")
        return cls(strategies, cfg.ensemble.min_score, cfg.ensemble.agreement_required)

    def score(self, ctx: StrategyContext) -> tuple[Side, float, list[Signal]]:
        buckets: dict[Side, list[Signal]] = defaultdict(list)
        weights: dict[Side, float] = defaultdict(float)
        for strat, w in self.strategies:
            try:
                sig = strat.evaluate(ctx)
            except Exception as e:
                log.warning(f"{strat.name} failed on {ctx.symbol}/{ctx.timeframe}: {e}")
                continue
            if sig is None or sig.side is Side.FLAT:
                continue
            buckets[sig.side].append(sig)
            weights[sig.side] += w * sig.strength
        if not weights:
            return Side.FLAT, 0.0, []
        winning_side = max(weights, key=weights.get)
        score = weights[winning_side]
        confirming = buckets[winning_side]
        if score < self.min_score or len(confirming) < self.agreement:
            return Side.FLAT, score, confirming
        return winning_side, score, confirming
