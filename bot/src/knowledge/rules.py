"""
Distilled principles from public trading literature (Elder, Schwager, Douglas,
Murphy, Wyckoff, O'Neil, Livermore, Weinstein, Van Tharp) plus public content
from MMCrypto, Krown, Peter Brandt, Tom Dante and the ten legends from
trading.de: Soros, Buffett, Paul Tudor Jones, Paulson, Livermore, Einhorn,
Dalio, Templeton, Tepper, Ackman. This is a summary rulebook, not the
copyrighted source material.
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

    # trading.de top 10
    "soros_reflexivity":            "self-reinforcing trends eventually reverse violently; sell exhaustion",
    "buffett_value":                "buy high-quality assets at a discount and hold; be greedy when others fear",
    "ptj_regime_shift":             "size UP on regime shifts (vol expansion + trend break); protect capital first",
    "paulson_bubble":               "when the crowd is euphoric on unsustainable fundamentals, prepare short",
    "livermore_pivot":              "wait for the pivotal point break confirmed by volume; never anticipate",
    "einhorn_bearish_bias":         "short weakening businesses when technical divergence confirms fundamentals",
    "dalio_all_weather":            "balance risk across regimes; correlation is what actually kills portfolios",
    "templeton_max_pessimism":      "buy at the point of maximum pessimism, sell at max optimism",
    "tepper_liquidity_pivot":       "when policy/liquidity turns, distressed assets rip; be early and sized",
    "ackman_concentration":         "few, high-conviction bets, sized meaningfully, held with a written thesis",
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
    "11. Soros: your job is not to be right; it is to make money when you are right and lose little when you are wrong.",
    "12. Buffett: the first rule is do not lose money; the second rule is do not forget the first.",
    "13. PTJ: playing defense is more important than offense; the best trades come from doing nothing most of the time.",
    "14. Paulson: extraordinary opportunities exist only when the crowd is dogmatically wrong.",
    "15. Livermore: the market is never wrong, opinions often are.",
    "16. Einhorn: shorting is not about being right on the story; it is about being right on the price.",
    "17. Dalio: he who lives by the crystal ball is destined to eat glass; diversify what you own AND when you own it.",
    "18. Templeton: bull markets are born on pessimism, grow on skepticism, mature on optimism, die on euphoria.",
    "19. Tepper: when the Fed acts, position size accordingly.",
    "20. Ackman: know what you own, size like you mean it, and if the thesis breaks, get out fast.",
]

READING_LIST: list[str] = [
    "Reminiscences of a Stock Operator - Edwin Lefevre (Livermore's story)",
    "Market Wizards - Jack Schwager",
    "The New Market Wizards - Jack Schwager",
    "Hedge Fund Market Wizards - Jack Schwager (Dalio, Weinstein, Woodriff)",
    "Trading in the Zone - Mark Douglas",
    "Come Into My Trading Room - Alexander Elder",
    "Technical Analysis of the Financial Markets - John Murphy",
    "Trade Your Way to Financial Freedom - Van K. Tharp",
    "How to Make Money in Stocks - William O'Neil",
    "Stan Weinstein's Secrets for Profiting in Bull and Bear Markets",
    "Principles - Ray Dalio",
    "The Alchemy of Finance - George Soros",
    "The Intelligent Investor - Benjamin Graham (Buffett's mentor)",
    "The Essays of Warren Buffett - Warren Buffett / Lawrence Cunningham",
    "The Little Book that Beats the Market - Joel Greenblatt",
    "Fooling Some of the People All of the Time - David Einhorn",
    "One Up on Wall Street - Peter Lynch",
    "The Templeton Way - Lauren Templeton",
    "Diary of a Professional Commodity Trader - Peter Brandt",
]


def lookup(tag: str) -> str:
    return PRINCIPLES.get(tag, "")
