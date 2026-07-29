from .soros import SorosReflexivity
from .buffett import BuffettValue
from .paul_tudor_jones import PtjCrash
from .paulson import PaulsonBubble
from .livermore import LivermorePivot
from .einhorn import EinhornBear
from .dalio import DalioAllWeather
from .templeton import TempletonPessimism
from .tepper import TepperDistressed
from .ackman import AckmanConviction

TRADER_REGISTRY = {
    "soros_reflexivity": SorosReflexivity,
    "buffett_value": BuffettValue,
    "ptj_crash": PtjCrash,
    "paulson_bubble": PaulsonBubble,
    "livermore_pivot": LivermorePivot,
    "einhorn_bear": EinhornBear,
    "dalio_allweather": DalioAllWeather,
    "templeton_pessimism": TempletonPessimism,
    "tepper_distressed": TepperDistressed,
    "ackman_conviction": AckmanConviction,
}

__all__ = ["TRADER_REGISTRY"]
