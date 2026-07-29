"""
Distilled principles from public trading literature (Elder, Schwager, Douglas,
Murphy, Wyckoff, O'Neil, Livermore, Weinstein, Van Tharp) plus public content
from MMCrypto, Krown, Peter Brandt, Tom Dante and others. The bot references
these tags for logging and trade-journal context. This is a summary rulebook,
not the copyrighted source material.
"""

PRINCIPLES: dict[str, str] = {
    "trend_is_friend":              "trade in the direction of the higher-timeframe trend",
    "risk_first":                   "fix risk per trade before position sizing (Van Tharp: 1R model)",
    "asymmetric_rr":                "only take setups with expected R:R >= 1.5, ideally >= 2",
    "confluence":                   "prefer entries where 2+ independent signals align",
    "volume_confirmation":          "breakouts must be confirmed by expanding volume",
    "no_averaging_losers":          "never add to a losing position (Livermore, Douglas)",
    "cut_losses_short":             "stop is a decision made before entry, executed without emotion",
    "let_winners_run":              "trail stops behind structure, do not micro-manage TPs",
    "context_over_pattern":         "a pattern in the wrong context is not a setup",
    "wyckoff_phases":               "accumulation -> markup -> distribution -> markdown",
    "weinstein_stages":             "stage 1 base, stage 2 advance, stage 3 top, stage 4 decline",
    "mmcrypto_htf_bias":            "check weekly + daily bias before intraday triggers",
    "mmcrypto_liquidity_grab":      "look for wicks that sweep obvious liquidity, then reverse",
    "brandt_horizontal":            "horizontal support/resistance beats fancy oscillators",
    "krown_range_edges":            "trade the edges of the range, not the middle",
    "tom_dante_flag":               "clean bull/bear flags after trends give the highest R:R",
    "peter_brandt_classical":       "classical chart patterns (H&S, wedges, triangles) still work",
    "oneil_cup_and_handle":         "consolidation after a rise + shallow handle = continuation",
    "elder_triple_screen":          "long TF filter, mid TF signal, short TF entry",
    "session_awareness":            "respect open, close, and overlap-driven volatility windows",
    "position_management":          "scale out at pre-defined R multiples, move stop to BE after 1R",
    "black_swan_defense":           "cap total portfolio risk, never oversize on one narrative",
}

RULEBOOK: list[str] = [
    "1. Preserve capital first, profit second.",
    "2. No trade without a written invalidation level.",
    "3. Risk per trade is fixed; position size flexes to keep risk constant.",
    "4. Confluence beats conviction. Two independent signals or nothing.",
    "5. Higher timeframe sets bias, lower timeframe sets trigger.",
    "6. Volume validates price; price without volume is noise.",
    "7. Never chase. If the setup left, the next one is minutes away.",
    "8. After 3 consecutive losses in a session, stop trading and review.",
    "9. Journal every trade: setup, thesis, execution, outcome, lesson.",
    "10. Kill-switch on max daily loss and max drawdown is not negotiable.",
]


def lookup(tag: str) -> str:
    return PRINCIPLES.get(tag, "")
