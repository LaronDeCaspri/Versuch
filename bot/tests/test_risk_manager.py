from src.core.config import RiskCfg
from src.risk.manager import RiskManager
from src.strategies.base import Side


def test_plan_long_sizing():
    rm = RiskManager(RiskCfg(risk_per_trade_pct=1.0, atr_stop_multiplier=2.0,
                             take_profit_r_multiple=[1.5, 2.5, 4.0]))
    plan = rm.plan(Side.LONG, entry=100.0, atr=1.0, equity=10_000)
    assert plan is not None
    assert plan.stop == 98.0
    assert abs(plan.risk_amount - 100.0) < 1e-9
    assert abs(plan.size - 50.0) < 1e-9
    assert len(plan.take_profits) == 3


def test_plan_short():
    rm = RiskManager(RiskCfg())
    plan = rm.plan(Side.SHORT, entry=100.0, atr=1.0, equity=10_000)
    assert plan.stop > 100.0
    tp0 = plan.take_profits[0][0]
    assert tp0 < 100.0


def test_kill_switch_drawdown():
    rm = RiskManager(RiskCfg(max_drawdown_pct=10.0))
    rm.check_kill_switch(10_000)
    rm.check_kill_switch(11_000)
    assert not rm.check_kill_switch(10_500)
    assert rm.check_kill_switch(9_800)


def test_kill_switch_daily():
    rm = RiskManager(RiskCfg(max_daily_loss_pct=3.0))
    rm.new_day(10_000)
    assert not rm.check_kill_switch(9_900)
    assert rm.check_kill_switch(9_650)
