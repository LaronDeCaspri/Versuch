from .base import Signal, Side, Strategy, StrategyContext
from .ema_cross import EmaCross
from .macd_trend import MacdTrend
from .rsi_meanrev import RsiMeanReversion
from .bollinger_squeeze import BollingerSqueeze
from .donchian_breakout import DonchianBreakout
from .vwap_reversion import VwapReversion
from .mmcrypto_style import MmCryptoStyle
from .mega_confluence import MegaConfluence
from .weinstein_stages import WeinsteinStages
from .ensemble import Ensemble
from .traders import TRADER_REGISTRY

REGISTRY: dict[str, type[Strategy]] = {
    "ema_cross": EmaCross,
    "macd_trend": MacdTrend,
    "rsi_meanrev": RsiMeanReversion,
    "bollinger_squeeze": BollingerSqueeze,
    "donchian_breakout": DonchianBreakout,
    "vwap_reversion": VwapReversion,
    "mmcrypto_style": MmCryptoStyle,
    "mega_confluence": MegaConfluence,
    "weinstein_stages": WeinsteinStages,
    **TRADER_REGISTRY,
}

__all__ = ["Signal", "Side", "Strategy", "StrategyContext", "Ensemble", "REGISTRY"]
