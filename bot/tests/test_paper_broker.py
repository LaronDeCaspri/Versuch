from src.execution.paper import PaperBroker
from src.strategies.base import Side


def test_open_and_close_long_profit():
    b = PaperBroker(starting_balance=10_000, fee_bps=0)
    b.submit_market("BTC/USDT", Side.LONG, 0.1, 30_000)
    assert b.positions()["BTC/USDT"].qty == 0.1
    b.close_position("BTC/USDT", 31_000, 1.0)
    assert "BTC/USDT" not in b.positions()
    assert b.equity({"BTC/USDT": 31_000}) > 10_000


def test_stop_triggers_on_price():
    b = PaperBroker(starting_balance=10_000, fee_bps=0)
    b.submit_market("BTC/USDT", Side.LONG, 0.1, 30_000, metadata={"stop": 29_500, "take_profits": []})
    b.on_price("BTC/USDT", 29_400)
    assert "BTC/USDT" not in b.positions()


def test_take_profit_partial():
    b = PaperBroker(starting_balance=10_000, fee_bps=0)
    tps = [(31_000, 0.5), (32_000, 0.5)]
    b.submit_market("BTC/USDT", Side.LONG, 0.1, 30_000, metadata={"stop": 29_000, "take_profits": tps})
    b.on_price("BTC/USDT", 31_100)
    assert b.positions()["BTC/USDT"].qty == 0.05
    b.on_price("BTC/USDT", 32_100)
    assert "BTC/USDT" not in b.positions()


def test_short_profit():
    b = PaperBroker(starting_balance=10_000, fee_bps=0)
    b.submit_market("BTC/USDT", Side.SHORT, 0.1, 30_000)
    b.close_position("BTC/USDT", 29_000, 1.0)
    assert b.equity({}) > 10_000
