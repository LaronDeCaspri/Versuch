from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv


@dataclass
class ExchangeCfg:
    name: str = "binance"
    testnet: bool = True
    markets: list[str] = field(default_factory=lambda: ["spot"])


@dataclass
class UniverseCfg:
    symbols: list[str] = field(default_factory=list)
    timeframes: list[str] = field(default_factory=list)
    primary_timeframe: str = "15m"


@dataclass
class EngineCfg:
    loop_interval_seconds: int = 30
    warmup_candles: int = 500
    parallel_scans: int = 16


@dataclass
class RiskCfg:
    account_currency: str = "USDT"
    risk_per_trade_pct: float = 1.0
    max_open_positions: int = 5
    max_daily_loss_pct: float = 4.0
    max_drawdown_pct: float = 15.0
    atr_stop_multiplier: float = 2.0
    take_profit_r_multiple: list[float] = field(default_factory=lambda: [1.5, 2.5, 4.0])
    trail_after_r: float = 1.0


@dataclass
class EnsembleCfg:
    min_score: float = 1.5
    agreement_required: int = 2


@dataclass
class Config:
    exchange: ExchangeCfg
    universe: UniverseCfg
    engine: EngineCfg
    risk: RiskCfg
    strategies: dict[str, dict[str, Any]]
    ensemble: EnsembleCfg
    logging: dict[str, Any]
    secrets: dict[str, str]

    @classmethod
    def load(cls, path: str | Path = "config.yaml", env_path: str | Path = ".env") -> "Config":
        load_dotenv(env_path)
        with open(path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f)
        return cls(
            exchange=ExchangeCfg(**raw.get("exchange", {})),
            universe=UniverseCfg(**raw.get("universe", {})),
            engine=EngineCfg(**raw.get("engine", {})),
            risk=RiskCfg(**raw.get("risk", {})),
            strategies=raw.get("strategies", {}),
            ensemble=EnsembleCfg(**raw.get("ensemble", {})),
            logging=raw.get("logging", {}),
            secrets={k: v for k, v in os.environ.items()},
        )

    def api_key(self, exchange: str) -> tuple[str, str, str | None]:
        e = exchange.upper()
        key = self.secrets.get(f"{e}_API_KEY", "")
        secret = self.secrets.get(f"{e}_API_SECRET", "")
        passphrase = self.secrets.get(f"{e}_PASSPHRASE")
        return key, secret, passphrase
