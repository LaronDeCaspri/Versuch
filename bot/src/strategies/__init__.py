from .base import Signal, Side, Strategy, StrategyContext
from .ema_cross import EmaCross
from .macd_trend import MacdTrend
from .rsi_meanrev import RsiMeanReversion
from .bollinger_squeeze import BollingerSqueeze
from .donchian_breakout import DonchianBreakout
from .vwap_reversion import VwapReversion
from .mmcrypto_style import MmCryptoStyle
from .ensemble import Ensemble

REGISTRY: dict[str, type[Strategy]] = {
    "ema_cross": EmaCross,
    "macd_trend": MacdTrend,
    "rsi_meanrev": RsiMeanReversion,
    "bollinger_squeeze": BollingerSqueeze,
    "donchian_breakout": DonchianBreakout,
    "vwap_reversion": VwapReversion,
    "mmcrypto_style": MmCryptoStyle,
}

__all__ = ["Signal", "Side", "Strategy", "StrategyContext", "Ensemble", "REGISTRY"]
