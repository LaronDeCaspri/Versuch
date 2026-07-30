/* ============================================================
 * Trading Bot — standalone browser app orchestration
 * Runs autonomously in the tab. Persists everything in localStorage.
 * ============================================================ */
(function () {

const ALL_SYMBOLS = [
    "BTC/USDT", "ETH/USDT", "BNB/USDT", "SOL/USDT", "XRP/USDT", "ADA/USDT",
    "AVAX/USDT", "LINK/USDT", "DOT/USDT", "MATIC/USDT", "TRX/USDT", "TON/USDT",
    "DOGE/USDT", "SHIB/USDT", "LTC/USDT", "BCH/USDT", "UNI/USDT", "ATOM/USDT",
    "NEAR/USDT", "APT/USDT", "ARB/USDT", "OP/USDT", "SUI/USDT", "SEI/USDT",
    "ICP/USDT", "AAVE/USDT", "FIL/USDT", "INJ/USDT", "RNDR/USDT", "FET/USDT",
];

function loadSymbols() {
    const stored = JSON.parse(localStorage.getItem("tb_symbols") || "null");
    return stored && Array.isArray(stored) && stored.length ? stored :
        ["BTC/USDT", "ETH/USDT", "BNB/USDT", "SOL/USDT", "XRP/USDT", "ADA/USDT",
         "AVAX/USDT", "LINK/USDT", "DOT/USDT", "MATIC/USDT"];
}

const CFG = {
    symbols: loadSymbols(),
    primaryTf: "15m",
    scanIntervalSec: 30,
    priceIntervalSec: 10,
    // dynamic sizing: base 0.5%, scales up to 3% for top-quality setups
    baseRiskPct: 0.5,
    maxRiskPct: 3.0,
    atrStopMult: 1.8,
    tpMultiples: [2.0, 3.5, 5.0],
    maxOpenPositions: 12,
    maxNotionalPctPerPosition: 8,    // max 8% of equity per position (12 positions × 8% = 96%, keeps some cash)
    // strict filters — auto-trade ONLY on best setups
    strictMinScore: 3.0,
    strictAgreement: 3,
    strictMaxRisk: 30,
    // manual filters — a bit looser so the user still sees candidates
    softMinScore: 1.8,
    softAgreement: 2,
    softMaxRisk: 55,
    // kill switch
    maxDailyLossPct: 4.0,
    maxDrawdownPct: 15.0,
    // correlation warning
    correlationWarnThreshold: 0.75,
};

const state = {
    candles: {},                             // {symbol: [candles]}
    prices: {},                              // {symbol: price}
    pending: [],                             // pending signals awaiting confirm
    autoMode: localStorage.getItem("tb_auto") === "1",
    fng: null,
    scanCount: 0,
    tradeCount: 0,
    equityHistory: JSON.parse(localStorage.getItem("tb_equity_hist") || "[]"),
    peakEquity: parseFloat(localStorage.getItem("tb_peak_equity") || "10000"),
    dayStartEquity: parseFloat(localStorage.getItem("tb_day_equity") || "10000"),
    dayStartDate: localStorage.getItem("tb_day_date") || new Date().toDateString(),
    halted: localStorage.getItem("tb_halted") === "1",
    watchlist: JSON.parse(localStorage.getItem("tb_watchlist") || "[]"),
    news: [],
    lastNewsFetch: 0,
};

const broker = new window.TB.PaperBroker(10000);

// =========== utilities ============================================
const $ = (s) => document.querySelector(s);
const fmt = (n, d = 2) => n == null || isNaN(n) ? "–" : Number(n).toLocaleString("de-DE", { maximumFractionDigits: d });
const money = (n) => n == null || isNaN(n) ? "–" : Number(n).toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " USDT";

function announce(text, level = "info") {
    window.dispatchEvent(new CustomEvent("jarvis", { detail: { text, level } }));
}

async function keepAwake() {
    if ("wakeLock" in navigator) {
        try {
            const sentinel = await navigator.wakeLock.request("screen");
            sentinel.addEventListener("release", () => {
                setTimeout(keepAwake, 5000);
            });
        } catch (e) { /* user permission denied */ }
    }
}

// =========== rendering ============================================
function renderSignalTile(pending, fallback) {
    const tile = $("#signal-tile");
    if (pending) {
        const cls = pending.side === "long" ? "green" : "red";
        const label = pending.side === "long" ? "KAUFEN" : "VERKAUFEN";
        const badge = pending.side === "long" ? "KAUFSIGNAL" : "VERKAUFSSIGNAL";
        const f = pending.forecast;
        const r = pending.risk;
        const tpLines = pending.take_profits.map((tp, i) =>
            `<div><div class="k">TP${i + 1} · ${Math.round(tp.fraction * 100)}%</div><div class="v num">${fmt(tp.price, 4)}</div></div>`).join("");
        const riskFactors = r.factors.map((x) =>
            `<div class="risk-factor"><span>${x.name} <small>(${x.value})</small></span><span class="impact">+${x.impact}</span></div>`).join("");
        tile.className = "signal " + cls;
        tile.innerHTML = `
            <div class="signal-badge">${badge}</div>
            <div class="signal-label">${label}</div>
            <div class="signal-symbol">${pending.symbol}</div>
            <div class="signal-price num">Preis ${fmt(pending.entry, 4)} USDT</div>
            <div class="kv">
                <div><div class="k">Entry</div><div class="v num">${fmt(pending.entry, 4)}</div></div>
                <div><div class="k">Stop-Loss</div><div class="v num" style="color:var(--red)">${fmt(pending.stop, 4)}</div></div>
                ${tpLines}
                <div><div class="k">Grösse</div><div class="v num">${fmt(pending.size, 6)}</div></div>
                <div><div class="k">Risiko</div><div class="v num">${money(pending.riskAmount)}</div></div>
            </div>
            <div class="risk-block">
                <div class="risk-title"><span>Risiko-Bewertung</span><span style="color:var(--${r.color}); font-weight:800;">${r.label.toUpperCase()} · ${r.score}/100</span></div>
                <div class="risk-bar-bg"><div class="risk-bar-fill risk-color-${r.color}" style="width:${r.score}%;"></div></div>
                ${riskFactors}
            </div>
            <div class="forecast-block">
                <div class="risk-title"><span>Gewinn-Prognose</span><span style="color:var(--text-2); font-weight:600;">R : R  1 : ${fmt(f.rrFinal, 2)}</span></div>
                <div class="row"><span>Bei allen Take-Profits</span><strong class="num" style="color:var(--green)">+${money(f.weighted)}</strong></div>
                <div class="row"><span>Bei vollem Run</span><strong class="num" style="color:var(--green)">+${money(f.maxProfit)}</strong></div>
                <div class="row"><span>Bei Stop-Loss</span><strong class="num" style="color:var(--red)">-${money(f.lossAtStop)}</strong></div>
                <div class="row"><span>Erwartungswert (50/50)</span><strong class="num">${money(f.ev)}</strong></div>
            </div>
            <div class="rationale-block">
                <div class="head">Warum dieser Trade? · ${pending.signals.length} Strategie${pending.signals.length !== 1 ? "n" : ""}</div>
                ${pending.signals.map((s) => `<div class="rat-item"><span class="rat-strat">${s.strategy.replace(/_/g, " ")}</span>${s.reason}</div>`).join("")}
                ${pending.highCorr.length ? `<div class="corr-warning">⚠ Hohe Korrelation mit offener Position: ${pending.highCorr.map((c) => `${c.sym} (ρ ${c.corr.toFixed(2)})`).join(", ")}. Diversifikations-Warnung.</div>` : ""}
                ${pending.newsForSymbol.length ? `<div class="rat-news"><div class="head">Aktuelle News zu ${pending.symbol.replace("/USDT","")}</div>${pending.newsForSymbol.map((n) => `<a href="${n.url}" target="_blank" rel="noopener">• ${n.title} <small style="color:var(--muted)">(${n.source})</small></a>`).join("")}</div>` : ""}
            </div>
            <div class="btn-row" style="margin-top:16px;">
                <button class="confirm" id="confirm-btn">✓ BESTÄTIGEN</button>
                <button class="danger" id="cancel-btn">✕ VERWERFEN</button>
            </div>
            <div class="sizing-rule">
                <div class="risk-title">Sizing-Regel · was investiert der Bot?</div>
                <div class="row"><span>Investment (Notional)</span><strong class="num">${fmt(pending.qty * pending.entry, 2)} USDT · ${fmt(pending.qty * pending.entry / broker.cash * 100, 1)}% des Cash</strong></div>
                <div class="row"><span>Cash frei nach Trade</span><strong class="num">${fmt(broker.cash - pending.qty * pending.entry, 2)} USDT</strong></div>
                <div class="row"><span>Risiko-Anteil</span><strong class="num">${(pending.dynRiskPct || CFG.baseRiskPct).toFixed(2)}% des Equity · max ${money(pending.riskAmount)} Verlust bei Stop</strong></div>
                <div class="row" style="border-bottom:none;"><span>Position-Cap</span><strong class="num">${CFG.maxNotionalPctPerPosition}% des Equity max pro Position</strong></div>
                <div style="margin-top:8px; font-size:0.7rem; color:var(--muted); line-height:1.4;">
                    <b>Regel:</b> Kelly-optimiert wenn ≥ 20 Trades im Journal, sonst Score-basiert (0,5-3% Risiko).
                    Der Bot bindet nie mehr Cash als vorhanden und deckelt jede Position auf ${CFG.maxNotionalPctPerPosition}% des Equity — bei ${CFG.maxOpenPositions} Positionen sind ${(CFG.maxNotionalPctPerPosition * CFG.maxOpenPositions).toFixed(0)}% investiert, der Rest ist Cash-Puffer.
                </div>
            </div>
        `;
        $("#confirm-btn").onclick = () => confirmPending(pending);
        $("#cancel-btn").onclick = () => cancelPending(pending);
    } else {
        const f = fallback || { action: "HALTEN", color: "grey", symbol: "–",
            hint: state.lastScan ? "Kein konfluentes Setup — Bot bleibt geduldig" : "Lade Live-Daten von Binance ..." };
        tile.className = "signal " + (f.color || "grey");
        tile.innerHTML = `
            <div class="signal-badge">Handelsentscheidung</div>
            <div class="signal-label">${f.action}</div>
            <div class="signal-symbol">${f.symbol || "–"}</div>
            <div class="signal-price num">${f.hint || ""}</div>`;
    }
}

function renderPortfolio() {
    const marks = state.prices;
    const eq = broker.equity(marks);
    const pnl = broker.realizedPnl();
    const nPos = Object.keys(broker.positions).length;
    $("#equity").textContent = money(eq);
    $("#cash").textContent = money(broker.cash);
    $("#pos-count").textContent = nPos;
    const pnlEl = $("#pnl");
    pnlEl.textContent = (pnl >= 0 ? "+" : "") + money(pnl);
    pnlEl.style.color = pnl > 0.01 ? "var(--green)" : pnl < -0.01 ? "var(--red)" : "var(--text)";
}

function renderPositions() {
    const el = $("#positions");
    const pos = broker.positions;
    const keys = Object.keys(pos).sort((a, b) => {
        const pa = pos[a], pb = pos[b];
        const priceA = state.prices[a] || pa.entry, priceB = state.prices[b] || pb.entry;
        const pnlA = pa.side === "long" ? (priceA - pa.entry) * pa.qty : (pa.entry - priceA) * pa.qty;
        const pnlB = pb.side === "long" ? (priceB - pb.entry) * pb.qty : (pb.entry - priceB) * pb.qty;
        return pnlB - pnlA;                     // biggest gainers first
    });
    if (!keys.length) { el.textContent = "keine offenen Positionen"; return; }
    el.innerHTML = keys.map((k) => {
        const p = pos[k];
        const price = state.prices[k] || p.entry;
        const invested = p.qty * p.entry;
        const currentValue = p.qty * price;
        const upnl = p.side === "long" ? (price - p.entry) * p.qty : (p.entry - price) * p.qty;
        const pnlPct = p.side === "long" ? ((price / p.entry - 1) * 100) : ((p.entry / price - 1) * 100);
        const pnlColor = upnl >= 0 ? "var(--green)" : "var(--red)";
        const r = p.original_stop ? Math.abs(p.entry - p.original_stop) : 0;
        const rMultiple = r > 0 ? (upnl / (r * p.qty)) : 0;
        const nextTp = p.take_profits?.[0]?.price;
        // Erwarteter Gewinn: aus verbleibenden Take-Profits + Rest-Position "Full Run"
        let expectedWeighted = 0, maxProfit = 0, lossAtStop = 0;
        for (const tp of (p.take_profits || [])) {
            const win = p.side === "long" ? (tp.price - p.entry) * tp.qty : (p.entry - tp.price) * tp.qty;
            expectedWeighted += win;
            maxProfit += win;
        }
        // Assume 50% chance of hitting first TP block, 30% mid, 20% final
        if (p.stop) {
            lossAtStop = p.side === "long"
                ? (p.entry - p.stop) * p.qty
                : (p.stop - p.entry) * p.qty;
        }
        const ev = expectedWeighted * 0.5 - lossAtStop * 0.5;   // simple 50/50 EV
        const forecastClass = expectedWeighted >= 0 ? "pos" : "neg";
        return `
            <div class="pos-card">
                <div class="pos-head">
                    <div class="pos-sym">
                        <span class="pos-symbol">${p.symbol}</span>
                        <span class="side-badge side-${p.side}">${p.side.toUpperCase()}</span>
                    </div>
                    <div class="pos-pnl" style="color:${pnlColor}">
                        <div class="pnl-usd">${upnl >= 0 ? "+" : ""}${fmt(upnl, 2)} USDT</div>
                        <div class="pnl-pct">${pnlPct >= 0 ? "+" : ""}${fmt(pnlPct, 2)}% · ${rMultiple >= 0 ? "+" : ""}${fmt(rMultiple, 2)}R</div>
                    </div>
                </div>
                <div class="pos-grid">
                    <div><div class="k">Investiert</div><div class="v num">${fmt(invested, 2)}</div></div>
                    <div><div class="k">Aktueller Wert</div><div class="v num">${fmt(currentValue, 2)}</div></div>
                    <div><div class="k">Menge</div><div class="v num">${fmt(p.qty, 6)}</div></div>
                    <div><div class="k">Entry</div><div class="v num">${fmt(p.entry, 4)}</div></div>
                    <div><div class="k">Live</div><div class="v num">${fmt(price, 4)}</div></div>
                    <div><div class="k">Stop-Loss</div><div class="v num" style="color:var(--red)">${fmt(p.stop, 4)}</div></div>
                    ${nextTp ? `<div><div class="k">Nächster TP</div><div class="v num" style="color:var(--green)">${fmt(nextTp, 4)}</div></div>` : ""}
                    ${p.trailing_moves ? `<div><div class="k">Stop nachgezogen</div><div class="v num">${p.trailing_moves}×</div></div>` : ""}
                </div>
                <div class="pos-forecast">
                    <div><div class="k">Erwarteter Gewinn (TPs)</div><div class="v ${forecastClass}">+${fmt(expectedWeighted, 2)} USDT</div></div>
                    <div><div class="k">Bei vollem Run</div><div class="v pos">+${fmt(maxProfit, 2)} USDT</div></div>
                    <div><div class="k">Bei Stop-Loss</div><div class="v neg">-${fmt(Math.abs(lossAtStop), 2)} USDT</div></div>
                    <div><div class="k">Erwartungswert (50/50)</div><div class="v ${ev >= 0 ? "pos" : "neg"}">${ev >= 0 ? "+" : "-"}${fmt(Math.abs(ev), 2)} USDT</div></div>
                </div>
                <div class="btn-row" style="margin-top:8px;">
                    <button class="ghost pos-partial" data-sym="${k}" style="flex:1; font-size:0.75rem; padding:6px 8px;">Teilweise schliessen</button>
                    <button class="ghost pos-close" data-sym="${k}" style="flex:1; font-size:0.75rem; padding:6px 8px;">Voll schliessen</button>
                </div>
            </div>`;
    }).join("");
    el.querySelectorAll(".pos-close").forEach((btn) => {
        btn.onclick = () => {
            const sym = btn.dataset.sym;
            const p = pos[sym];
            if (!p) return;
            if (!confirm(`Position ${sym} jetzt zum Marktpreis vollständig schliessen?`)) return;
            const price = state.prices[sym] || p.entry;
            const r = broker.close(sym, price, 1);
            if (r) announce(`Position ${sym.replace("/", " gegen ")} manuell geschlossen. ${r.pnl >= 0 ? "Gewinn" : "Verlust"} ${Math.abs(r.pnl).toFixed(2)} Dollar.`, r.pnl >= 0 ? "success" : "warn");
            renderAll();
        };
    });
    el.querySelectorAll(".pos-partial").forEach((btn) => {
        btn.onclick = () => openPartialCloseModal(btn.dataset.sym);
    });
}

function renderMatrix() {
    const el = $("#matrix");
    const tfs = ["15m", "1h", "4h", "1d"];
    let up = 0, down = 0, flat = 0;
    const rows = CFG.symbols.map((sym) => {
        const cells = tfs.map((tf) => {
            const dir = state.tfDir?.[`${sym}_${tf}`] || "flat";
            if (dir === "up") up++;
            else if (dir === "down") down++;
            else flat++;
            return `<td><span class="dot ${dir}"></span></td>`;
        }).join("");
        return `<tr><td>${sym}</td>${cells}</tr>`;
    }).join("");
    el.innerHTML = `
        <table class="matrix-table">
            <thead><tr><th>Symbol</th>${tfs.map((t) => `<th>${t}</th>`).join("")}</tr></thead>
            <tbody>${rows}</tbody>
        </table>
        <div class="matrix-summary">
            <span class="legend">
                <span><span class="dot up"></span> Aufwärts</span>
                <span><span class="dot down"></span> Abwärts</span>
                <span><span class="dot"></span> Neutral</span>
            </span>
            <span>${up} up · ${down} down · ${flat} flat</span>
        </div>`;
}

function renderSignalsLog() {
    const el = $("#signals");
    const scans = state.lastScan || [];
    if (!scans.length) { el.textContent = "noch kein Scan"; return; }
    el.innerHTML = scans.map((s) => {
        const cls = s.side === "long" ? "side-long" : s.side === "short" ? "side-short" : "side-flat";
        const side = s.side ? s.side.toUpperCase() : "FLAT";
        return `<div class="sig-row">
            <span>${s.symbol}<br><small>${(s.signals || []).map((x) => x.strategy).join(", ") || "-"}</small></span>
            <span class="${cls}">${side}</span>
            <span class="num">${fmt(s.score, 2)}</span>
        </div>`;
    }).join("");
}

// -------- professional trade journal --------
const journalState = {
    view: localStorage.getItem("tb_journal_view") || "month",
    date: localStorage.getItem("tb_journal_date") || new Date().toISOString().slice(0, 10),
};

function _pairTrades() {
    // pair open + close entries to build a list of round-trips
    const opens = {};
    const trades = [];
    for (const e of broker.journal) {
        if (e.kind === "open") {
            opens[e.symbol] = opens[e.symbol] || [];
            opens[e.symbol].push({ ...e });
        } else if (e.kind === "close") {
            const stack = opens[e.symbol] || [];
            const openEntry = stack.shift();
            trades.push({
                symbol: e.symbol,
                side: openEntry?.side || e.side,
                open_ts: openEntry?.ts,
                close_ts: e.ts,
                open_price: openEntry?.price || 0,
                close_price: e.price,
                qty: e.qty,
                pnl: e.pnl || 0,
                strategy: openEntry?.strategy || "",
                holding_ms: openEntry ? new Date(e.ts) - new Date(openEntry.ts) : 0,
            });
        }
    }
    return trades;
}

function _inRange(ts, view, dateStr) {
    if (view === "all") return true;
    const t = new Date(ts);
    const d = new Date(dateStr);
    if (view === "day") return t.toDateString() === d.toDateString();
    if (view === "month") return t.getFullYear() === d.getFullYear() && t.getMonth() === d.getMonth();
    if (view === "year") return t.getFullYear() === d.getFullYear();
    return true;
}

function _formatDuration(ms) {
    if (!ms || ms < 0) return "–";
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h ${m % 60} min`;
    return `${Math.floor(h / 24)} T ${h % 24} h`;
}

function renderJournal() {
    const trades = _pairTrades().filter((t) => _inRange(t.close_ts, journalState.view, journalState.date));
    trades.sort((a, b) => new Date(b.close_ts) - new Date(a.close_ts));

    // summary
    const wins = trades.filter((t) => t.pnl > 0);
    const losses = trades.filter((t) => t.pnl < 0);
    const pnl = trades.reduce((s, t) => s + t.pnl, 0);
    const gross_profit = wins.reduce((s, t) => s + t.pnl, 0);
    const gross_loss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const winRate = trades.length ? (wins.length / trades.length * 100) : 0;
    const pf = gross_loss > 0 ? gross_profit / gross_loss : (wins.length ? Infinity : 0);
    const best = trades.reduce((b, t) => t.pnl > (b?.pnl || -Infinity) ? t : b, null);
    const worst = trades.reduce((b, t) => t.pnl < (b?.pnl || Infinity) ? t : b, null);

    const pnlClass = pnl > 0.01 ? "pos" : pnl < -0.01 ? "neg" : "";
    const bestStr = best ? `${best.pnl > 0 ? "+" : ""}${fmt(best.pnl, 2)}` : "–";
    const worstStr = worst ? `${worst.pnl >= 0 ? "+" : ""}${fmt(worst.pnl, 2)}` : "–";

    $("#journal-summary").innerHTML = `
        <div class="js-tile"><div class="k">Trades</div><div class="v">${trades.length}</div></div>
        <div class="js-tile"><div class="k">Win-Rate</div><div class="v">${fmt(winRate, 1)}%</div></div>
        <div class="js-tile"><div class="k">Netto-PnL</div><div class="v ${pnlClass}">${pnl >= 0 ? "+" : ""}${fmt(pnl, 2)}</div></div>
        <div class="js-tile"><div class="k">Bruttogewinn</div><div class="v pos">+${fmt(gross_profit, 2)}</div></div>
        <div class="js-tile"><div class="k">Bruttoverlust</div><div class="v neg">-${fmt(gross_loss, 2)}</div></div>
        <div class="js-tile"><div class="k">Profit-Faktor</div><div class="v">${isFinite(pf) ? fmt(pf, 2) : "∞"}</div></div>
        <div class="js-tile"><div class="k">Bester Trade</div><div class="v pos">${bestStr}</div></div>
        <div class="js-tile"><div class="k">Schlechtester</div><div class="v neg">${worstStr}</div></div>`;

    // table
    if (!trades.length) {
        $("#journal-table").innerHTML = `<tbody><tr><td class="journal-empty">Keine Trades im gewählten Zeitraum</td></tr></tbody>`;
        return;
    }
    const header = `<thead><tr>
        <th>Datum</th><th>Symbol</th><th>Richtung</th><th>Einstieg</th>
        <th>Ausstieg</th><th>Menge</th><th>Haltedauer</th>
        <th>PnL (USDT)</th><th>Strategie</th>
    </tr></thead>`;
    const rows = trades.map((t) => {
        const d = new Date(t.close_ts).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
        const tm = new Date(t.close_ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
        const pnlCls = t.pnl > 0 ? "pnl-pos" : t.pnl < 0 ? "pnl-neg" : "";
        return `<tr>
            <td>${d}<br><small style="color:var(--muted)">${tm}</small></td>
            <td>${t.symbol}</td>
            <td class="side-${t.side}">${t.side.toUpperCase()}</td>
            <td class="num">${fmt(t.open_price, 4)}</td>
            <td class="num">${fmt(t.close_price, 4)}</td>
            <td class="num">${fmt(t.qty, 6)}</td>
            <td>${_formatDuration(t.holding_ms)}</td>
            <td class="num ${pnlCls}">${t.pnl >= 0 ? "+" : ""}${fmt(t.pnl, 2)}</td>
            <td><small>${t.strategy.split(",").slice(0, 2).join(", ") || "–"}</small></td>
        </tr>`;
    }).join("");
    $("#journal-table").innerHTML = header + `<tbody>${rows}</tbody>`;
}

function exportJournalCsv() {
    const trades = _pairTrades().filter((t) => _inRange(t.close_ts, journalState.view, journalState.date));
    trades.sort((a, b) => new Date(a.close_ts) - new Date(b.close_ts));
    const header = ["Datum Ausstieg","Datum Einstieg","Symbol","Richtung","Einstiegspreis","Ausstiegspreis","Menge","Haltedauer (min)","PnL (USDT)","Strategie"];
    const csv = [header.join(";")].concat(trades.map((t) => [
        new Date(t.close_ts).toLocaleString("de-DE"),
        t.open_ts ? new Date(t.open_ts).toLocaleString("de-DE") : "",
        t.symbol, t.side, t.open_price.toFixed(6),
        t.close_price.toFixed(6), t.qty.toFixed(8),
        Math.round(t.holding_ms / 60000), t.pnl.toFixed(2),
        (t.strategy || "").replace(/;/g, ",")
    ].join(";"))).join("\n");
    const bom = "﻿";
    const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `handelsjournal_${journalState.view}_${journalState.date}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

function renderStrategies() {
    $("#strategies").innerHTML = window.TB.STRATEGIES.map((s) =>
        `<span class="chip">${s.name.replace(/_/g, " ")}</span>`).join("");
    $("#strat-count").textContent = window.TB.STRATEGIES.length + " aktiv";
}

function renderFng() {
    const el = $("#fng-value");
    if (!state.fng) return;
    const v = state.fng.value;
    // rebuild inner content while keeping needle
    el.innerHTML = v + '<div class="fng-needle" id="fng-needle"></div>';
    const needle = $("#fng-needle");
    // 0 → -135°, 100 → +135° (270° span across the arc)
    const angle = -135 + (v / 100) * 270;
    if (needle) needle.style.transform = `translate(-50%, -90%) rotate(${angle}deg)`;
    $("#fng-class").textContent = state.fng.label;
    const color = v <= 24 ? "var(--red)" : v <= 44 ? "var(--amber)"
        : v >= 75 ? "var(--red)" : v >= 55 ? "var(--green)" : "var(--muted)";
    el.style.color = color;
}

function updateModePill() {
    const pill = $("#mode-pill");
    pill.classList.toggle("on", state.autoMode);
    pill.querySelector("span:last-child").textContent = state.autoMode ? "Auto" : "Manuell";
    $("#mode-toggle").classList.toggle("on", state.autoMode);
    $("#mode-label").innerHTML = `<strong>${state.autoMode ? "Vollautomatik (Demo)" : "Manuell (Demo)"}</strong> · ${state.autoMode ? "Signale werden automatisch ausgeführt" : "Signale bestätigen"}`;
}

function loadTv(symbol) {
    const clean = symbol.replace("/", "");
    $("#tv-iframe").src = `https://s.tradingview.com/widgetembed/?symbol=BINANCE:${clean}&interval=15&theme=dark&style=1&locale=en&hide_side_toolbar=1`;
}

function renderTvSelect() {
    $("#tv-symbols").innerHTML = ["BTC/USDT", "ETH/USDT", "SOL/USDT"].map((s) =>
        `<button data-sym="${s}">${s}</button>`).join("");
    $("#tv-symbols").querySelectorAll("button").forEach((b) => {
        b.onclick = () => loadTv(b.dataset.sym);
    });
    loadTv("BTC/USDT");
}

// =========== signal handling ============================================
function confirmPending(p) {
    broker.submit(p.symbol, p.side, p.size, p.entry, {
        stop: p.stop, take_profits: p.take_profits, strategy: p.strategy,
    });
    state.pending = state.pending.filter((x) => x.symbol !== p.symbol);
    state.tradeCount++;
    announce(`Trade ausgeführt. ${p.symbol} ${p.side === "long" ? "gekauft" : "verkauft"} bei ${p.entry.toFixed(2)}. Stop bei ${p.stop.toFixed(2)}.`, "success");
    renderAll();
}

function cancelPending(p) {
    state.pending = state.pending.filter((x) => x.symbol !== p.symbol);
    announce("Signal verworfen.");
    renderAll();
}

// Kelly Criterion — computes optimal fraction from historical trades
// Returns { edge, kelly, halfKelly } or null if insufficient data
function computeKelly() {
    const trades = _pairTrades();
    if (trades.length < 20) return null;
    const wins = trades.filter((t) => t.pnl > 0);
    const losses = trades.filter((t) => t.pnl < 0);
    if (!wins.length || !losses.length) return null;
    const winRate = wins.length / trades.length;
    const avgWin = wins.reduce((s, t) => s + t.pnl, 0) / wins.length;
    const avgLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length);
    if (avgLoss <= 0) return null;
    const R = avgWin / avgLoss;                                    // reward:risk
    const kelly = (winRate * (R + 1) - 1) / R;                     // classic Kelly
    return {
        winRate, avgWin, avgLoss, R,
        edge: winRate * avgWin - (1 - winRate) * avgLoss,
        kelly,
        halfKelly: Math.max(0, kelly * 0.5),                        // safety-halved
    };
}

function dynamicRiskPct(score, riskScore) {
    // Prefer Kelly-based sizing if we have enough historical trades
    const k = computeKelly();
    if (k && k.kelly > 0) {
        // half-Kelly in percent, capped
        const kellyPct = Math.max(CFG.baseRiskPct * 0.5,
                          Math.min(CFG.maxRiskPct, k.halfKelly * 100));
        // score boost still applies on top (multiplicative)
        const boost = 0.5 + Math.max(0, Math.min(1, (score - 2.0) / 3.0)) * 0.5;
        return Math.max(CFG.baseRiskPct * 0.5,
                Math.min(CFG.maxRiskPct, kellyPct * boost));
    }
    // Fallback: score-based scaling from before Kelly has enough data
    const scoreBoost = Math.min(Math.max((score - 2.0) / 3.0, 0), 1);
    const riskDampen = 1 - Math.min(riskScore / 100, 0.7);
    const pct = CFG.baseRiskPct + (CFG.maxRiskPct - CFG.baseRiskPct) * scoreBoost * riskDampen;
    return Math.max(CFG.baseRiskPct * 0.5, Math.min(CFG.maxRiskPct, pct));
}

// ============ VaR + Expected Shortfall ============
// Compute per-position and portfolio 1-day 95% VaR + ES from realized vol
function computePortfolioRisk() {
    const positions = broker.positions;
    let totalVaR = 0, totalES = 0;
    const perPos = [];
    for (const sym in positions) {
        const p = positions[sym];
        const candles = state.candles[sym];
        if (!candles || candles.length < 30) continue;
        const price = state.prices[sym] || p.entry;
        const value = p.side === "long" ? p.qty * price : -p.qty * price;
        // Compute daily volatility from log returns (last 30 bars scaled to 1d)
        const closes = window.TB.closes(candles).slice(-96);          // ~24h at 15m
        if (closes.length < 20) continue;
        const rets = [];
        for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
        const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
        const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length;
        const dailyVol = Math.sqrt(variance) * Math.sqrt(96);         // 96 bars = 1 day at 15m
        const abs = Math.abs(value);
        const var95 = 1.645 * abs * dailyVol;                          // 95% parametric VaR (1-day)
        const es95 = 2.063 * abs * dailyVol;                           // 95% Expected Shortfall
        totalVaR += var95;
        totalES += es95;
        perPos.push({ symbol: sym, value: abs, dailyVol, var95, es95 });
    }
    return { totalVaR, totalES, perPos };
}

// ============ CUSUM structural break on equity returns ============
// Detects sudden performance regime shifts. Trigger: cumulative sum of
// (return - mean) exceeds K * historical stddev in negative direction.
function structuralBreakDetection() {
    const hist = state.equityHistory;
    if (hist.length < 40) return null;
    const rets = [];
    for (let i = 1; i < hist.length; i++) {
        const r = (hist[i].eq - hist[i - 1].eq) / (hist[i - 1].eq || 1);
        if (isFinite(r)) rets.push(r);
    }
    if (rets.length < 30) return null;
    // Baseline from first half, monitor second half
    const half = Math.floor(rets.length / 2);
    const baseline = rets.slice(0, half);
    const monitor = rets.slice(half);
    const mean = baseline.reduce((s, r) => s + r, 0) / baseline.length;
    const std = Math.sqrt(baseline.reduce((s, r) => s + (r - mean) ** 2, 0) / baseline.length) || 1e-9;
    let cusum_pos = 0, cusum_neg = 0;
    const K = 0.5 * std;                    // reference value
    const H = 5 * std;                      // decision threshold
    let breakDetected = false;
    for (const r of monitor) {
        cusum_pos = Math.max(0, cusum_pos + (r - mean) - K);
        cusum_neg = Math.min(0, cusum_neg + (r - mean) + K);
        if (cusum_pos > H || Math.abs(cusum_neg) > H) breakDetected = true;
    }
    return {
        breakDetected,
        cusum_pos, cusum_neg,
        baseline_mean: mean, baseline_std: std,
        current_mean: monitor.reduce((s, r) => s + r, 0) / monitor.length,
    };
}

// ============ Composite F&G from Binance data ============
async function computeBinanceCompositeFng() {
    try {
        const btcCandles = state.candles["BTC/USDT"];
        if (!btcCandles || btcCandles.length < 100) return null;
        const closes = window.TB.closes(btcCandles);
        // 1. RSI 14 on BTC → high RSI = greed
        const rsi = window.TB.rsi(closes, 14);
        const rsiVal = rsi[rsi.length - 1];
        const rsiScore = Math.max(0, Math.min(100, rsiVal || 50));
        // 2. Volatility → high vol = fear
        const highs = window.TB.highs(btcCandles), lows = window.TB.lows(btcCandles);
        const atr = window.TB.atr(highs, lows, closes, 14);
        const atrPct = atr[atr.length - 1] / closes[closes.length - 1] * 100;
        // ATR% > 2 = fear (score 0), ATR% < 0.5 = greed (score 100)
        const volScore = Math.max(0, Math.min(100, (2.0 - atrPct) / 1.5 * 100));
        // 3. Drawdown from recent high (100 bars)
        const hh = Math.max(...closes.slice(-100));
        const dd = (hh - closes[closes.length - 1]) / hh * 100;
        // dd > 20% = extreme fear, dd < 1% = greed
        const ddScore = Math.max(0, Math.min(100, (20 - dd) / 19 * 100));
        // 4. Funding rate from futures data
        let fundingScore = 50;
        const futures = state.futuresData?.find?.((f) => f.symbol === "BTC/USDT");
        if (futures?.funding != null) {
            // funding > 0.05% = greed, < -0.05% = fear
            fundingScore = Math.max(0, Math.min(100, 50 + futures.funding * 500));
        }
        // 5. Long/Short ratio
        let lsScore = 50;
        if (futures?.longShort != null) {
            // L/S > 3 = crowded long = greed, < 0.7 = crowded short = fear
            lsScore = Math.max(0, Math.min(100, (futures.longShort - 1) * 25 + 50));
        }
        // Weighted composite
        const composite = Math.round(
            rsiScore * 0.30 + volScore * 0.20 + ddScore * 0.20 +
            fundingScore * 0.15 + lsScore * 0.15
        );
        const label = composite <= 20 ? "Extreme Angst" : composite <= 40 ? "Angst"
                    : composite >= 80 ? "Extreme Gier" : composite >= 60 ? "Gier" : "Neutral";
        return {
            value: composite, label,
            components: { rsi: Math.round(rsiScore), vol: Math.round(volScore),
                          dd: Math.round(ddScore), funding: Math.round(fundingScore),
                          longShort: Math.round(lsScore) },
        };
    } catch (e) { return null; }
}

function correlationOf(symbolA, symbolB) {
    const a = state.candles[symbolA], b = state.candles[symbolB];
    if (!a || !b || a.length < 50 || b.length < 50) return 0;
    const ra = [], rb = [];
    const n = Math.min(50, a.length - 1, b.length - 1);
    for (let i = a.length - n; i < a.length; i++) ra.push((a[i].close / a[i - 1].close) - 1);
    for (let i = b.length - n; i < b.length; i++) rb.push((b[i].close / b[i - 1].close) - 1);
    const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const ma = mean(ra), mb = mean(rb);
    let num = 0, sa2 = 0, sb2 = 0;
    for (let i = 0; i < ra.length; i++) {
        num += (ra[i] - ma) * (rb[i] - mb);
        sa2 += (ra[i] - ma) ** 2;
        sb2 += (rb[i] - mb) ** 2;
    }
    const denom = Math.sqrt(sa2 * sb2);
    return denom ? num / denom : 0;
}

function makePending(symbol, sig, candles, price) {
    if (broker.positions[symbol]) return null;
    if (Object.keys(broker.positions).length >= CFG.maxOpenPositions) return null;
    const atrValues = window.TB.atr(window.TB.highs(candles), window.TB.lows(candles), window.TB.closes(candles), 14);
    const atrVal = atrValues[atrValues.length - 1];
    if (!atrVal || isNaN(atrVal)) return null;
    const equity = broker.equity(state.prices);
    // pre-compute risk to size dynamically
    const provisionalPlan = window.TB.planTrade(sig.side, price, atrVal, equity, CFG);
    if (!provisionalPlan) return null;
    const risk = window.TB.assessRisk(provisionalPlan, candles, broker.positions, equity);
    const dynRiskPct = dynamicRiskPct(sig.score, risk.score);
    const plan = window.TB.planTrade(sig.side, price, atrVal, equity,
        { ...CFG, riskPctPerTrade: dynRiskPct });
    if (!plan || plan.size <= 0) return null;
    const forecast = window.TB.forecast(plan);
    // correlation warnings
    const highCorr = [];
    for (const openSym of Object.keys(broker.positions)) {
        const c = correlationOf(symbol, openSym);
        if (Math.abs(c) >= CFG.correlationWarnThreshold) highCorr.push({ sym: openSym, corr: c });
    }
    return {
        id: symbol + "_" + Date.now(),
        symbol, ...plan,
        score: sig.score,
        signals: sig.signals,
        reasons: sig.signals.map((s) => `${s.strategy}: ${s.reason}`),
        strategy: sig.signals.map((s) => s.strategy).join(","),
        forecast, risk, dynRiskPct, highCorr,
        newsForSymbol: filterNewsForSymbol(symbol),
    };
}

function passesStrictFilter(pending) {
    return pending.score >= CFG.strictMinScore
        && pending.signals.length >= CFG.strictAgreement
        && pending.risk.score <= CFG.strictMaxRisk;
}

// =========== main scan loop ============================================
function dirFromCandles(candles) {
    const closes = window.TB.closes(candles);
    if (closes.length < 210) return "flat";
    const macd = window.TB.macd(closes);
    const e20 = window.TB.ema(closes, 20);
    const e50 = window.TB.ema(closes, 50);
    const rsi = window.TB.rsi(closes, 14);
    const i = closes.length - 1;
    const votes = [
        e20[i] > e50[i] ? 1 : -1,
        macd.hist[i] > 0 ? 1 : -1,
        rsi[i] > 50 ? 1 : -1,
    ].reduce((s, x) => s + x, 0);
    return votes >= 2 ? "up" : votes <= -2 ? "down" : "flat";
}

async function refreshMatrix(symbol, primaryCandles) {
    state.tfDir = state.tfDir || {};
    state.tfDir[`${symbol}_${CFG.primaryTf}`] = dirFromCandles(primaryCandles);
    const tfs = ["1h", "4h", "1d"].filter((t) => t !== CFG.primaryTf);
    await Promise.all(tfs.map(async (tf) => {
        try {
            const c = await window.TB.fetchKlines(symbol, tf, 250);
            state.tfDir[`${symbol}_${tf}`] = dirFromCandles(c);
        } catch (e) { /* keep previous */ }
    }));
}

async function scanSymbol(symbol) {
    try {
        const candles = await window.TB.fetchKlines(symbol, CFG.primaryTf, 500);
        state.candles[symbol] = candles;
        state.prices[symbol] = candles[candles.length - 1].close;
        refreshMatrix(symbol, candles);
        const price = state.prices[symbol];

        // handle open positions (stop/tp)
        const events = broker.onPrice(symbol, price);
        for (const ev of events) {
            if (ev.kind === "trail") {
                announce(`Trailing-Stop nachgezogen bei ${symbol.replace("/", " gegen ")} auf ${ev.newStop.toFixed(2)}. Gewinn abgesichert.`, "info");
                continue;
            }
            const verb = ev.kind === "sl" ? "Stop-Loss ausgelöst" : "Take-Profit erreicht";
            const level = ev.pnl >= 0 ? "success" : "warn";
            announce(`${verb} bei ${symbol.replace("/", " gegen ")}. ${ev.pnl >= 0 ? "Gewinn" : "Verlust"} ${Math.abs(ev.pnl).toFixed(2)} Dollar.`, level);
        }

        // ensemble
        const result = window.TB.ensemble(candles, CFG.softMinScore, CFG.softAgreement, state.adaptiveWeights);
        return { symbol, ...result, price };
    } catch (e) {
        return { symbol, error: e.message };
    }
}

async function scanAll() {
    state.scanCount++;
    pushEquityPoint();
    if (state.halted) {
        // still refresh prices to keep charts alive
        const results = await Promise.all(CFG.symbols.map(scanSymbol));
        state.lastScan = results;
        renderAll();
        return;
    }
    const results = await Promise.all(CFG.symbols.map(scanSymbol));
    state.lastScan = results;

    // consider signals
    for (const r of results) {
        if (!r.side) continue;
        // Skip if already pending or a position is open
        if (state.pending.find((p) => p.symbol === r.symbol)) continue;
        if (broker.positions[r.symbol]) continue;

        const pending = makePending(r.symbol, r, state.candles[r.symbol], r.price);
        if (!pending) continue;
        if (pending.risk.score > CFG.softMaxRisk) continue;

        state.pending.push(pending);

        if (state.autoMode && passesStrictFilter(pending)) {
            // Vollautomatik: nur wirklich hochkarätige Setups
            confirmPending(pending);
            announce(
                `Automatisch ausgeführt. ${pending.symbol} ${pending.side === "long" ? "gekauft" : "verkauft"} bei ${pending.entry.toFixed(2)} Dollar. ` +
                `Stop bei ${pending.stop.toFixed(2)}. Prognose plus ${pending.forecast.weighted.toFixed(0)} Dollar.`,
                "alert",
            );
        } else {
            announce(
                `Neues ${pending.side === "long" ? "Kauf" : "Verkauf"}signal für ${pending.symbol.replace("/", " gegen ")} bei ${pending.entry.toFixed(2)}. ` +
                `Risiko ${pending.risk.label}. Prognose plus ${pending.forecast.weighted.toFixed(0)} Dollar.`,
                "alert",
            );
        }
        break; // handle one at a time to avoid spamming
    }

    renderAll();
}

async function refreshPrices() {
    const results = await Promise.allSettled(CFG.symbols.map(async (s) => {
        try {
            state.prices[s] = await window.TB.fetchPrice(s);
            const events = broker.onPrice(s, state.prices[s]);
            for (const ev of events) {
                if (ev.kind === "trail") {
                    announce(`Trailing-Stop nachgezogen bei ${s.replace("/", " gegen ")} auf ${ev.newStop.toFixed(2)}. Gewinn abgesichert.`, "info");
                    continue;
                }
                const verb = ev.kind === "sl" ? "Stop-Loss ausgelöst" : "Take-Profit erreicht";
                const level = ev.pnl >= 0 ? "success" : "warn";
                announce(`${verb} bei ${s.replace("/", " gegen ")}. ${ev.pnl >= 0 ? "Gewinn" : "Verlust"} ${Math.abs(ev.pnl).toFixed(2)} Dollar.`, level);
            }
        } catch (e) { /* silent */ }
    }));
    renderPortfolio();
    renderPositions();
}

async function refreshFng() {
    const d = await window.TB.fetchFearGreed();
    if (d) { state.fng = d; renderFng(); }
}

// ============ NEW: equity curve tracking ============
function pushEquityPoint() {
    const eq = broker.equity(state.prices);
    state.equityHistory.push({ ts: Date.now(), eq });
    if (state.equityHistory.length > 500) state.equityHistory = state.equityHistory.slice(-500);
    if (eq > state.peakEquity) {
        state.peakEquity = eq;
        localStorage.setItem("tb_peak_equity", String(eq));
    }
    localStorage.setItem("tb_equity_hist", JSON.stringify(state.equityHistory));
}

function renderEquityChart() {
    const svg = $("#equity-chart");
    if (!svg) return;
    const hist = state.equityHistory;
    const start = broker.startingBalance || 10000;
    const points = hist.length ? hist.slice(-120) : [{ ts: Date.now(), eq: start }];
    const vals = points.map((p) => p.eq);
    const min = Math.min(start, ...vals) * 0.995;
    const max = Math.max(start, ...vals) * 1.005;
    const w = 400, h = 100;
    const xStep = w / Math.max(points.length - 1, 1);
    const y = (v) => h - ((v - min) / (max - min)) * h;
    const line = points.map((p, i) => `${i * xStep},${y(p.eq).toFixed(1)}`).join(" ");
    const area = `M0,${h} L${line.split(" ").join(" L")} L${w},${h} Z`;
    const startY = y(start).toFixed(1);
    svg.innerHTML = `
        <defs><linearGradient id="eq-gradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#4d94ff" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="#4d94ff" stop-opacity="0"/>
        </linearGradient></defs>
        <line class="start-line" x1="0" y1="${startY}" x2="${w}" y2="${startY}"/>
        <path class="area" d="${area}"/>
        <polyline class="line" points="${line}"/>`;
}

// ============ NEW: kill switch ============
function checkKillSwitch() {
    const today = new Date().toDateString();
    if (state.dayStartDate !== today) {
        state.dayStartDate = today;
        state.dayStartEquity = broker.equity(state.prices);
        state.halted = false;
        localStorage.setItem("tb_day_date", today);
        localStorage.setItem("tb_day_equity", String(state.dayStartEquity));
        localStorage.setItem("tb_halted", "0");
    }
    const eq = broker.equity(state.prices);
    const dailyLoss = (state.dayStartEquity - eq) / state.dayStartEquity * 100;
    const drawdown = (state.peakEquity - eq) / state.peakEquity * 100;
    if (dailyLoss >= CFG.maxDailyLossPct || drawdown >= CFG.maxDrawdownPct) {
        if (!state.halted) {
            state.halted = true;
            localStorage.setItem("tb_halted", "1");
            const reason = dailyLoss >= CFG.maxDailyLossPct ? "Tages-Verlust-Limit" : "Max-Drawdown";
            announce(`Kill-Switch ausgelöst wegen ${reason}. Bot pausiert bis morgen.`, "alert");
        }
    }
    return { eq, dailyLoss, drawdown };
}

function renderKillSwitch() {
    const el = $("#killswitch");
    const s = checkKillSwitch();
    const nOpen = Object.keys(broker.positions).length;
    const barCls = (val, limit) => val >= limit ? "crit" : val >= limit * 0.6 ? "warn" : "ok";
    const barPct = (val, limit) => Math.min(100, val / limit * 100);
    const dlCls = barCls(Math.max(s.dailyLoss, 0), CFG.maxDailyLossPct);
    const ddCls = barCls(Math.max(s.drawdown, 0), CFG.maxDrawdownPct);
    const posCls = barCls(nOpen, CFG.maxOpenPositions);
    el.innerHTML = `
        <div class="ks-row"><span class="ks-label">Tages-PnL</span><span class="ks-value ${dlCls}">${s.dailyLoss <= 0 ? "+" : "-"}${Math.abs(s.dailyLoss).toFixed(2)}% ${s.dailyLoss > 0 ? "/ max Verlust " + CFG.maxDailyLossPct + "%" : ""}</span>
          <div class="ks-bar-bg"><div class="ks-bar-fill risk-color-${dlCls === "crit" ? "red" : dlCls === "warn" ? "yellow" : "green"}" style="width:${barPct(Math.max(s.dailyLoss, 0), CFG.maxDailyLossPct)}%"></div></div></div>
        <div class="ks-row"><span class="ks-label">Drawdown von Peak</span><span class="ks-value ${ddCls}">-${Math.max(s.drawdown, 0).toFixed(2)}% / max ${CFG.maxDrawdownPct}%</span>
          <div class="ks-bar-bg"><div class="ks-bar-fill risk-color-${ddCls === "crit" ? "red" : ddCls === "warn" ? "yellow" : "green"}" style="width:${barPct(Math.max(s.drawdown, 0), CFG.maxDrawdownPct)}%"></div></div></div>
        <div class="ks-row"><span class="ks-label">Offene Positionen</span><span class="ks-value ${posCls}">${nOpen} / ${CFG.maxOpenPositions}</span>
          <div class="ks-bar-bg"><div class="ks-bar-fill risk-color-${posCls === "crit" ? "red" : posCls === "warn" ? "yellow" : "green"}" style="width:${barPct(nOpen, CFG.maxOpenPositions)}%"></div></div></div>
        ${state.halted ? `<div class="ks-halted-banner">
            ⚠ Bot pausiert · Kill-Switch ausgelöst
            <div style="margin-top:8px; display:flex; gap:6px;">
                <button id="ks-resume" class="ghost" style="flex:1; color:var(--amber); border-color:var(--amber); font-size:0.75rem; padding:6px;">Kill-Switch entschärfen (weiter handeln)</button>
                <button id="ks-full-reset" class="ghost" style="flex:1; color:var(--red); border-color:var(--red); font-size:0.75rem; padding:6px;">Komplett-Reset auf 10k</button>
            </div>
        </div>` : ""}`;
    // wire up recovery buttons after render
    setTimeout(() => {
        const resume = document.getElementById("ks-resume");
        if (resume) resume.onclick = () => {
            const eqNow = broker.equity(state.prices);
            state.halted = false;
            state.dayStartEquity = eqNow;
            state.dayStartDate = new Date().toDateString();
            // reset peak to current so drawdown-check doesn't immediately re-halt
            state.peakEquity = eqNow;
            localStorage.setItem("tb_halted", "0");
            localStorage.setItem("tb_day_equity", String(eqNow));
            localStorage.setItem("tb_day_date", state.dayStartDate);
            localStorage.setItem("tb_peak_equity", String(eqNow));
            announce("Kill-Switch entschärft. Bot handelt wieder. Peak und Tages-Referenz auf aktuelles Equity zurückgesetzt.", "info");
            renderAll();
        };
        const full = document.getElementById("ks-full-reset");
        if (full) full.onclick = () => $("#btn-reset").click();
    }, 0);
}

// ============ NEW: symbol picker ============
function renderSymbolPicker() {
    $("#sym-count").textContent = CFG.symbols.length;
    $("#sym-total").textContent = ALL_SYMBOLS.length;
    $("#symbol-picker").innerHTML = ALL_SYMBOLS.map((s) => {
        const active = CFG.symbols.includes(s);
        return `<button class="sym-chip ${active ? "on" : ""}" data-sym="${s}">${s.replace("/USDT", "")}</button>`;
    }).join("");
    $("#symbol-picker").querySelectorAll(".sym-chip").forEach((b) => {
        b.onclick = () => {
            const s = b.dataset.sym;
            if (CFG.symbols.includes(s)) {
                CFG.symbols = CFG.symbols.filter((x) => x !== s);
            } else {
                CFG.symbols.push(s);
            }
            localStorage.setItem("tb_symbols", JSON.stringify(CFG.symbols));
            renderSymbolPicker();
            renderWatchlistOptions();
            renderMatrix();
        };
    });
}

// ============ NEW: watchlist / price alerts ============
function renderWatchlistOptions() {
    const sel = $("#watch-symbol");
    if (!sel) return;
    sel.innerHTML = ALL_SYMBOLS.map((s) => `<option value="${s}">${s}</option>`).join("");
}

function renderWatchlist() {
    const el = $("#watchlist");
    if (!state.watchlist.length) { el.textContent = "keine Alarme gesetzt"; return; }
    el.innerHTML = state.watchlist.map((w, i) => {
        const live = state.prices[w.symbol];
        const dist = live ? ((w.price - live) / live * 100) : null;
        return `<div class="watch-row">
            <span><strong>${w.symbol}</strong> ${w.direction === "above" ? "▲ über" : "▼ unter"} <span class="num">${w.price}</span>
              <br><span class="live-price">${live ? `live ${live.toFixed(4)} (${dist > 0 ? "+" : ""}${dist.toFixed(2)}%)` : "–"}</span></span>
            <span class="status ${w.hit ? "hit" : "armed"}">${w.hit ? "✓ ausgelöst" : "scharf"}</span>
            <button class="watch-remove" data-i="${i}">✕</button>
        </div>`;
    }).join("");
    el.querySelectorAll(".watch-remove").forEach((b) => {
        b.onclick = () => {
            state.watchlist.splice(parseInt(b.dataset.i), 1);
            saveWatchlist();
            renderWatchlist();
        };
    });
}

function saveWatchlist() {
    localStorage.setItem("tb_watchlist", JSON.stringify(state.watchlist));
}

function checkWatchlist() {
    for (const w of state.watchlist) {
        if (w.hit) continue;
        const p = state.prices[w.symbol];
        if (!p) continue;
        const hit = (w.direction === "above" && p >= w.price) || (w.direction === "below" && p <= w.price);
        if (hit) {
            w.hit = true;
            w.hit_ts = new Date().toISOString();
            announce(`Preis-Alarm: ${w.symbol} ${w.direction === "above" ? "über" : "unter"} ${w.price}. Aktueller Kurs ${p.toFixed(4)}.`, "alert");
        }
    }
    saveWatchlist();
}

// ============ NEW: news integration ============
async function _fetchCryptoCompare() {
    const res = await fetch("https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const raw = await res.json();
    if (!raw?.Data?.length) throw new Error("keine Daten");
    return raw.Data.slice(0, 30).map((n) => ({
        title: n.title, url: n.url, source: n.source_info?.name || n.source,
        ts: new Date(n.published_on * 1000).toISOString(),
        categories: (n.categories || "").split("|").filter(Boolean),
        body: (n.body || "").slice(0, 240),
    }));
}

async function _fetchRss2Json(rssUrl, sourceName) {
    const proxy = "https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(rssUrl);
    const res = await fetch(proxy);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const raw = await res.json();
    if (raw.status !== "ok" || !raw.items?.length) throw new Error(raw.message || "keine Items");
    return raw.items.slice(0, 30).map((n) => ({
        title: n.title, url: n.link, source: sourceName,
        ts: n.pubDate || new Date().toISOString(),
        categories: (n.categories || []).slice(0, 4),
        body: (n.description || "").replace(/<[^>]+>/g, "").slice(0, 240),
    }));
}

const _fetchCoinDesk = () => _fetchRss2Json("https://www.coindesk.com/arc/outboundfeeds/rss/", "CoinDesk");
const _fetchCointelegraph = () => _fetchRss2Json("https://cointelegraph.com/rss", "Cointelegraph");
const _fetchDecrypt = () => _fetchRss2Json("https://decrypt.co/feed", "Decrypt");

async function _fetchReddit() {
    const raw = await fetch("https://www.reddit.com/r/CryptoCurrency/hot.json?limit=25").then((r) => r.json());
    const kids = raw?.data?.children || [];
    return kids.filter((k) => !k.data.stickied).map((k) => {
        const d = k.data;
        return {
            title: d.title,
            url: "https://reddit.com" + d.permalink,
            source: "r/CryptoCurrency",
            ts: new Date(d.created_utc * 1000).toISOString(),
            categories: [d.link_flair_text].filter(Boolean),
            body: (d.selftext || "").slice(0, 240),
        };
    });
}

async function _fetchCryptoPanic() {
    const raw = await fetch("https://cryptopanic.com/api/free/v1/posts/?public=true").then((r) => r.json());
    const results = raw?.results || [];
    return results.map((p) => ({
        title: p.title, url: p.url, source: p.source?.title || "CryptoPanic",
        ts: p.published_at || new Date().toISOString(),
        categories: (p.currencies || []).map((c) => c.code),
        body: "",
    }));
}

async function fetchNews(force = false) {
    if (!force && Date.now() - state.lastNewsFetch < 5 * 60 * 1000 && state.news.length) return;
    state.newsError = null;
    // try sources in order, keep whichever gets first non-empty result
    const attempts = [
        { name: "CoinDesk", fn: _fetchCoinDesk },
        { name: "Cointelegraph", fn: _fetchCointelegraph },
        { name: "Decrypt", fn: _fetchDecrypt },
        { name: "CryptoCompare", fn: _fetchCryptoCompare },
        { name: "Reddit", fn: _fetchReddit },
        { name: "CryptoPanic", fn: _fetchCryptoPanic },
    ];
    const errors = [];
    for (const src of attempts) {
        try {
            const items = await src.fn();
            if (items && items.length) {
                state.news = items;
                state.lastNewsFetch = Date.now();
                state.newsSource = src.name;
                return;
            }
        } catch (e) {
            errors.push(`${src.name}: ${e.message || "fehler"}`);
        }
    }
    state.newsError = errors.join(" · ") || "keine Quelle erreichbar";
}

function filterNewsForSymbol(symbol) {
    const base = symbol.replace("/USDT", "").toUpperCase();
    const aliases = { BTC: ["BITCOIN", "BTC"], ETH: ["ETHEREUM", "ETH"], SOL: ["SOLANA", "SOL"] };
    const keys = aliases[base] || [base];
    return state.news.filter((n) => {
        const hay = (n.title + " " + (n.categories || []).join(" ")).toUpperCase();
        return keys.some((k) => hay.includes(k));
    }).slice(0, 3);
}

function renderNewsList() {
    const el = $("#news-list");
    const cnt = $("#news-count");
    if (cnt) cnt.textContent = state.news.length ? `${state.news.length} · ${state.newsSource || ""}` : "0";
    const refreshBtn = `<div style="margin-top:10px; text-align:center;">
        <button id="news-refresh" class="ghost" style="font-size:0.75rem; padding:6px 12px;">↻ News aktualisieren</button>
    </div>`;
    if (!state.news.length) {
        el.innerHTML = state.newsError
            ? `<div style="color:var(--amber); font-size:0.82rem;">⚠ ${state.newsError}<br><small>Wahrscheinlich CORS-Blockade durch Browser oder Rate-Limit. Klicke auf Aktualisieren.</small></div>${refreshBtn}`
            : `<div style="color:var(--muted); font-size:0.82rem;">News werden geladen …</div>${refreshBtn}`;
        const btn = $("#news-refresh");
        if (btn) btn.onclick = async () => {
            btn.textContent = "…lade";
            await fetchNews(true);
            renderNewsList();
        };
        return;
    }
    el.innerHTML = state.news.slice(0, 10).map((n) => {
        const t = new Date(n.ts).toLocaleString("de-DE", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
        const tags = (n.categories || []).slice(0, 4).map((c) => `<span class="tag">${c}</span>`).join("");
        return `<div class="news-item">
            <div class="meta">${n.source} · ${t}</div>
            <a href="${n.url}" target="_blank" rel="noopener">${n.title}</a>
            <div class="tags">${tags}</div>
        </div>`;
    }).join("") + refreshBtn;
    const btn = $("#news-refresh");
    if (btn) btn.onclick = async () => {
        btn.textContent = "…lade";
        await fetchNews(true);
        renderNewsList();
    };
}

// ============ NEW: adaptive learning ============
function computeAdaptiveWeights() {
    const trades = _pairTrades().slice(-100);
    const buckets = {};
    for (const t of trades) {
        const strats = (t.strategy || "").split(",").filter(Boolean);
        for (const s of strats) {
            if (!buckets[s]) buckets[s] = { wins: 0, total: 0, pnl: 0 };
            buckets[s].total++;
            buckets[s].pnl += t.pnl;
            if (t.pnl > 0) buckets[s].wins++;
        }
    }
    const weights = {};
    for (const s in buckets) {
        const b = buckets[s];
        if (b.total < 5) { weights[s] = 1.0; continue; }
        const wr = b.wins / b.total;
        // wr 0.5 → 1.0, wr 0.7 → 1.4, wr 0.3 → 0.6
        weights[s] = Math.max(0.3, Math.min(1.8, 0.5 + wr * 1.3));
    }
    state.adaptiveWeights = weights;
    return weights;
}

function renderAdaptiveWeights() {
    const w = computeAdaptiveWeights();
    const el = $("#adaptive-weights");
    if (!Object.keys(w).length) {
        el.textContent = "noch nicht genug Daten (min. 5 Trades pro Strategie nötig)";
        return;
    }
    const rows = Object.entries(w)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => {
            const pct = ((v - 1) * 100);
            const cls = v > 1.1 ? "pnl-pos" : v < 0.9 ? "pnl-neg" : "";
            const bar = Math.min(100, v / 1.8 * 100);
            const color = v > 1.1 ? "green" : v < 0.9 ? "red" : "yellow";
            return `<div style="padding:6px 0;">
                <div style="display:flex;justify-content:space-between;font-size:0.82rem;">
                    <span>${k.replace(/_/g, " ")}</span>
                    <span class="${cls}"><strong>${v.toFixed(2)}×</strong> ${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%</span>
                </div>
                <div class="ks-bar-bg"><div class="ks-bar-fill risk-color-${color}" style="width:${bar}%"></div></div>
            </div>`;
        }).join("");
    el.innerHTML = rows;
}

// ============ NEW: futures data (funding, long/short, OI) ============
async function fetchFuturesData(symbols) {
    const out = [];
    for (const sym of symbols) {
        const s = sym.replace("/", "");
        try {
            const [fr, ls, oi] = await Promise.all([
                fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${s}`).then((r) => r.json()).catch(() => null),
                fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${s}&period=1h&limit=1`).then((r) => r.json()).catch(() => null),
                fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${s}`).then((r) => r.json()).catch(() => null),
            ]);
            out.push({
                symbol: sym,
                funding: fr?.lastFundingRate ? parseFloat(fr.lastFundingRate) * 100 : null,
                longShort: ls?.[0]?.longShortRatio ? parseFloat(ls[0].longShortRatio) : null,
                oi: oi?.openInterest ? parseFloat(oi.openInterest) : null,
            });
        } catch (e) { /* skip */ }
    }
    state.futuresData = out;
    return out;
}

function renderFuturesTable() {
    const data = state.futuresData || [];
    const el = $("#futures-table");
    if (!el) return;
    if (!data.length) { el.innerHTML = "<tbody><tr><td>lade …</td></tr></tbody>"; return; }
    const rows = data.map((d) => {
        const fundingCls = d.funding == null ? "" : Math.abs(d.funding) > 0.05 ? "pnl-neg" : d.funding > 0 ? "pnl-pos" : "";
        const lsCls = d.longShort == null ? "" : d.longShort > 2.5 || d.longShort < 0.6 ? "pnl-neg" : "";
        return `<tr>
            <td>${d.symbol}</td>
            <td class="${fundingCls}">${d.funding == null ? "–" : (d.funding > 0 ? "+" : "") + d.funding.toFixed(4) + "%"}</td>
            <td class="${lsCls}">${d.longShort == null ? "–" : d.longShort.toFixed(2)}</td>
            <td>${d.oi == null ? "–" : fmt(d.oi, 0)}</td>
        </tr>`;
    }).join("");
    el.innerHTML = `<thead><tr><th>Symbol</th><th>Funding 8h</th><th>L/S Ratio</th><th>Open Interest</th></tr></thead><tbody>${rows}</tbody>`;
}

// ============ NEW: backtest ============
async function runBacktest(symbol, days) {
    const el = $("#bt-result");
    el.textContent = "lade Historie …";
    let candles;
    try {
        // Binance allows max 1000 candles/request. For long backtests we chain requests.
        const perDay = 96;                                    // 15m candles per day
        const needed = Math.min(days * perDay, 3000);
        candles = await window.TB.fetchKlines(symbol, "15m", 1000);
        if (needed > 1000) {
            // fetch older chunks
            const oldest = candles[0].ts;
            const step = 15 * 60 * 1000;
            let cursor = oldest - 1000 * step;
            while (candles.length < needed && cursor > 0) {
                const url = `https://api.binance.com/api/v3/klines?symbol=${symbol.replace("/", "")}&interval=15m&endTime=${cursor}&limit=1000`;
                const raw = await fetch(url).then((r) => r.json());
                if (!raw?.length) break;
                candles = raw.map((k) => ({
                    ts: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
                })).concat(candles);
                cursor = raw[0][0] - 1000 * step;
            }
        }
    } catch (e) { el.textContent = "Fehler beim Laden: " + e.message; return; }

    const bt = new window.TB.PaperBroker(10000, { isolated: true });
    let trades = 0, wins = 0, losses = 0;
    const equity = [];
    const tradePnls = [];               // for Monte-Carlo permutation
    const SLIPPAGE_BPS = 5;             // 5 basis points = 0.05% slippage per trade
    const LATENCY_BARS = 1;             // signal detected at bar N, executed at bar N+1
    let pendingSignal = null;
    for (let i = 220; i < candles.length; i++) {
        const win = candles.slice(Math.max(0, i - 500), i + 1);
        const price = candles[i].close;
        // apply slippage on price for stop/tp checks
        const events = bt.onPrice(symbol, price);
        for (const ev of events) {
            if (ev.kind === "tp" || ev.kind === "sl") {
                trades++;
                if (ev.pnl > 0) wins++;
                else if (ev.pnl < 0) losses++;
                tradePnls.push(ev.pnl);
            }
        }
        // execute delayed signal from previous scan
        if (pendingSignal && !bt.positions[symbol]) {
            const p = pendingSignal;
            const slipMult = p.side === "long" ? (1 + SLIPPAGE_BPS / 10000) : (1 - SLIPPAGE_BPS / 10000);
            const execPrice = price * slipMult;                       // pay slippage on entry
            bt.submit(symbol, p.side, p.size, execPrice,
                { stop: p.stop, take_profits: p.take_profits, strategy: p.strategy });
            pendingSignal = null;
        }
        if (!bt.positions[symbol] && !pendingSignal && i % 4 === 0) {
            const result = window.TB.ensemble(win, CFG.strictMinScore, CFG.strictAgreement);
            if (result.side) {
                const atrArr = window.TB.atr(window.TB.highs(win), window.TB.lows(win), window.TB.closes(win), 14);
                const atrVal = atrArr[atrArr.length - 1];
                const equity_ = bt.equity({ [symbol]: price });
                const plan = window.TB.planTrade(result.side, price, atrVal, equity_,
                    { riskPctPerTrade: CFG.baseRiskPct, atrStopMult: CFG.atrStopMult,
                      tpMultiples: CFG.tpMultiples,
                      maxNotionalPctPerPosition: CFG.maxNotionalPctPerPosition });
                if (plan && plan.size > 0) {
                    // Delay execution by LATENCY_BARS
                    pendingSignal = { ...plan,
                        strategy: result.signals.map((s) => s.strategy).join(",") };
                }
            }
        }
        equity.push({ ts: candles[i].ts, eq: bt.equity({ [symbol]: price }) });
    }
    const finalEq = bt.equity({ [symbol]: candles[candles.length - 1].close });
    const pnl = finalEq - 10000;
    const wr = trades ? (wins / trades * 100) : 0;

    // ---- Monte-Carlo permutation of trade order to estimate DD distribution ----
    let mcMedianDD = 0, mcP95DD = 0, mcP99DD = 0, mcMaxDD = 0;
    if (tradePnls.length >= 5) {
        const permutations = 1000;
        const dds = [];
        for (let sim = 0; sim < permutations; sim++) {
            // Shuffle
            const shuffled = tradePnls.slice();
            for (let k = shuffled.length - 1; k > 0; k--) {
                const j = Math.floor(Math.random() * (k + 1));
                [shuffled[k], shuffled[j]] = [shuffled[j], shuffled[k]];
            }
            let eq = 10000, peak = 10000, worst = 0;
            for (const p of shuffled) {
                eq += p;
                if (eq > peak) peak = eq;
                const dd = (peak - eq) / peak * 100;
                if (dd > worst) worst = dd;
            }
            dds.push(worst);
        }
        dds.sort((a, b) => a - b);
        mcMedianDD = dds[Math.floor(dds.length * 0.5)];
        mcP95DD = dds[Math.floor(dds.length * 0.95)];
        mcP99DD = dds[Math.floor(dds.length * 0.99)];
        mcMaxDD = dds[dds.length - 1];
    }
    // measured drawdown in the actual observed path
    let obsPeak = 10000, obsDD = 0;
    for (const p of equity) {
        obsPeak = Math.max(obsPeak, p.eq);
        obsDD = Math.max(obsDD, (obsPeak - p.eq) / obsPeak * 100);
    }

    // mini sparkline
    const minEq = Math.min(...equity.map((p) => p.eq));
    const maxEq = Math.max(...equity.map((p) => p.eq));
    const w = 400, h = 60;
    const step = w / Math.max(equity.length - 1, 1);
    const line = equity.map((p, i) => `${(i * step).toFixed(1)},${(h - (p.eq - minEq) / (maxEq - minEq || 1) * h).toFixed(1)}`).join(" ");
    const startY = (h - (10000 - minEq) / (maxEq - minEq || 1) * h).toFixed(1);
    const cls = pnl > 0 ? "pos" : pnl < 0 ? "neg" : "";
    el.innerHTML = `
        <div class="journal-summary" style="margin-top:12px;">
            <div class="js-tile"><div class="k">Trades</div><div class="v">${trades}</div></div>
            <div class="js-tile"><div class="k">Win-Rate</div><div class="v">${wr.toFixed(0)}%</div></div>
            <div class="js-tile"><div class="k">End-Equity</div><div class="v">${fmt(finalEq, 0)}</div></div>
            <div class="js-tile"><div class="k">PnL</div><div class="v ${cls}">${pnl >= 0 ? "+" : ""}${fmt(pnl, 2)}</div></div>
        </div>
        <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:80px;background:rgba(5,7,12,0.4);border-radius:8px;margin-top:8px;">
            <line x1="0" y1="${startY}" x2="${w}" y2="${startY}" stroke="var(--muted)" stroke-dasharray="3 3" stroke-width="0.5"/>
            <polyline points="${line}" fill="none" stroke="${pnl >= 0 ? "var(--green)" : "var(--red)"}" stroke-width="1.5"/>
        </svg>
        <div style="text-align:center;margin-top:6px;font-size:0.72rem;color:var(--muted);">
            ${equity.length} Bars simuliert · Start 10 000 USDT · Slippage 5 bps + 1-Bar-Latency · Strikte Filter (Score ≥ 3.0, Agreement ≥ 3)
        </div>
        ${tradePnls.length >= 5 ? `
        <div class="risk-block" style="margin-top:12px;">
            <div class="risk-title"><span>Monte-Carlo Drawdown-Verteilung</span><span style="color:var(--muted); font-size:0.7rem;">1000 Permutationen</span></div>
            <div class="row"><span>Beobachtet (dieser Pfad)</span><strong class="num">-${fmt(obsDD, 2)}%</strong></div>
            <div class="row"><span>Median-DD über alle Reihenfolgen</span><strong class="num">-${fmt(mcMedianDD, 2)}%</strong></div>
            <div class="row"><span>95%-Perzentil</span><strong class="num" style="color:var(--amber)">-${fmt(mcP95DD, 2)}%</strong></div>
            <div class="row"><span>99%-Perzentil (fast worst-case)</span><strong class="num" style="color:var(--red)">-${fmt(mcP99DD, 2)}%</strong></div>
            <div class="row" style="border-bottom:none;"><span>Absoluter MC-Max-DD</span><strong class="num" style="color:var(--red)">-${fmt(mcMaxDD, 2)}%</strong></div>
            <div style="margin-top:6px; font-size:0.7rem; color:var(--muted); line-height:1.4;">
                Bei ungünstiger Reihenfolge der gleichen Trades erwarte Drawdown bis <b>${fmt(mcP99DD, 1)}%</b>. Passe das Depot entsprechend an.
            </div>
        </div>` : ""}`;
    announce(`Backtest fertig. In ${days} Tagen: ${trades} Trades, ${wr.toFixed(0)}% Win-Rate, PnL ${pnl.toFixed(2)} Dollar.`);
}

// ============ NEW: weekly report ============
function checkWeeklyReport() {
    const now = new Date();
    const lastReport = parseInt(localStorage.getItem("tb_last_report") || "0");
    // Sunday = 0, hour >= 20, and at least 20h since last report
    if (now.getDay() === 0 && now.getHours() >= 20 && Date.now() - lastReport > 20 * 3600 * 1000) {
        generateWeeklyReport();
        localStorage.setItem("tb_last_report", String(Date.now()));
    }
}

function generateWeeklyReport() {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const trades = _pairTrades().filter((t) => new Date(t.close_ts) >= weekAgo);
    const wins = trades.filter((t) => t.pnl > 0).length;
    const pnl = trades.reduce((s, t) => s + t.pnl, 0);
    const wr = trades.length ? (wins / trades.length * 100) : 0;
    const byStrategy = {};
    for (const t of trades) {
        const strats = (t.strategy || "").split(",").filter(Boolean);
        for (const s of strats) {
            byStrategy[s] = (byStrategy[s] || 0) + t.pnl;
        }
    }
    const bestStrat = Object.entries(byStrategy).sort((a, b) => b[1] - a[1])[0];
    const msg = `Wochen-Report: ${trades.length} Trades, Win-Rate ${wr.toFixed(0)} Prozent, PnL ${pnl.toFixed(2)} Dollar. ` +
        (bestStrat ? `Beste Strategie: ${bestStrat[0].replace(/_/g, " ")} mit ${bestStrat[1].toFixed(2)} Dollar.` : "");
    announce(msg, "alert");
    return { trades: trades.length, wins, pnl, wr, bestStrat };
}

// ============ NEW: per-strategy performance ============
function renderStrategyPerformance() {
    const trades = _pairTrades();
    const buckets = {};
    for (const t of trades) {
        const strats = (t.strategy || "unknown").split(",").filter(Boolean);
        for (const s of strats) {
            if (!buckets[s]) buckets[s] = { trades: 0, wins: 0, losses: 0, pnl: 0 };
            buckets[s].trades++;
            buckets[s].pnl += t.pnl;
            if (t.pnl > 0) buckets[s].wins++;
            else if (t.pnl < 0) buckets[s].losses++;
        }
    }
    const rows = Object.entries(buckets)
        .sort((a, b) => b[1].pnl - a[1].pnl)
        .map(([k, v]) => {
            const wr = v.trades ? (v.wins / v.trades * 100) : 0;
            const cls = v.pnl > 0 ? "pnl-pos" : v.pnl < 0 ? "pnl-neg" : "";
            return `<tr>
                <td>${k.replace(/_/g, " ")}</td>
                <td>${v.trades}</td>
                <td>${wr.toFixed(0)}%</td>
                <td class="${cls}">${v.pnl >= 0 ? "+" : ""}${v.pnl.toFixed(2)}</td>
            </tr>`;
        }).join("");
    $("#strat-perf").innerHTML = rows.length
        ? `<table class="perf-table"><thead><tr><th>Strategie</th><th>Trades</th><th>Win %</th><th>PnL</th></tr></thead><tbody>${rows}</tbody></table>`
        : "noch keine abgeschlossenen Trades";
}

// ============ NEW: 24h ticker snapshot ============
async function refresh24hTickers() {
    state.tickers = await window.TB.fetch24hTickers(CFG.symbols);
    render24hTickers();
}

function render24hTickers() {
    const el = $("#ticker24");
    if (!el) return;
    const data = state.tickers || {};
    const rows = CFG.symbols.map((s) => {
        const t = data[s];
        if (!t) return `<tr><td>${s}</td><td colspan="4" style="color:var(--muted); text-align:center;">–</td></tr>`;
        const chgCls = t.priceChangePct > 0 ? "pnl-pos" : t.priceChangePct < 0 ? "pnl-neg" : "";
        const volM = t.volumeUSD / 1e6;
        return `<tr>
            <td>${s}</td>
            <td class="num">${fmt(t.lastPrice, 4)}</td>
            <td class="num ${chgCls}">${t.priceChangePct > 0 ? "+" : ""}${fmt(t.priceChangePct, 2)}%</td>
            <td class="num" style="color:var(--muted); font-size:0.72rem;">${fmt(t.low, 4)}<br>${fmt(t.high, 4)}</td>
            <td class="num">${fmt(volM, 1)}M</td>
        </tr>`;
    }).join("");
    el.innerHTML = `<thead><tr><th>Symbol</th><th>Preis</th><th>24h %</th><th>24h Range</th><th>Vol $M</th></tr></thead><tbody>${rows}</tbody>`;
}

// ============ NEW: portfolio allocation ============
function renderAllocation() {
    const el = $("#allocation");
    const eq = broker.equity(state.prices);
    const cashPct = Math.max(0, broker.cash / eq * 100);
    const positions = broker.positions;
    const palette = ["#4d94ff", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6", "#ec4899", "#84cc16", "#f97316", "#6366f1", "#0ea5e9", "#eab308"];
    const items = [{ label: "Cash", short: "Cash", value: broker.cash, pct: cashPct, color: "#6b7891", side: null }];
    let colorIdx = 0;
    for (const sym in positions) {
        const p = positions[sym];
        const price = state.prices[sym] || p.entry;
        const value = p.side === "long" ? p.qty * price : Math.max(0, p.qty * (2 * p.entry - price));
        items.push({
            label: sym.replace("/USDT", "") + (p.side === "long" ? " LONG" : " SHORT"),
            short: sym.replace("/USDT", ""),
            value, pct: value / eq * 100, color: palette[colorIdx++ % palette.length],
            side: p.side, symbol: sym,
        });
    }
    items.sort((a, b) => b.pct - a.pct);
    // stacked segment bar
    const bar = items.map((i) => i.pct > 0.1
        ? `<div class="alloc-seg" style="width:${i.pct}%; background:${i.color};" title="${i.label} ${i.pct.toFixed(1)}%">${i.pct >= 8 ? i.short : ""}</div>`
        : ""
    ).join("");
    // detailed rows with per-position mini-bar
    const rows = items.map((i) => `
        <div class="alloc-row">
            <div class="alloc-row-head">
                <span><span class="swatch" style="background:${i.color}"></span><strong>${i.label}</strong></span>
                <span class="num"><strong>${fmt(i.value, 2)}</strong> <small style="color:var(--muted)">USDT</small></span>
            </div>
            <div class="alloc-row-bar"><div class="alloc-row-fill" style="width:${Math.min(i.pct, 100)}%; background:${i.color};"></div></div>
            <div class="alloc-row-foot"><small>${i.pct.toFixed(1)}% des Depots</small></div>
        </div>`).join("");
    el.innerHTML = `
        <div class="alloc-header">
            <span>Gesamt-Equity</span>
            <strong class="num">${fmt(eq, 2)} USDT</strong>
        </div>
        <div class="alloc-bar-large">${bar}</div>
        <div class="alloc-list-v2">${rows}</div>`;
}

function renderAll() {
    const active = state.pending[0];
    let fallback = null;
    if (!active && state.lastScan) {
        const best = [...state.lastScan].filter((r) => r.side).sort((a, b) => b.score - a.score)[0];
        if (best) fallback = {
            action: best.side === "long" ? "KAUFEN" : "VERKAUFEN",
            color: best.side === "long" ? "green" : "red",
            symbol: best.symbol, hint: `Score ${best.score.toFixed(2)}  ·  ${(best.signals || []).length} Signale`,
        };
    }
    renderSignalTile(active, fallback);
    renderPortfolio();
    renderPositions();
    renderMatrix();
    renderSignalsLog();
    renderJournal();
    renderEquityChart();
    renderKillSwitch();
    renderWatchlist();
    renderStrategyPerformance();
    renderAdaptiveWeights();
    renderFuturesTable();
    render24hTickers();
    renderAllocation();
    renderVarEs();
    renderKellyCell();
    renderCompositeFng();
    checkStructuralBreak();
    $("#peak-eq").textContent = money(state.peakEquity);
    checkWatchlist();
    checkWeeklyReport();
}

function renderVarEs() {
    const r = computePortfolioRisk();
    $("#var-cell").textContent = r.totalVaR > 0 ? "-" + money(r.totalVaR) : "0,00 USDT";
    $("#es-cell").textContent = r.totalES > 0 ? "-" + money(r.totalES) : "0,00 USDT";
}
function renderKellyCell() {
    const k = computeKelly();
    if (!k) { $("#kelly-cell").textContent = "warten auf ≥20 Trades"; return; }
    const pct = (k.halfKelly * 100).toFixed(2);
    const color = k.kelly > 0.02 ? "var(--green)" : k.kelly > 0 ? "var(--amber)" : "var(--red)";
    $("#kelly-cell").innerHTML = `<span style="color:${color}">${pct}% Half-Kelly</span> <small style="color:var(--muted)">(R=${k.R.toFixed(2)}, WR=${(k.winRate*100).toFixed(0)}%)</small>`;
}

async function renderCompositeFng() {
    const c = await computeBinanceCompositeFng();
    if (!c) { $("#fng-binance").textContent = "–"; return; }
    const color = c.value <= 20 ? "var(--red)" : c.value <= 40 ? "var(--amber)"
                : c.value >= 80 ? "var(--red)" : c.value >= 60 ? "var(--green)" : "var(--muted)";
    $("#fng-binance").innerHTML = `<span style="color:${color}">${c.value} · ${c.label}</span>`;
    const parts = c.components;
    $("#fng-parts").innerHTML = `
        <div class="fng-part"><span class="fp-k">RSI</span><span class="fp-v">${parts.rsi}</span></div>
        <div class="fng-part"><span class="fp-k">Vol</span><span class="fp-v">${parts.vol}</span></div>
        <div class="fng-part"><span class="fp-k">DD</span><span class="fp-v">${parts.dd}</span></div>
        <div class="fng-part"><span class="fp-k">Funding</span><span class="fp-v">${parts.funding}</span></div>
        <div class="fng-part"><span class="fp-k">L/S</span><span class="fp-v">${parts.longShort}</span></div>`;
}

let _lastCusumAlert = 0;
function checkStructuralBreak() {
    const cb = structuralBreakDetection();
    if (!cb || !cb.breakDetected) return;
    if (Date.now() - _lastCusumAlert < 6 * 3600 * 1000) return;      // rate-limit alerts to 6h
    _lastCusumAlert = Date.now();
    announce("Strukturbruch erkannt. Die Live-Performance weicht signifikant vom historischen Muster ab. Bitte Bot pausieren und Setup prüfen.", "alert");
}

// =========== event bindings ============================================
$("#btn-scan").onclick = async () => {
    $("#btn-scan").textContent = "…scanne";
    await scanAll();
    $("#btn-scan").textContent = "Jetzt scannen";
};

$("#btn-reset").onclick = () => {
    if (!confirm("Portfolio wirklich zurücksetzen? Alle Trades und das Guthaben werden gelöscht. Start bei 10 000 USDT.")) return;
    broker.reset();
    state.pending = [];
    state.equityHistory = [];
    state.peakEquity = 10000;
    state.dayStartEquity = 10000;
    state.dayStartDate = new Date().toDateString();
    state.halted = false;
    localStorage.setItem("tb_peak_equity", "10000");
    localStorage.setItem("tb_day_equity", "10000");
    localStorage.setItem("tb_day_date", state.dayStartDate);
    localStorage.setItem("tb_halted", "0");
    localStorage.setItem("tb_equity_hist", "[]");
    announce("Portfolio zurückgesetzt. 10 000 Dollar Spielgeld wieder verfügbar.");
    renderAll();
};

$("#btn-nuke")?.addEventListener("click", () => {
    if (!confirm("ALLES löschen? Depot, geschlossene Trades, Watchlist, Alarme, Historie — alles auf Werkseinstellung. Nicht rückgängig zu machen.")) return;
    // wipe every tb_* key
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("tb_")) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
    announce("Komplett-Reset ausgeführt. App wird neu geladen.", "alert");
    setTimeout(() => location.reload(), 800);
});

$("#mode-toggle").onclick = () => {
    state.autoMode = !state.autoMode;
    localStorage.setItem("tb_auto", state.autoMode ? "1" : "0");
    updateModePill();
    announce(state.autoMode
        ? "Vollautomatik aktiv. Ich handle jetzt selbstständig die Setups mit niedrigstem Risiko."
        : "Manueller Modus aktiv.");
};

document.querySelector(".news-popup-close")?.addEventListener("click", () => {
    document.querySelector(".news-popup").classList.add("hidden");
});

// Journal controls
document.querySelectorAll(".jv-tab").forEach((btn) => {
    btn.onclick = () => {
        journalState.view = btn.dataset.view;
        localStorage.setItem("tb_journal_view", journalState.view);
        document.querySelectorAll(".jv-tab").forEach((b) => b.classList.toggle("primary", b === btn));
        renderJournal();
    };
});
const jd = $("#journal-date");
if (jd) {
    jd.value = journalState.date;
    jd.onchange = () => {
        journalState.date = jd.value || new Date().toISOString().slice(0, 10);
        localStorage.setItem("tb_journal_date", journalState.date);
        renderJournal();
    };
}
$("#btn-export-csv")?.addEventListener("click", exportJournalCsv);
$("#btn-print")?.addEventListener("click", () => {
    document.getElementById("journal-section").dataset.printed = new Date().toLocaleString("de-DE");
    window.print();
});
// activate the stored tab
document.querySelectorAll(".jv-tab").forEach((b) => b.classList.toggle("primary", b.dataset.view === journalState.view));

// =========== boot ============================================
// -------- watchlist add UI --------
document.addEventListener("DOMContentLoaded", () => {
    const addBtn = $("#watch-add");
    if (addBtn) {
        addBtn.onclick = () => {
            const sym = $("#watch-symbol").value;
            const dir = $("#watch-direction").value;
            const price = parseFloat($("#watch-price").value);
            if (!sym || !price || isNaN(price)) return;
            state.watchlist.push({ symbol: sym, direction: dir, price, hit: false, added_ts: new Date().toISOString() });
            saveWatchlist();
            $("#watch-price").value = "";
            renderWatchlist();
        };
    }
});

function renderBacktestOptions() {
    const sel = $("#bt-symbol");
    if (!sel) return;
    sel.innerHTML = CFG.symbols.map((s) => `<option value="${s}">${s}</option>`).join("");
}

window.addEventListener("tb-autoheal", () => {
    state.equityHistory = [];
    state.peakEquity = 10000;
    state.dayStartEquity = 10000;
    state.dayStartDate = new Date().toDateString();
    state.halted = false;
    localStorage.setItem("tb_peak_equity", "10000");
    localStorage.setItem("tb_day_equity", "10000");
    localStorage.setItem("tb_day_date", state.dayStartDate);
    localStorage.setItem("tb_halted", "0");
    localStorage.setItem("tb_equity_hist", "[]");
    announce("Depot automatisch bereinigt. Fehlerhafte Positionen aus einer alten Version wurden entfernt. Start bei 10 000 USDT.", "alert");
});

async function boot() {
    renderStrategies();
    renderTvSelect();
    updateModePill();
    renderSymbolPicker();
    renderWatchlistOptions();
    renderBacktestOptions();
    renderAll();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
    keepAwake();
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") keepAwake();
    });

    // hook up backtest button
    const btBtn = $("#bt-run");
    if (btBtn) {
        btBtn.onclick = async () => {
            btBtn.textContent = "läuft …"; btBtn.disabled = true;
            await runBacktest($("#bt-symbol").value, parseInt($("#bt-days").value));
            btBtn.textContent = "Backtest starten"; btBtn.disabled = false;
        };
    }

    // initial scan + news + futures
    await scanAll();
    refreshFng();
    fetchNews().then(renderNewsList);
    fetchFuturesData(CFG.symbols.slice(0, 5)).then(renderFuturesTable);
    refresh24hTickers();

    // loops
    setInterval(scanAll, CFG.scanIntervalSec * 1000);
    setInterval(refreshPrices, CFG.priceIntervalSec * 1000);
    setInterval(refreshFng, 5 * 60 * 1000);
    setInterval(() => { fetchNews().then(renderNewsList); }, 5 * 60 * 1000);
    setInterval(() => { fetchFuturesData(CFG.symbols.slice(0, 5)).then(renderFuturesTable); }, 3 * 60 * 1000);
    setInterval(refresh24hTickers, 60 * 1000);
}

// ============ v6: THEME TOGGLE ============
function initTheme() {
    const saved = localStorage.getItem("tb_theme") || "dark";
    document.documentElement.setAttribute("data-theme", saved);
    const btn = document.getElementById("theme-toggle");
    if (btn) {
        const setLabel = (mode) => {
            btn.textContent = mode === "light" ? "☀ Hell-Modus" : "🌙 Dunkel-Modus";
        };
        setLabel(saved);
        btn.onclick = () => {
            const cur = document.documentElement.getAttribute("data-theme") || "dark";
            const next = cur === "light" ? "dark" : "light";
            document.documentElement.setAttribute("data-theme", next);
            localStorage.setItem("tb_theme", next);
            setLabel(next);
        };
    }
}

// ============ v6: BACKUP / RESTORE ============
function exportBackup() {
    const dump = {};
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("tb_")) dump[k] = localStorage.getItem(k);
    }
    dump._exported_at = new Date().toISOString();
    dump._schema = "trading-bot-v6";
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tradingbot_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    announce("Backup als JSON exportiert.", "success");
}

function importBackup(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const dump = JSON.parse(e.target.result);
            if (dump._schema !== "trading-bot-v6" && dump._schema !== "trading-bot-v5") {
                if (!confirm("Backup-Schema unbekannt. Trotzdem importieren?")) return;
            }
            if (!confirm(`Backup vom ${dump._exported_at || "?"} importieren? Alle aktuellen Daten werden ersetzt.`)) return;
            for (const k in dump) {
                if (k.startsWith("tb_")) localStorage.setItem(k, dump[k]);
            }
            announce("Backup wiederhergestellt. App wird neu geladen.", "success");
            setTimeout(() => location.reload(), 800);
        } catch (err) {
            alert("Backup fehlerhaft: " + err.message);
        }
    };
    reader.readAsText(file);
}

// ============ v6: HEALTH STATUS ============
const HEALTH_ENDPOINTS = [
    { name: "Binance Spot API", url: "https://api.binance.com/api/v3/ping" },
    { name: "Binance Futures API", url: "https://fapi.binance.com/fapi/v1/ping" },
    { name: "alternative.me F&G", url: "https://api.alternative.me/fng/?limit=1" },
    { name: "CoinGecko", url: "https://api.coingecko.com/api/v3/ping" },
    { name: "Frankfurter EUR", url: "https://api.frankfurter.app/latest?from=USD&to=EUR" },
    { name: "mempool.space", url: "https://mempool.space/api/v1/fees/recommended" },
    { name: "rss2json (news)", url: "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fdecrypt.co%2Ffeed" },
];

async function checkHealth() {
    const el = $("#health-panel");
    if (!el) return;
    el.innerHTML = HEALTH_ENDPOINTS.map((e) => `<div class="health-row" data-name="${e.name}"><span><span class="health-dot pending"></span>${e.name}</span><span style="color:var(--muted); font-size:0.72rem;">…prüfe</span></div>`).join("");
    for (const ep of HEALTH_ENDPOINTS) {
        const start = performance.now();
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 5000);
            const res = await fetch(ep.url, { signal: controller.signal });
            clearTimeout(timer);
            const ms = Math.round(performance.now() - start);
            const row = el.querySelector(`[data-name="${ep.name}"]`);
            if (!row) continue;
            const ok = res.ok;
            const cls = ok ? (ms > 2000 ? "warn" : "ok") : "err";
            row.innerHTML = `<span><span class="health-dot ${cls}"></span>${ep.name}</span><span style="color:var(--muted); font-size:0.72rem;">${res.status} · ${ms} ms</span>`;
        } catch (err) {
            const row = el.querySelector(`[data-name="${ep.name}"]`);
            if (row) row.innerHTML = `<span><span class="health-dot err"></span>${ep.name}</span><span style="color:var(--red); font-size:0.72rem;">unerreichbar</span>`;
        }
    }
}

// ============ v6: MARKET CONTEXT ============
async function refreshMarketCtx() {
    const [global, trending] = await Promise.all([
        window.TB.fetchGlobalMarket(),
        window.TB.fetchTrending(),
    ]);
    state.marketGlobal = global;
    state.trending = trending;
    renderMarketCtx();
}

function renderMarketCtx() {
    const el = $("#market-ctx");
    if (!el) return;
    const g = state.marketGlobal;
    const t = state.trending || [];
    if (!g && !t.length) { el.textContent = "lade …"; return; }
    const mcapT = g?.totalMcap ? (g.totalMcap / 1e12).toFixed(2) + " T$" : "–";
    const volB = g?.totalVolume ? (g.totalVolume / 1e9).toFixed(1) + " B$" : "–";
    const chgCls = g?.mcapChange24h > 0 ? "pnl-pos" : g?.mcapChange24h < 0 ? "pnl-neg" : "";
    const chg = g?.mcapChange24h != null ? `${g.mcapChange24h > 0 ? "+" : ""}${g.mcapChange24h.toFixed(2)}%` : "–";
    el.innerHTML = `
        <div class="mkt-grid">
            <div class="mkt-tile"><div class="k">BTC Dominance</div><div class="v">${g?.btcDominance != null ? g.btcDominance.toFixed(1) + "%" : "–"}</div></div>
            <div class="mkt-tile"><div class="k">ETH Dominance</div><div class="v">${g?.ethDominance != null ? g.ethDominance.toFixed(1) + "%" : "–"}</div></div>
            <div class="mkt-tile"><div class="k">Total Mcap</div><div class="v">${mcapT}</div></div>
            <div class="mkt-tile"><div class="k">24h Volume</div><div class="v">${volB}</div></div>
            <div class="mkt-tile"><div class="k">24h Änderung</div><div class="v ${chgCls}">${chg}</div></div>
            <div class="mkt-tile"><div class="k">Aktive Coins</div><div class="v">${g?.activeCoins ?? "–"}</div></div>
        </div>
        ${t.length ? `
        <div style="margin-top:8px; font-size:0.72rem; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">Trending gerade</div>
        <div class="trend-list" style="margin-top:6px;">
            ${t.map((c) => `<span class="trend-chip">🔥 ${c.symbol.toUpperCase()}${c.rank ? ` · #${c.rank}` : ""}</span>`).join("")}
        </div>` : ""}`;
}

// ============ v6: ON-CHAIN ============
async function refreshOnChain() {
    state.onchain = await window.TB.fetchOnChain();
    renderOnChain();
}

function renderOnChain() {
    const el = $("#onchain");
    if (!el) return;
    const d = state.onchain;
    if (!d) { el.textContent = "lade …"; return; }
    const hashEH = d.hashrate ? (d.hashrate / 1e18).toFixed(1) + " EH/s" : "–";
    const diffT = d.difficulty ? (d.difficulty / 1e12).toFixed(2) + " T" : "–";
    el.innerHTML = `
        <div class="onchain-grid">
            <div class="mkt-tile"><div class="k">Hashrate</div><div class="v">${hashEH}</div></div>
            <div class="mkt-tile"><div class="k">Difficulty</div><div class="v">${diffT}</div></div>
            <div class="mkt-tile"><div class="k">Mempool</div><div class="v">${d.mempoolSize != null ? fmt(d.mempoolSize, 0) : "–"} tx</div></div>
            <div class="mkt-tile"><div class="k">Fast Fee</div><div class="v">${d.fastFee ?? "–"} sat/vB</div></div>
            <div class="mkt-tile"><div class="k">30min Fee</div><div class="v">${d.halfFee ?? "–"} sat/vB</div></div>
            <div class="mkt-tile"><div class="k">1h Fee</div><div class="v">${d.hourFee ?? "–"} sat/vB</div></div>
        </div>`;
}

// ============ v6: EUR CONVERSION ============
async function refreshEurRate() {
    state.eurRate = await window.TB.fetchEurRate();
    renderEurRow();
}

function renderEurRow() {
    const el = $("#equity-eur");
    if (!el) return;
    if (!state.eurRate) { el.textContent = "–"; return; }
    const eq = broker.equity(state.prices);
    const eur = eq * state.eurRate;
    el.textContent = eur.toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " EUR";
}

// ============ v6: CORRELATION HEATMAP ============
function renderCorrelationMatrix() {
    const el = $("#corr-matrix");
    if (!el) return;
    // Use top 8 symbols by candles-available for speed
    const syms = CFG.symbols.filter((s) => state.candles[s] && state.candles[s].length >= 50).slice(0, 10);
    if (syms.length < 2) { el.textContent = "lade Kursdaten …"; return; }
    let html = '<table class="corr-table"><thead><tr><th></th>';
    for (const s of syms) html += `<th>${s.replace("/USDT", "")}</th>`;
    html += "</tr></thead><tbody>";
    for (const a of syms) {
        html += `<tr><th>${a.replace("/USDT", "")}</th>`;
        for (const b of syms) {
            const c = a === b ? 1 : correlationOf(a, b);
            const absC = Math.abs(c);
            let bg;
            if (c >= 0) {
                // red gradient for positive correlation
                const alpha = Math.min(0.85, absC);
                bg = `rgba(239, 68, 68, ${alpha})`;
            } else {
                // green for negative (rare, valuable)
                const alpha = Math.min(0.85, absC);
                bg = `rgba(34, 197, 94, ${alpha})`;
            }
            html += `<td class="corr-cell" style="background:${bg}">${c.toFixed(2)}</td>`;
        }
        html += "</tr>";
    }
    html += "</tbody></table>";
    el.innerHTML = html;
}

// ============ v6: RETURN DISTRIBUTION HISTOGRAM ============
function renderReturnHistogram() {
    const el = $("#return-hist");
    if (!el) return;
    const trades = _pairTrades();
    if (trades.length < 3) { el.textContent = "warten auf ≥ 3 abgeschlossene Trades"; return; }
    const pnls = trades.map((t) => t.pnl);
    const min = Math.min(...pnls);
    const max = Math.max(...pnls);
    const range = max - min || 1;
    const bins = 15;
    const binSize = range / bins;
    const counts = new Array(bins).fill(0);
    for (const v of pnls) {
        const idx = Math.min(bins - 1, Math.floor((v - min) / binSize));
        counts[idx]++;
    }
    const maxCount = Math.max(...counts);
    const bars = counts.map((c, i) => {
        const height = maxCount ? (c / maxCount * 100) : 0;
        const centre = min + (i + 0.5) * binSize;
        const color = centre < 0 ? "var(--red)" : "var(--green)";
        return `<div class="hist-bar" style="height:${height}%; background:${color};" title="${centre.toFixed(2)} USDT · ${c} Trades"></div>`;
    }).join("");
    const mean = pnls.reduce((s, v) => s + v, 0) / pnls.length;
    const stddev = Math.sqrt(pnls.reduce((s, v) => s + (v - mean) ** 2, 0) / pnls.length);
    el.innerHTML = `
        <div class="hist-bars">${bars}</div>
        <div class="hist-labels"><span>${min.toFixed(2)}</span><span>0</span><span>${max.toFixed(2)}</span></div>
        <div style="margin-top:12px; display:grid; grid-template-columns:repeat(auto-fit,minmax(100px,1fr)); gap:6px;">
            <div class="mkt-tile"><div class="k">Mittelwert</div><div class="v" style="font-size:0.9rem;">${mean >= 0 ? "+" : ""}${mean.toFixed(2)}</div></div>
            <div class="mkt-tile"><div class="k">Std-Abw.</div><div class="v" style="font-size:0.9rem;">${stddev.toFixed(2)}</div></div>
            <div class="mkt-tile"><div class="k">Bester</div><div class="v pnl-pos" style="font-size:0.9rem;">+${max.toFixed(2)}</div></div>
            <div class="mkt-tile"><div class="k">Schlechtester</div><div class="v pnl-neg" style="font-size:0.9rem;">${min.toFixed(2)}</div></div>
        </div>`;
}

// ============ v6: ROLLING SHARPE / SORTINO / CALMAR ============
function _dailyReturnsFromHistory() {
    // Group equityHistory by day, take last equity per day, compute returns
    const byDay = {};
    for (const p of state.equityHistory) {
        const day = new Date(p.ts).toDateString();
        byDay[day] = p.eq;
    }
    const eqs = Object.values(byDay);
    const rets = [];
    for (let i = 1; i < eqs.length; i++) {
        const r = (eqs[i] - eqs[i - 1]) / (eqs[i - 1] || 1);
        if (isFinite(r)) rets.push(r);
    }
    return rets;
}

function renderRollingMetrics() {
    const rets = _dailyReturnsFromHistory();
    const sharpe = window.TB.rollingSharpe(rets, 30);
    const sortino = window.TB.rollingSortino(rets, 30);
    const calmar = window.TB.calmar(state.equityHistory);
    const fmtRatio = (v) => v == null ? "–" : (v >= 0 ? "+" : "") + v.toFixed(2);
    const colr = (v) => v == null ? "var(--muted)" : v >= 1 ? "var(--green)" : v >= 0 ? "var(--amber)" : "var(--red)";
    const s = $("#sharpe-cell"), so = $("#sortino-cell"), c = $("#calmar-cell");
    if (s) { s.textContent = fmtRatio(sharpe); s.style.color = colr(sharpe); }
    if (so) { so.textContent = fmtRatio(sortino); so.style.color = colr(sortino); }
    if (c) { c.textContent = fmtRatio(calmar); c.style.color = colr(calmar); }
}

// ============ v6: HALTEFRIST §23 EStG in journal (bonus render override) ============
function renderJournalTaxHint() {
    // add tax-hint spans to existing journal rows after render
    const rows = document.querySelectorAll("#journal-table tbody tr");
    const trades = _pairTrades().filter((t) => _inRange(t.close_ts, journalState.view, journalState.date));
    trades.sort((a, b) => new Date(b.close_ts) - new Date(a.close_ts));
    rows.forEach((tr, i) => {
        const t = trades[i];
        if (!t || !t.open_ts) return;
        const days = (new Date(t.close_ts) - new Date(t.open_ts)) / (86400 * 1000);
        const taxFree = days >= 365;
        const badgeCls = taxFree ? "tax-free" : "tax-owed";
        const badgeTxt = taxFree ? "§23 steuerfrei" : `${Math.round(days)}d — steuerpflichtig`;
        const sideCell = tr.children[2];
        if (sideCell && !sideCell.querySelector(".tax-hint")) {
            sideCell.insertAdjacentHTML("beforeend", ` <span class="tax-hint ${badgeCls}" title="Haltedauer ${Math.round(days)} Tage">${badgeTxt}</span>`);
        }
    });
}

// ============ v6: MANUAL ORDER MODAL ============
let _orderState = { symbol: null, side: "long", pctOfCash: 5 };
function openManualOrderModal(symbol) {
    _orderState = { symbol, side: "long", pctOfCash: 5 };
    const modal = $("#order-modal");
    $("#order-title").textContent = `Manueller Trade · ${symbol}`;
    renderOrderModal();
    modal.classList.remove("hidden");
}

function renderOrderModal() {
    const body = $("#order-body");
    const price = state.prices[_orderState.symbol] || 0;
    const eq = broker.equity(state.prices);
    const notional = broker.cash * _orderState.pctOfCash / 100;
    const qty = notional / (price || 1);
    const candles = state.candles[_orderState.symbol];
    let atrPct = 2;
    if (candles && candles.length >= 20) {
        const atrArr = window.TB.atr(window.TB.highs(candles), window.TB.lows(candles), window.TB.closes(candles), 14);
        atrPct = (atrArr[atrArr.length - 1] / price) * 100;
    }
    const stopPct = atrPct * CFG.atrStopMult;
    const stop = _orderState.side === "long" ? price * (1 - stopPct / 100) : price * (1 + stopPct / 100);
    const risk = Math.abs(price - stop) * qty;
    const tp1 = _orderState.side === "long" ? price + (price - stop) * CFG.tpMultiples[0] : price - (stop - price) * CFG.tpMultiples[0];
    body.innerHTML = `
        <div class="order-form">
            <div style="font-size:0.82rem; color:var(--muted); margin-bottom:6px;">Live-Preis <strong style="color:var(--text)">${fmt(price, 4)} USDT</strong> · Cash <strong style="color:var(--text)">${fmt(broker.cash, 2)}</strong></div>
            <label>Richtung</label>
            <div class="side-buttons">
                <button type="button" class="${_orderState.side === "long" ? "on long" : ""}" id="ord-long">▲ LONG</button>
                <button type="button" class="${_orderState.side === "short" ? "on short" : ""}" id="ord-short">▼ SHORT</button>
            </div>
            <label>Grösse (% des Cash) — <strong style="color:var(--text)">${_orderState.pctOfCash}%</strong></label>
            <input type="range" min="1" max="20" step="1" value="${_orderState.pctOfCash}" id="ord-pct" class="pct-slider"/>
            <div class="order-preview">
                <div class="row"><span>Notional</span><strong class="num">${fmt(notional, 2)} USDT</strong></div>
                <div class="row"><span>Menge</span><strong class="num">${fmt(qty, 6)}</strong></div>
                <div class="row"><span>Stop-Loss (${stopPct.toFixed(2)}%)</span><strong class="num" style="color:var(--red)">${fmt(stop, 4)}</strong></div>
                <div class="row"><span>Max Verlust</span><strong class="num" style="color:var(--red)">-${fmt(risk, 2)} USDT</strong></div>
                <div class="row" style="border-bottom:none;"><span>TP1 (${CFG.tpMultiples[0]}R)</span><strong class="num" style="color:var(--green)">${fmt(tp1, 4)}</strong></div>
            </div>
        </div>`;
    $("#ord-long").onclick = () => { _orderState.side = "long"; renderOrderModal(); };
    $("#ord-short").onclick = () => { _orderState.side = "short"; renderOrderModal(); };
    $("#ord-pct").oninput = (e) => { _orderState.pctOfCash = parseInt(e.target.value); renderOrderModal(); };
}

function submitManualOrder() {
    const price = state.prices[_orderState.symbol] || 0;
    if (!price) { alert("Kein Live-Preis verfügbar."); return; }
    const notional = broker.cash * _orderState.pctOfCash / 100;
    const qty = notional / price;
    const candles = state.candles[_orderState.symbol];
    let atrVal = price * 0.02;
    if (candles && candles.length >= 20) {
        const atrArr = window.TB.atr(window.TB.highs(candles), window.TB.lows(candles), window.TB.closes(candles), 14);
        atrVal = atrArr[atrArr.length - 1];
    }
    const stop = _orderState.side === "long" ? price - atrVal * CFG.atrStopMult : price + atrVal * CFG.atrStopMult;
    const tps = CFG.tpMultiples.map((m, i) => ({
        price: _orderState.side === "long" ? price + (price - stop) * m : price - (stop - price) * m,
        fraction: i === CFG.tpMultiples.length - 1 ? 1 / CFG.tpMultiples.length : 1 / CFG.tpMultiples.length,
    }));
    broker.submit(_orderState.symbol, _orderState.side, qty, price, {
        stop, take_profits: tps, strategy: "manual",
    });
    $("#order-modal").classList.add("hidden");
    announce(`Manueller ${_orderState.side === "long" ? "Kauf" : "Verkauf"} ausgeführt: ${_orderState.symbol} bei ${price.toFixed(2)}.`, "success");
    renderAll();
}

// ============ v6: PARTIAL CLOSE MODAL ============
let _partialState = { symbol: null, pct: 50 };
function openPartialCloseModal(symbol) {
    _partialState = { symbol, pct: 50 };
    renderPartialClose();
    $("#close-modal").classList.remove("hidden");
}
function renderPartialClose() {
    const p = broker.positions[_partialState.symbol];
    if (!p) return;
    const price = state.prices[_partialState.symbol] || p.entry;
    const closeQty = p.qty * _partialState.pct / 100;
    const pnl = p.side === "long" ? (price - p.entry) * closeQty : (p.entry - price) * closeQty;
    $("#close-body").innerHTML = `
        <div style="font-size:0.82rem; color:var(--muted);">${_partialState.symbol} · ${p.side.toUpperCase()} · Menge <strong style="color:var(--text)">${fmt(p.qty, 6)}</strong></div>
        <div class="pct-value">${_partialState.pct}%</div>
        <input type="range" min="10" max="100" step="5" value="${_partialState.pct}" id="close-pct" class="pct-slider"/>
        <div style="display:flex; justify-content:space-between; margin-top:4px; color:var(--muted); font-size:0.7rem;">
            <span>10%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
        </div>
        <div class="pct-preview">
            <div class="row"><span>Zu schliessende Menge</span><strong class="num">${fmt(closeQty, 6)}</strong></div>
            <div class="row"><span>Erlös bei ${fmt(price, 4)}</span><strong class="num">${fmt(closeQty * price, 2)} USDT</strong></div>
            <div class="row"><span>Realisierter PnL</span><strong class="num" style="color:${pnl >= 0 ? "var(--green)" : "var(--red)"}">${pnl >= 0 ? "+" : ""}${fmt(pnl, 2)} USDT</strong></div>
            <div class="row" style="border-bottom:none;"><span>Rest-Menge</span><strong class="num">${fmt(p.qty - closeQty, 6)}</strong></div>
        </div>`;
    $("#close-pct").oninput = (e) => { _partialState.pct = parseInt(e.target.value); renderPartialClose(); };
}
function submitPartialClose() {
    const p = broker.positions[_partialState.symbol];
    if (!p) return;
    const price = state.prices[_partialState.symbol] || p.entry;
    const r = broker.close(_partialState.symbol, price, _partialState.pct / 100);
    $("#close-modal").classList.add("hidden");
    if (r) announce(`${_partialState.pct}% von ${_partialState.symbol} geschlossen. ${r.pnl >= 0 ? "Gewinn" : "Verlust"} ${Math.abs(r.pnl).toFixed(2)} Dollar.`, r.pnl >= 0 ? "success" : "warn");
    renderAll();
}

// ============ v6: PUSH NOTIFICATIONS + NTFY ============
async function requestPushPermission() {
    if (!("Notification" in window)) { alert("Dieser Browser unterstützt keine Notifications."); return; }
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
        new Notification("Trading Bot", { body: "Benachrichtigungen aktiv.", icon: "icon-192.png" });
        localStorage.setItem("tb_push", "1");
        announce("Push-Benachrichtigungen aktiviert.", "success");
    } else {
        alert("Berechtigung verweigert.");
    }
    renderToolsPanel();
}

function sendPushIfEnabled(title, body) {
    if (localStorage.getItem("tb_push") === "1" && "Notification" in window && Notification.permission === "granted") {
        try { new Notification(title, { body, icon: "icon-192.png", tag: "tb-alert" }); } catch (e) {}
    }
}

async function sendNtfy(text) {
    const topic = localStorage.getItem("tb_ntfy_topic");
    if (!topic) return;
    try {
        await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
            method: "POST", body: text,
            headers: { "Title": "Trading Bot", "Priority": "high", "Tags": "chart_with_upwards_trend" },
        });
    } catch (e) { /* silent */ }
}

// hook into announce so alerts go to push + ntfy too
const _origAnnounce = announce;
window.addEventListener("jarvis", (ev) => {
    const d = ev.detail;
    if (d && (d.level === "alert" || d.level === "success" || d.level === "warn")) {
        sendPushIfEnabled("Trading Bot", d.text);
        sendNtfy(d.text);
    }
});

// ============ v6: TOOLS PANEL (backup, push, ntfy, QR, tax report) ============
function renderToolsPanel() {
    const el = $("#tools-panel");
    if (!el) return;
    const pushState = localStorage.getItem("tb_push") === "1" ? "✓ aktiv" : "aus";
    const ntfyTopic = localStorage.getItem("tb_ntfy_topic") || "";
    el.innerHTML = `
        <div class="tools-actions">
            <button class="ghost" id="tp-export">📥 Backup exportieren</button>
            <button class="ghost" id="tp-import">📤 Backup importieren</button>
            <button class="ghost" id="tp-push">🔔 Push (${pushState})</button>
            <button class="ghost" id="tp-tax">📄 Steuerreport (Print)</button>
            <button class="ghost" id="tp-qr">📱 QR für Handy</button>
            <button class="ghost" id="tp-tour">🎓 Tour neu starten</button>
        </div>
        <input type="file" id="tp-import-file" accept=".json" style="display:none;"/>
        <div style="margin-top:12px;">
            <div style="font-size:0.72rem; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">ntfy.sh Push-Topic (optional)</div>
            <div class="ntfy-input">
                <input type="text" id="ntfy-topic" placeholder="mein-trading-topic" value="${ntfyTopic}"/>
                <button class="primary" id="ntfy-save">Speichern</button>
            </div>
            <div style="margin-top:4px; color:var(--muted); font-size:0.7rem;">
                Empfange Alerts kostenlos auf dem Handy über die ntfy-App: einfach das gleiche Topic dort abonnieren.
            </div>
        </div>
        <div id="qr-container"></div>`;
    $("#tp-export").onclick = exportBackup;
    $("#tp-import").onclick = () => $("#tp-import-file").click();
    $("#tp-import-file").onchange = (e) => { if (e.target.files[0]) importBackup(e.target.files[0]); };
    $("#tp-push").onclick = requestPushPermission;
    $("#tp-tax").onclick = openTaxReport;
    $("#tp-qr").onclick = () => renderQr(location.href);
    $("#tp-tour").onclick = () => { localStorage.removeItem("tb_onboarded"); startOnboarding(); };
    $("#ntfy-save").onclick = () => {
        const v = $("#ntfy-topic").value.trim();
        if (v) { localStorage.setItem("tb_ntfy_topic", v); sendNtfy("Trading Bot connected. Alerts kommen jetzt hierher."); announce("ntfy-Topic gespeichert.", "success"); }
        else { localStorage.removeItem("tb_ntfy_topic"); announce("ntfy deaktiviert."); }
    };
}

// ============ v6: QR CODE ============
// simple inline QR encoder (uses public API as fallback since inline QR is heavy)
function renderQr(url) {
    const el = $("#qr-container");
    if (!el) return;
    const enc = encodeURIComponent(url);
    // Use qrserver.com - free QR service, returns PNG. If unreachable fall back to plain text.
    el.innerHTML = `
        <div class="qr-wrap">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${enc}" alt="QR" style="max-width:180px; background:#fff; padding:6px; border-radius:6px;" onerror="this.parentElement.innerHTML='URL: ${url}';"/>
            <div style="margin-top:8px; font-size:0.72rem; color:var(--muted);">Scanne mit dem Handy und speichere zum Startbildschirm.</div>
            <div style="margin-top:4px; font-size:0.72rem; color:var(--text); word-break:break-all;">${url}</div>
        </div>`;
}

// ============ v6: HTML TAX REPORT (print-friendly) ============
function openTaxReport() {
    const trades = _pairTrades().filter((t) => t.open_ts);
    trades.sort((a, b) => new Date(a.close_ts) - new Date(b.close_ts));
    const total = trades.reduce((s, t) => s + t.pnl, 0);
    const wins = trades.filter((t) => t.pnl > 0);
    const losses = trades.filter((t) => t.pnl < 0);
    const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const netTaxable = trades.filter((t) => {
        const days = (new Date(t.close_ts) - new Date(t.open_ts)) / (86400 * 1000);
        return days < 365;
    }).reduce((s, t) => s + t.pnl, 0);
    const rows = trades.map((t) => {
        const days = (new Date(t.close_ts) - new Date(t.open_ts)) / (86400 * 1000);
        const taxFree = days >= 365;
        return `<tr>
            <td>${new Date(t.open_ts).toLocaleDateString("de-DE")}</td>
            <td>${new Date(t.close_ts).toLocaleDateString("de-DE")}</td>
            <td>${t.symbol}</td>
            <td>${t.side}</td>
            <td style="text-align:right;">${t.open_price.toFixed(4)}</td>
            <td style="text-align:right;">${t.close_price.toFixed(4)}</td>
            <td style="text-align:right;">${t.qty.toFixed(6)}</td>
            <td style="text-align:right;">${Math.round(days)} Tage</td>
            <td style="text-align:right; color:${t.pnl >= 0 ? "green" : "red"};">${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}</td>
            <td>${taxFree ? "§23 steuerfrei" : "steuerpflichtig"}</td>
        </tr>`;
    }).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Steuerreport § 23 EStG</title>
        <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111; max-width: 1000px; margin: auto; }
            h1 { color: #1e40af; margin-bottom: 4px; }
            .meta { color: #555; margin-bottom: 24px; font-size: 0.9rem; }
            .summary { background: #f1f5f9; padding: 16px; border-radius: 8px; margin-bottom: 24px; }
            .summary .row { display: flex; justify-content: space-between; padding: 4px 0; }
            table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
            th, td { border: 1px solid #cbd5e1; padding: 6px 8px; }
            th { background: #e2e8f0; text-align: left; }
            .footer { margin-top: 32px; color: #666; font-size: 0.8rem; border-top: 1px solid #cbd5e1; padding-top: 12px; }
            @media print { body { padding: 8px; } }
        </style></head>
        <body>
            <h1>Steuerreport für private Veräusserungsgeschäfte (§ 23 EStG)</h1>
            <div class="meta">Erstellt am ${new Date().toLocaleString("de-DE")} · Trading Bot Demo · alle Beträge in USDT</div>
            <div class="summary">
                <div class="row"><span>Trades gesamt</span><strong>${trades.length}</strong></div>
                <div class="row"><span>Bruttogewinn</span><strong>+${grossWin.toFixed(2)}</strong></div>
                <div class="row"><span>Bruttoverlust</span><strong>-${grossLoss.toFixed(2)}</strong></div>
                <div class="row"><span>Netto-PnL gesamt</span><strong>${total >= 0 ? "+" : ""}${total.toFixed(2)}</strong></div>
                <div class="row"><span>Davon steuerpflichtig (Haltedauer &lt; 1 Jahr)</span><strong>${netTaxable >= 0 ? "+" : ""}${netTaxable.toFixed(2)}</strong></div>
                <div class="row"><span>Steuerfreier Anteil (Haltedauer ≥ 1 Jahr, § 23 EStG)</span><strong>${(total - netTaxable) >= 0 ? "+" : ""}${(total - netTaxable).toFixed(2)}</strong></div>
            </div>
            <table>
                <thead><tr>
                    <th>Kauf</th><th>Verkauf</th><th>Symbol</th><th>Richtung</th>
                    <th>Kaufpreis</th><th>Verkaufspreis</th><th>Menge</th>
                    <th>Haltedauer</th><th>Gewinn/Verlust</th><th>Status</th>
                </tr></thead>
                <tbody>${rows || "<tr><td colspan='10' style='text-align:center;'>Keine Trades</td></tr>"}</tbody>
            </table>
            <div class="footer">
                Hinweis: Dieses Dokument ist eine Aufstellung aus dem Demo-Konto zur Vorbereitung auf die Anlage SO. Keine Steuerberatung. Bei Krypto-zu-Krypto-Trades und komplexen Fällen bitte Steuerberater konsultieren. Haltefristen berechnet aus dem Zeitraum Kauf–Verkauf.
            </div>
        </body></html>`;
    const win = window.open("", "_blank");
    if (!win) { alert("Popup blockiert. Bitte Popups erlauben."); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 500);
}

// ============ v6: ONBOARDING TOUR ============
const ONBOARD_STEPS = [
    { title: "Willkommen", body: "Dieser Bot handelt mit 10 000 USDT Spielgeld auf Live-Binance-Kursen. Kein echtes Geld, kein Risiko — aber alles verhält sich wie im echten Markt." },
    { title: "Live-Daten", body: "Jede Sekunde neue Preise von 30 Handelspaaren. 16 Strategien scannen parallel und bewerten jede Sekunde: kaufen, verkaufen oder halten." },
    { title: "Signale bestätigen", body: "Im Manuell-Modus zeigt der Bot Setups an und du bestätigst. Im Automatik-Modus handelt er nur bei Score ≥ 3.0 und ≥ 3 unabhängigen Signalen." },
    { title: "Kill-Switch", body: "Bei 4% Tages-Verlust oder 15% Drawdown pausiert der Bot automatisch. Der Kapitalerhalt hat immer Vorrang vor dem Gewinn." },
    { title: "Steuer-tauglich", body: "Jeder Trade wird im Journal mit Haltedauer festgehalten. Trades über 1 Jahr sind nach § 23 EStG steuerfrei. Report drucken über 'Tools'." },
    { title: "Los geht's", body: "Scroll nach unten, sieh dir die Sektionen an. Jarvis kannst du oben aktivieren — dann spricht er dir Signale auf Deutsch vor." },
];
let _obStep = 0;
function startOnboarding() {
    _obStep = 0;
    $("#onboarding").classList.remove("hidden");
    renderOnboarding();
}
function renderOnboarding() {
    const s = ONBOARD_STEPS[_obStep];
    const dots = ONBOARD_STEPS.map((_, i) => `<div class="ob-dot ${i <= _obStep ? "on" : ""}"></div>`).join("");
    $("#onboarding-step").innerHTML = `
        <div class="ob-progress">${dots}</div>
        <h3>Schritt ${_obStep + 1} von ${ONBOARD_STEPS.length}: ${s.title}</h3>
        <div>${s.body}</div>`;
    $("#ob-next").textContent = _obStep === ONBOARD_STEPS.length - 1 ? "Loslegen" : "Weiter →";
}
function checkFirstLaunch() {
    if (!localStorage.getItem("tb_onboarded")) {
        setTimeout(startOnboarding, 800);
    }
}

// ============ v6: hook manual-order into 24h ticker table ============
const _origRender24 = render24hTickers;
render24hTickers = function() {
    _origRender24();
    const el = $("#ticker24");
    if (!el) return;
    // add a "Trade" column click handler per row
    const rows = el.querySelectorAll("tbody tr");
    rows.forEach((tr, idx) => {
        const sym = CFG.symbols[idx];
        if (!sym || tr.querySelector(".ticker-trade")) return;
        const lastCell = tr.children[0];
        if (lastCell) {
            lastCell.innerHTML += ` <span class="ticker-trade" data-sym="${sym}" title="Manuell traden">+ trade</span>`;
        }
    });
    el.querySelectorAll(".ticker-trade").forEach((s) => {
        s.onclick = () => openManualOrderModal(s.dataset.sym);
    });
};

// ============ v6: bind onboarding + modal buttons ============
document.addEventListener("DOMContentLoaded", () => {
    const obNext = $("#ob-next");
    const obSkip = $("#ob-skip");
    if (obNext) obNext.onclick = () => {
        _obStep++;
        if (_obStep >= ONBOARD_STEPS.length) {
            $("#onboarding").classList.add("hidden");
            localStorage.setItem("tb_onboarded", "1");
        } else renderOnboarding();
    };
    if (obSkip) obSkip.onclick = () => {
        $("#onboarding").classList.add("hidden");
        localStorage.setItem("tb_onboarded", "1");
    };
    $("#order-cancel")?.addEventListener("click", () => $("#order-modal").classList.add("hidden"));
    $("#order-submit")?.addEventListener("click", submitManualOrder);
    $("#close-cancel")?.addEventListener("click", () => $("#close-modal").classList.add("hidden"));
    $("#close-submit")?.addEventListener("click", submitPartialClose);
});

// ============ v6: augment renderAll ============
const _origRenderAll = renderAll;
renderAll = function() {
    _origRenderAll();
    renderCorrelationMatrix();
    renderReturnHistogram();
    renderRollingMetrics();
    renderEurRow();
    renderJournalTaxHint();
};

// =====================================================================
// v7: 18 features from remaining wishlist
// =====================================================================

// ============ v7: i18n minimal EN/DE ============
const I18N = {
    "mode-manual":   { de: "Manuell",  en: "Manual" },
    "mode-auto":     { de: "Auto",     en: "Auto" },
    "buy":           { de: "KAUFEN",   en: "BUY" },
    "sell":          { de: "VERKAUFEN",en: "SELL" },
    "hold":          { de: "HALTEN",   en: "HOLD" },
    "portfolio":     { de: "Portfolio",en: "Portfolio" },
    "equity":        { de: "Equity",   en: "Equity" },
    "cash":          { de: "Cash",     en: "Cash" },
    "positions":     { de: "Positionen", en: "Positions" },
};
function currentLang() { return localStorage.getItem("tb_lang") || "de"; }
function t(key) {
    const e = I18N[key];
    if (!e) return key;
    return e[currentLang()] || e.de;
}
function applyLang() {
    const lang = currentLang();
    document.documentElement.setAttribute("lang", lang);
    document.querySelectorAll("[data-i18n]").forEach((el) => {
        el.textContent = t(el.dataset.i18n);
    });
    const btn = document.getElementById("lang-toggle");
    if (btn) btn.textContent = lang === "de" ? "🇩🇪 Deutsch (Klick → EN)" : "🇬🇧 English (Klick → DE)";
}
function initLang() {
    applyLang();
    $("#lang-toggle")?.addEventListener("click", () => {
        const next = currentLang() === "de" ? "en" : "de";
        localStorage.setItem("tb_lang", next);
        applyLang();
    });
}

// ============ v7: LIMIT ORDERS ============
state.limitOrders = JSON.parse(localStorage.getItem("tb_limits") || "[]");
function saveLimits() { localStorage.setItem("tb_limits", JSON.stringify(state.limitOrders)); }
function addLimitOrder(sym, side, price, notional) {
    state.limitOrders.push({
        id: sym + "_" + Date.now(), symbol: sym, side, price, notional,
        created: new Date().toISOString(), filled: false,
    });
    saveLimits();
    announce(`Limit-Order gesetzt: ${sym} ${side === "long" ? "≤" : "≥"} ${price}`, "info");
}
function cancelLimit(id) {
    state.limitOrders = state.limitOrders.filter((l) => l.id !== id);
    saveLimits();
    renderLimitOrders();
}
function checkLimitOrders() {
    for (const l of state.limitOrders) {
        if (l.filled) continue;
        const p = state.prices[l.symbol];
        if (!p) continue;
        const hit = (l.side === "long" && p <= l.price) || (l.side === "short" && p >= l.price);
        if (hit) {
            const qty = l.notional / p;
            const candles = state.candles[l.symbol];
            let atrVal = p * 0.02;
            if (candles && candles.length >= 20) {
                const arr = window.TB.atr(window.TB.highs(candles), window.TB.lows(candles), window.TB.closes(candles), 14);
                atrVal = arr[arr.length - 1];
            }
            const stop = l.side === "long" ? p - atrVal * CFG.atrStopMult : p + atrVal * CFG.atrStopMult;
            const tps = CFG.tpMultiples.map((m) => ({
                price: l.side === "long" ? p + (p - stop) * m : p - (stop - p) * m,
                fraction: 1 / CFG.tpMultiples.length,
            }));
            broker.submit(l.symbol, l.side, qty, p, { stop, take_profits: tps, strategy: "limit_order" });
            l.filled = true;
            l.filled_at = new Date().toISOString();
            l.exec_price = p;
            saveLimits();
            announce(`Limit-Order gefüllt: ${l.symbol} ${l.side === "long" ? "gekauft" : "verkauft"} bei ${p.toFixed(2)}`, "success");
        }
    }
}
function renderLimitOrders() {
    const el = $("#limit-list");
    if (!el) return;
    $("#limit-count").textContent = state.limitOrders.filter((l) => !l.filled).length + " offen";
    if (!state.limitOrders.length) { el.textContent = "keine Limit-Orders"; return; }
    el.innerHTML = state.limitOrders.slice().reverse().map((l) => {
        const live = state.prices[l.symbol];
        const dist = live ? ((l.price - live) / live * 100) : null;
        return `<div class="lim-row ${l.filled ? "filled" : "armed"}">
            <div>
                <strong>${l.symbol}</strong> ${l.side === "long" ? "▲ LONG" : "▼ SHORT"} @ <span class="num">${l.price}</span>
                <div style="color:var(--muted); font-size:0.72rem;">
                    ${l.filled ? `✓ gefüllt bei ${l.exec_price?.toFixed(4)}` : `Distanz ${dist != null ? (dist > 0 ? "+" : "") + dist.toFixed(2) + "%" : "?"} · Notional ${l.notional} USDT`}
                </div>
            </div>
            <div class="num" style="color:var(--muted); font-size:0.72rem;">${live ? live.toFixed(4) : "–"}</div>
            ${l.filled ? "" : `<button class="lim-cancel" data-id="${l.id}">✕</button>`}
        </div>`;
    }).join("");
    el.querySelectorAll(".lim-cancel").forEach((b) => b.onclick = () => cancelLimit(b.dataset.id));
}

// ============ v7: DCA SCHEDULER ============
state.dca = JSON.parse(localStorage.getItem("tb_dca") || '{"enabled":false,"amount":100,"coins":["BTC/USDT","ETH/USDT","BNB/USDT"],"rsiCap":30,"lastRun":0}');
function saveDca() { localStorage.setItem("tb_dca", JSON.stringify(state.dca)); }
function renderDcaPanel() {
    const el = $("#dca-panel");
    if (!el) return;
    const nextRun = state.dca.lastRun ? new Date(state.dca.lastRun + 7 * 86400 * 1000).toLocaleString("de-DE") : "beim nächsten Scan";
    el.innerHTML = `
        <div class="toggle-row" style="margin-bottom:8px;">
            <div class="lbl"><strong>DCA-Sparplan ${state.dca.enabled ? "aktiv" : "inaktiv"}</strong></div>
            <div id="dca-toggle" class="toggle ${state.dca.enabled ? "on" : ""}"></div>
        </div>
        <div class="dca-config">
            <div>
                <label>Betrag pro Woche (USDT)</label>
                <input type="number" id="dca-amount" value="${state.dca.amount}" min="10" step="10"/>
            </div>
            <div>
                <label>RSI-Cap (nur kaufen wenn RSI &lt; X)</label>
                <input type="number" id="dca-rsi" value="${state.dca.rsiCap}" min="10" max="100" step="5"/>
            </div>
        </div>
        <div style="margin-top:8px; font-size:0.72rem; color:var(--muted);">
            Coins: ${state.dca.coins.join(", ")}<br>
            ${state.dca.enabled ? `Nächster mögl. Kauf: ${nextRun}` : "Umschalter aktivieren um zu starten"}
        </div>`;
    $("#dca-toggle")?.addEventListener("click", () => {
        state.dca.enabled = !state.dca.enabled;
        saveDca(); renderDcaPanel();
        announce(state.dca.enabled ? "DCA-Sparplan aktiv." : "DCA-Sparplan aus.");
    });
    $("#dca-amount")?.addEventListener("change", (e) => { state.dca.amount = parseInt(e.target.value) || 100; saveDca(); });
    $("#dca-rsi")?.addEventListener("change", (e) => { state.dca.rsiCap = parseInt(e.target.value) || 30; saveDca(); });
}
function runDcaCheck() {
    if (!state.dca.enabled) return;
    if (Date.now() - state.dca.lastRun < 7 * 86400 * 1000) return;
    for (const sym of state.dca.coins) {
        const candles = state.candles[sym];
        if (!candles || candles.length < 30) continue;
        const rsi = window.TB.rsi(window.TB.closes(candles), 14);
        const rsiNow = rsi[rsi.length - 1];
        if (!isFinite(rsiNow) || rsiNow >= state.dca.rsiCap) continue;
        const price = state.prices[sym] || candles[candles.length - 1].close;
        const qty = state.dca.amount / price;
        broker.submit(sym, "long", qty, price, {
            stop: price * 0.5,          // DCA-hold: very wide stop = essentially none
            take_profits: [],
            strategy: "dca_buffett",
        });
        announce(`DCA-Kauf: ${state.dca.amount} USDT ${sym} bei RSI ${rsiNow.toFixed(0)}.`, "success");
    }
    state.dca.lastRun = Date.now();
    saveDca();
}

// ============ v7: GRID TRADING ============
state.grids = JSON.parse(localStorage.getItem("tb_grids") || "[]");
function saveGrids() { localStorage.setItem("tb_grids", JSON.stringify(state.grids)); }
function renderGridPanel() {
    const el = $("#grid-panel");
    if (!el) return;
    el.innerHTML = `
        <div class="dca-config">
            <div>
                <label>Symbol</label>
                <select id="grid-sym">${ALL_SYMBOLS.map((s) => `<option value="${s}">${s}</option>`).join("")}</select>
            </div>
            <div>
                <label>Range ± % um Live-Preis</label>
                <input type="number" id="grid-range" value="4" min="1" max="20" step="0.5"/>
            </div>
            <div>
                <label>Anzahl Levels je Seite</label>
                <input type="number" id="grid-levels" value="5" min="2" max="20"/>
            </div>
            <div>
                <label>Notional pro Level (USDT)</label>
                <input type="number" id="grid-notional" value="50" min="10" step="10"/>
            </div>
        </div>
        <div class="btn-row" style="margin-top:8px;">
            <button id="grid-create" class="primary">Grid erzeugen</button>
        </div>
        <div id="grid-list" style="margin-top:10px;"></div>`;
    $("#grid-create").onclick = () => {
        const sym = $("#grid-sym").value;
        const range = parseFloat($("#grid-range").value) / 100;
        const levels = parseInt($("#grid-levels").value);
        const notional = parseFloat($("#grid-notional").value);
        const p = state.prices[sym];
        if (!p) { alert("Kein Live-Preis für " + sym); return; }
        // create limit orders at N buy levels below and N sell above
        for (let i = 1; i <= levels; i++) {
            const buyPrice = p * (1 - range * i / levels);
            const sellPrice = p * (1 + range * i / levels);
            addLimitOrder(sym, "long", parseFloat(buyPrice.toFixed(4)), notional);
            addLimitOrder(sym, "short", parseFloat(sellPrice.toFixed(4)), notional);
        }
        state.grids.push({ id: "g_" + Date.now(), symbol: sym, center: p, range, levels, notional, created: new Date().toISOString() });
        saveGrids();
        renderGridList();
        renderLimitOrders();
        announce(`Grid für ${sym} erzeugt: ${levels * 2} Limit-Orders um ${p.toFixed(2)}.`, "success");
    };
    renderGridList();
}
function renderGridList() {
    const el = $("#grid-list");
    if (!el) return;
    if (!state.grids.length) { el.textContent = "keine aktiven Grids"; return; }
    el.innerHTML = state.grids.map((g) => `
        <div class="grid-row">
            <div>
                <strong>${g.symbol}</strong> · Center ${g.center.toFixed(4)} · ±${(g.range * 100).toFixed(1)}%
                <div style="color:var(--muted); font-size:0.72rem;">${g.levels} Levels · ${g.notional} USDT/Level</div>
            </div>
            <div class="num" style="color:var(--muted); font-size:0.72rem;">${new Date(g.created).toLocaleDateString("de-DE")}</div>
            <button class="lim-cancel" data-id="${g.id}">✕</button>
        </div>`).join("");
    el.querySelectorAll(".lim-cancel").forEach((b) => b.onclick = () => {
        state.grids = state.grids.filter((g) => g.id !== b.dataset.id);
        saveGrids(); renderGridList();
    });
}

// ============ v7: PORTFOLIO REBALANCING ============
state.rebalance = JSON.parse(localStorage.getItem("tb_rebalance") || '{"enabled":false,"targets":{"BTC/USDT":30,"ETH/USDT":20,"SOL/USDT":10},"tolerancePct":5}');
function saveRebalance() { localStorage.setItem("tb_rebalance", JSON.stringify(state.rebalance)); }
function renderRebalancePanel() {
    const el = $("#rebalance-panel");
    if (!el) return;
    const eq = broker.equity(state.prices);
    const positions = broker.positions;
    const currentPct = {};
    for (const sym in positions) {
        const p = positions[sym];
        const price = state.prices[sym] || p.entry;
        const value = p.side === "long" ? p.qty * price : 0;
        currentPct[sym] = value / eq * 100;
    }
    const rows = Object.entries(state.rebalance.targets).map(([sym, target]) => {
        const actual = currentPct[sym] || 0;
        const diff = actual - target;
        const off = Math.abs(diff) > state.rebalance.tolerancePct;
        return `<div class="reb-row">
            <div>
                <strong>${sym}</strong>
                <div style="color:var(--muted); font-size:0.72rem;">Ziel ${target}% · Ist ${actual.toFixed(1)}%</div>
            </div>
            <div class="num" style="color:${off ? "var(--amber)" : "var(--green)"};">${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%</div>
            <button class="lim-cancel" data-sym="${sym}">✕</button>
        </div>`;
    }).join("");
    el.innerHTML = `
        <div class="toggle-row" style="margin-bottom:8px;">
            <div class="lbl"><strong>Auto-Rebalancing ${state.rebalance.enabled ? "aktiv" : "inaktiv"}</strong> · Toleranz ±${state.rebalance.tolerancePct}%</div>
            <div id="reb-toggle" class="toggle ${state.rebalance.enabled ? "on" : ""}"></div>
        </div>
        ${rows}
        <div class="dca-config" style="margin-top:8px;">
            <div>
                <label>Symbol</label>
                <select id="reb-add-sym">${ALL_SYMBOLS.map((s) => `<option value="${s}">${s}</option>`).join("")}</select>
            </div>
            <div>
                <label>Ziel-Anteil %</label>
                <input type="number" id="reb-add-pct" value="10" min="1" max="80" step="1"/>
            </div>
        </div>
        <div class="btn-row" style="margin-top:6px;">
            <button id="reb-add" class="primary">+ Ziel hinzufügen</button>
            <button id="reb-run" class="ghost">Jetzt rebalancieren</button>
        </div>`;
    $("#reb-toggle")?.addEventListener("click", () => {
        state.rebalance.enabled = !state.rebalance.enabled;
        saveRebalance(); renderRebalancePanel();
    });
    $("#reb-add")?.addEventListener("click", () => {
        state.rebalance.targets[$("#reb-add-sym").value] = parseFloat($("#reb-add-pct").value);
        saveRebalance(); renderRebalancePanel();
    });
    $("#reb-run")?.addEventListener("click", () => runRebalance(true));
    el.querySelectorAll(".lim-cancel").forEach((b) => b.onclick = () => {
        delete state.rebalance.targets[b.dataset.sym];
        saveRebalance(); renderRebalancePanel();
    });
}
function runRebalance(force = false) {
    if (!force && !state.rebalance.enabled) return;
    const eq = broker.equity(state.prices);
    for (const [sym, targetPct] of Object.entries(state.rebalance.targets)) {
        const price = state.prices[sym];
        if (!price) continue;
        const targetValue = eq * targetPct / 100;
        const pos = broker.positions[sym];
        const currentValue = pos && pos.side === "long" ? pos.qty * price : 0;
        const diff = targetValue - currentValue;
        if (Math.abs(diff) < eq * state.rebalance.tolerancePct / 100) continue;
        if (diff > 0 && diff > 20) {
            // need to buy more
            const qty = Math.min(diff, broker.cash * 0.9) / price;
            if (qty > 0) {
                broker.submit(sym, "long", qty, price, { stop: price * 0.5, take_profits: [], strategy: "rebalance" });
                announce(`Rebalance: ${sym} +${qty.toFixed(4)} bei ${price.toFixed(2)}.`, "info");
            }
        } else if (diff < -20 && pos && pos.side === "long") {
            const closePct = Math.min(1, Math.abs(diff) / currentValue);
            broker.close(sym, price, closePct);
            announce(`Rebalance: ${sym} -${(closePct * 100).toFixed(0)}% bei ${price.toFixed(2)}.`, "info");
        }
    }
    renderAll();
}

// ============ v7: PAIR TRADING (BTC/ETH ratio) ============
state.pairTrading = JSON.parse(localStorage.getItem("tb_pair") || '{"enabled":false,"longSym":"ETH/USDT","shortSym":"BTC/USDT","zEntry":2.0,"zExit":0.5,"notional":500}');
function savePair() { localStorage.setItem("tb_pair", JSON.stringify(state.pairTrading)); }
function computePairZScore() {
    const a = state.candles[state.pairTrading.longSym];
    const b = state.candles[state.pairTrading.shortSym];
    if (!a || !b || a.length < 100 || b.length < 100) return null;
    const ratios = [];
    const n = Math.min(100, a.length, b.length);
    for (let i = 1; i <= n; i++) {
        const ac = a[a.length - i].close, bc = b[b.length - i].close;
        if (bc > 0) ratios.unshift(ac / bc);
    }
    if (ratios.length < 30) return null;
    const mean = ratios.reduce((s, v) => s + v, 0) / ratios.length;
    const std = Math.sqrt(ratios.reduce((s, v) => s + (v - mean) ** 2, 0) / ratios.length);
    const current = ratios[ratios.length - 1];
    const z = std > 0 ? (current - mean) / std : 0;
    return { current, mean, std, z };
}
function renderPairPanel() {
    const el = $("#pair-panel");
    if (!el) return;
    const z = computePairZScore();
    el.innerHTML = `
        <div class="toggle-row" style="margin-bottom:8px;">
            <div class="lbl"><strong>Auto-Pair-Trading ${state.pairTrading.enabled ? "aktiv" : "inaktiv"}</strong></div>
            <div id="pair-toggle" class="toggle ${state.pairTrading.enabled ? "on" : ""}"></div>
        </div>
        <div class="dca-config">
            <div><label>Long-Symbol</label>
                <select id="pair-long">${CFG.symbols.map((s) => `<option value="${s}" ${s === state.pairTrading.longSym ? "selected" : ""}>${s}</option>`).join("")}</select>
            </div>
            <div><label>Short-Symbol</label>
                <select id="pair-short">${CFG.symbols.map((s) => `<option value="${s}" ${s === state.pairTrading.shortSym ? "selected" : ""}>${s}</option>`).join("")}</select>
            </div>
            <div><label>Z-Score-Entry (|z| ≥)</label>
                <input type="number" id="pair-zentry" value="${state.pairTrading.zEntry}" step="0.5" min="1" max="4"/>
            </div>
            <div><label>Z-Score-Exit (|z| ≤)</label>
                <input type="number" id="pair-zexit" value="${state.pairTrading.zExit}" step="0.1" min="0" max="1"/>
            </div>
        </div>
        ${z ? `<div class="pct-preview" style="margin-top:8px;">
            <div class="row"><span>Ratio ${state.pairTrading.longSym.replace("/USDT","")} / ${state.pairTrading.shortSym.replace("/USDT","")}</span><strong class="num">${z.current.toFixed(4)}</strong></div>
            <div class="row"><span>Mean</span><strong class="num">${z.mean.toFixed(4)}</strong></div>
            <div class="row"><span>Std-Abw.</span><strong class="num">${z.std.toFixed(4)}</strong></div>
            <div class="row" style="border-bottom:none;"><span>Z-Score</span><strong class="num" style="color:${Math.abs(z.z) >= state.pairTrading.zEntry ? "var(--amber)" : "var(--muted)"};">${z.z >= 0 ? "+" : ""}${z.z.toFixed(2)}σ ${Math.abs(z.z) >= state.pairTrading.zEntry ? "→ Signal" : "→ warten"}</strong></div>
        </div>` : `<div style="color:var(--muted); font-size:0.78rem; margin-top:8px;">Ratio-Daten werden geladen …</div>`}
    `;
    $("#pair-toggle")?.addEventListener("click", () => { state.pairTrading.enabled = !state.pairTrading.enabled; savePair(); renderPairPanel(); });
    $("#pair-long")?.addEventListener("change", (e) => { state.pairTrading.longSym = e.target.value; savePair(); renderPairPanel(); });
    $("#pair-short")?.addEventListener("change", (e) => { state.pairTrading.shortSym = e.target.value; savePair(); renderPairPanel(); });
    $("#pair-zentry")?.addEventListener("change", (e) => { state.pairTrading.zEntry = parseFloat(e.target.value); savePair(); });
    $("#pair-zexit")?.addEventListener("change", (e) => { state.pairTrading.zExit = parseFloat(e.target.value); savePair(); });
}
function runPairCheck() {
    if (!state.pairTrading.enabled) return;
    const z = computePairZScore();
    if (!z) return;
    const { longSym, shortSym, zEntry, zExit, notional } = state.pairTrading;
    const pairKey = `pair_${longSym}_${shortSym}`;
    const openLong = broker.positions[longSym]?.meta?.pairKey === pairKey;
    const openShort = broker.positions[shortSym]?.meta?.pairKey === pairKey;
    const inPair = openLong || openShort;
    if (inPair && Math.abs(z.z) <= zExit) {
        // exit: close both
        if (openLong) broker.close(longSym, state.prices[longSym], 1);
        if (openShort) broker.close(shortSym, state.prices[shortSym], 1);
        announce(`Pair-Trade geschlossen: Ratio zurück zu z ${z.z.toFixed(2)}σ.`, "success");
        return;
    }
    if (!inPair && Math.abs(z.z) >= zEntry) {
        // enter: if ratio HIGH (z > 0), long is expensive → short LONG, long SHORT_sym... wait naming is confusing
        // z > 0 means longSym is expensive relative to shortSym. So we SHORT longSym, LONG shortSym.
        // z < 0 means longSym is cheap → LONG longSym, SHORT shortSym.
        const dirLong = z.z >= 0 ? "short" : "long";
        const dirShort = z.z >= 0 ? "long" : "short";
        const priceL = state.prices[longSym], priceS = state.prices[shortSym];
        if (!priceL || !priceS) return;
        broker.submit(longSym, dirLong, notional / priceL, priceL, {
            stop: dirLong === "long" ? priceL * 0.9 : priceL * 1.1, take_profits: [],
            strategy: "pair_trade", pairKey,
        });
        broker.submit(shortSym, dirShort, notional / priceS, priceS, {
            stop: dirShort === "long" ? priceS * 0.9 : priceS * 1.1, take_profits: [],
            strategy: "pair_trade", pairKey,
        });
        announce(`Pair-Trade eröffnet: ${longSym.replace("/USDT","")} ${dirLong}, ${shortSym.replace("/USDT","")} ${dirShort} bei z=${z.z.toFixed(2)}.`, "success");
    }
}

// ============ v7: MACRO CALENDAR ============
function renderEconCalendar() {
    const el = $("#econ-calendar");
    if (!el) return;
    const events = window.TB.economicCalendar().slice(0, 12);
    if (!events.length) { el.textContent = "keine Termine"; return; }
    el.innerHTML = events.map((e) => {
        const now = Date.now();
        const diff = e.ts - now;
        const imminent = diff < 24 * 3600 * 1000 && diff > -6 * 3600 * 1000;
        let cd;
        if (diff < 0) cd = "läuft/vorbei";
        else if (diff < 3600 * 1000) cd = `in ${Math.round(diff / 60000)} min`;
        else if (diff < 24 * 3600 * 1000) cd = `in ${Math.round(diff / 3600000)} h`;
        else cd = `in ${Math.round(diff / 86400000)} T`;
        return `<div class="econ-row ${imminent ? "imminent" : ""}">
            <span class="econ-badge ${e.type}">${e.type}</span>
            <div>${e.desc}<div style="color:var(--muted); font-size:0.7rem;">${new Date(e.ts).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</div></div>
            <div class="econ-countdown">${cd}</div>
        </div>`;
    }).join("");
}

// ============ v7: WHALE TRANSFERS ============
async function refreshWhales() {
    const w = await window.TB.fetchWhaleTransfers();
    state.whales = w;
    renderWhaleList();
}
function renderWhaleList() {
    const el = $("#whale-list");
    if (!el) return;
    const w = state.whales || [];
    if (!w.length) { el.textContent = "aktuell keine grossen Bewegungen im Mempool"; return; }
    el.innerHTML = w.map((t) => `
        <div class="whale-row">
            <div><strong>${t.btc.toFixed(2)} BTC</strong><div style="color:var(--muted); font-size:0.7rem;">Fee ${t.fee} sat</div></div>
            <a href="${t.url}" target="_blank" rel="noopener">${t.txid.slice(0, 12)}…</a>
        </div>`).join("");
}

// ============ v7: ALPHA DECAY ============
function renderAlphaDecay() {
    const el = $("#alpha-decay");
    if (!el) return;
    const trades = _pairTrades();
    if (trades.length < 10) { el.textContent = "warten auf ≥ 10 abgeschlossene Trades"; return; }
    const byStrat = {};
    for (const t of trades) {
        for (const s of (t.strategy || "").split(",").filter(Boolean)) {
            (byStrat[s] = byStrat[s] || []).push(t);
        }
    }
    const rows = Object.entries(byStrat)
        .filter(([, ts]) => ts.length >= 5)
        .map(([strat, ts]) => {
            const buckets = window.TB.alphaDecayBuckets(ts, 10);
            if (!buckets.length) return "";
            const maxAbs = Math.max(...buckets.map((b) => Math.abs(b.meanPnl)), 0.01);
            const bars = buckets.map((b) => {
                const h = Math.max(6, Math.abs(b.meanPnl) / maxAbs * 100);
                const cls = b.meanPnl >= 0 ? "pos" : "neg";
                return `<div class="decay-bar ${cls}" style="height:${h}%;" title="${b.count} Trades · Mean ${b.meanPnl.toFixed(2)} USDT · WR ${(b.winRate*100).toFixed(0)}%"></div>`;
            }).join("");
            // trend: first bucket vs last
            const first = buckets[0].meanPnl;
            const last = buckets[buckets.length - 1].meanPnl;
            const trend = last - first;
            const trendCls = trend > 0.5 ? "up" : trend < -0.5 ? "down" : "flat";
            const trendTxt = trend > 0.5 ? "↗ verbessert sich" : trend < -0.5 ? "↘ verliert Edge" : "→ stabil";
            return `<div class="decay-strategy">
                <div class="head">
                    <span>${strat.replace(/_/g, " ")} <small style="color:var(--muted);">(${ts.length} Trades)</small></span>
                    <span class="decay-trend ${trendCls}">${trendTxt}</span>
                </div>
                <div class="decay-bars">${bars}</div>
            </div>`;
        }).join("");
    el.innerHTML = rows || "noch nicht genug Trades pro Strategie (min. 5)";
}

// ============ v7: FIFO/LIFO — override _pairTrades ============
const _origPairTrades = _pairTrades;
_pairTrades = function() {
    const method = localStorage.getItem("tb_journal_method") || "fifo";
    return window.TB.matchTradesFifo(broker.journal, method);
};

// ============ v7: NORMAL OVERLAY ON HISTOGRAM ============
const _origRenderHist = renderReturnHistogram;
renderReturnHistogram = function() {
    _origRenderHist();
    const el = $("#return-hist");
    if (!el) return;
    const trades = _pairTrades();
    if (trades.length < 10) return;
    const pnls = trades.map((t) => t.pnl);
    const mean = pnls.reduce((s, v) => s + v, 0) / pnls.length;
    const std = Math.sqrt(pnls.reduce((s, v) => s + (v - mean) ** 2, 0) / pnls.length);
    const min = Math.min(...pnls), max = Math.max(...pnls);
    const bars = el.querySelectorAll(".hist-bar");
    if (!bars.length) return;
    const barsContainer = el.querySelector(".hist-bars");
    if (!barsContainer) return;
    // build overlay SVG
    const w = 400, h = 120;
    const range = max - min || 1;
    const points = [];
    // find max pdf value across our range for normalisation
    let maxPdf = 0;
    for (let i = 0; i < 100; i++) {
        const x = min + (i / 99) * range;
        const y = window.TB.normalPdf(x, mean, std);
        if (y > maxPdf) maxPdf = y;
    }
    for (let i = 0; i < 100; i++) {
        const x = min + (i / 99) * range;
        const y = window.TB.normalPdf(x, mean, std);
        const px = (i / 99) * w;
        const py = h - (maxPdf > 0 ? (y / maxPdf) * h * 0.9 : 0);
        points.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    }
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:relative; margin-top:-128px; margin-bottom:8px; pointer-events:none;";
    overlay.innerHTML = `<svg class="hist-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <polyline class="hist-normal-line" points="${points.join(" ")}"/>
    </svg>`;
    barsContainer.after(overlay);
};

// ============ v7: TELEGRAM + EMAIL + INTEGRATIONS ============
function getIntegrations() {
    return {
        tgToken: localStorage.getItem("tb_tg_token") || "",
        tgChat: localStorage.getItem("tb_tg_chat") || "",
        emailService: localStorage.getItem("tb_email_service") || "",
        emailTemplate: localStorage.getItem("tb_email_template") || "",
        emailKey: localStorage.getItem("tb_email_key") || "",
        emailTo: localStorage.getItem("tb_email_to") || "",
    };
}
async function sendTelegram(text) {
    const { tgToken, tgChat } = getIntegrations();
    if (!tgToken || !tgChat) return;
    try {
        await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: tgChat, text, parse_mode: "HTML" }),
        });
    } catch (e) { /* silent */ }
}
async function sendEmail(subject, body) {
    const { emailService, emailTemplate, emailKey, emailTo } = getIntegrations();
    if (!emailService || !emailTemplate || !emailKey || !emailTo) return;
    try {
        await fetch("https://api.emailjs.com/api/v1.0/email/send", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                service_id: emailService, template_id: emailTemplate, user_id: emailKey,
                template_params: { subject, message: body, to_email: emailTo },
            }),
        });
    } catch (e) { /* silent */ }
}
window.addEventListener("jarvis", (ev) => {
    const d = ev.detail;
    if (d && (d.level === "alert" || d.level === "success")) {
        sendTelegram(`🤖 <b>Trading Bot</b>\n${d.text}`);
        sendEmail("Trading Bot Alert", d.text);
    }
});

function renderIntegrationsPanel() {
    const el = $("#integrations-panel");
    if (!el) return;
    const cfg = getIntegrations();
    const tgOn = cfg.tgToken && cfg.tgChat;
    const emOn = cfg.emailService && cfg.emailKey && cfg.emailTo;
    el.innerHTML = `
        <div class="integ-row">
            <div class="head">Telegram-Bot <span class="integ-status ${tgOn ? "on" : "off"}">${tgOn ? "aktiv" : "aus"}</span></div>
            <div style="color:var(--muted); font-size:0.72rem;">
                1. Chat mit @BotFather auf Telegram · /newbot · Token kopieren.<br>
                2. Bot anschreiben, dann <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> aufrufen → Chat-ID auslesen.
            </div>
            <input type="text" id="tg-token" placeholder="Bot-Token (123456:ABC-DEF...)" value="${cfg.tgToken}"/>
            <input type="text" id="tg-chat" placeholder="Chat-ID (z.B. 123456789)" value="${cfg.tgChat}"/>
            <div class="btn-row">
                <button class="primary" id="tg-save">Speichern</button>
                <button class="ghost" id="tg-test">Test-Message</button>
            </div>
        </div>
        <div class="integ-row">
            <div class="head">EmailJS <span class="integ-status ${emOn ? "on" : "off"}">${emOn ? "aktiv" : "aus"}</span></div>
            <div style="color:var(--muted); font-size:0.72rem;">
                Bei <a href="https://emailjs.com" target="_blank" rel="noopener" style="color:var(--accent);">emailjs.com</a> gratis Account, dann Service + Template + Public-Key holen.
            </div>
            <input type="text" id="em-service" placeholder="Service-ID" value="${cfg.emailService}"/>
            <input type="text" id="em-template" placeholder="Template-ID" value="${cfg.emailTemplate}"/>
            <input type="text" id="em-key" placeholder="Public Key" value="${cfg.emailKey}"/>
            <input type="email" id="em-to" placeholder="Empfänger E-Mail" value="${cfg.emailTo}"/>
            <div class="btn-row">
                <button class="primary" id="em-save">Speichern</button>
                <button class="ghost" id="em-test">Test-Mail</button>
            </div>
        </div>`;
    $("#tg-save").onclick = () => {
        localStorage.setItem("tb_tg_token", $("#tg-token").value.trim());
        localStorage.setItem("tb_tg_chat", $("#tg-chat").value.trim());
        renderIntegrationsPanel();
        announce("Telegram-Konfig gespeichert.", "success");
    };
    $("#tg-test").onclick = () => sendTelegram("✅ Test von Trading Bot").then(() => alert("Test gesendet. Check Telegram."));
    $("#em-save").onclick = () => {
        localStorage.setItem("tb_email_service", $("#em-service").value.trim());
        localStorage.setItem("tb_email_template", $("#em-template").value.trim());
        localStorage.setItem("tb_email_key", $("#em-key").value.trim());
        localStorage.setItem("tb_email_to", $("#em-to").value.trim());
        renderIntegrationsPanel();
        announce("EmailJS-Konfig gespeichert.", "success");
    };
    $("#em-test").onclick = () => sendEmail("Test von Trading Bot", "Wenn du das siehst, funktioniert es.").then(() => alert("Test gesendet."));
}

// ============ v7: BINANCE TESTNET ============
state.testnet = {
    enabled: localStorage.getItem("tb_testnet_on") === "1",
    apiKey: sessionStorage.getItem("tb_testnet_key") || "",       // in-memory only for security
    apiSecret: sessionStorage.getItem("tb_testnet_secret") || "",
};
async function testnetSignedRequest(path, params = {}, method = "GET") {
    const { apiKey, apiSecret } = state.testnet;
    if (!apiKey || !apiSecret) throw new Error("Keine API-Credentials");
    const timestamp = Date.now();
    const qs = Object.entries({ ...params, timestamp, recvWindow: 5000 })
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    const sig = await window.TB.hmacSha256(apiSecret, qs);
    const url = `https://testnet.binance.vision${path}?${qs}&signature=${sig}`;
    const res = await fetch(url, { method, headers: { "X-MBX-APIKEY": apiKey } });
    return res.json();
}
async function testnetSubmitOrder(symbol, side, qty, price) {
    return testnetSignedRequest("/api/v3/order", {
        symbol: symbol.replace("/", ""),
        side: side === "long" ? "BUY" : "SELL",
        type: "MARKET",
        quantity: qty.toFixed(6),
    }, "POST");
}
async function testnetCheckConnection() {
    try {
        const r = await testnetSignedRequest("/api/v3/account");
        return r.balances ? r : null;
    } catch (e) { return null; }
}
function renderTestnetPanel() {
    const el = $("#testnet-panel");
    if (!el) return;
    const on = state.testnet.enabled && state.testnet.apiKey && state.testnet.apiSecret;
    el.innerHTML = `
        <div class="integ-row">
            <div class="head">Testnet <span class="integ-status ${on ? "on" : "off"}">${on ? "verbunden" : "aus"}</span></div>
            <div style="color:var(--muted); font-size:0.72rem;">
                Keys nur in Session-Speicher (Reload = verwerfen). Werden nie weitergegeben.
            </div>
            <input type="text" id="tn-key" placeholder="API-Key" value="${state.testnet.apiKey}"/>
            <input type="password" id="tn-secret" placeholder="API-Secret" value="${state.testnet.apiSecret}"/>
            <div class="toggle-row" style="margin-top:8px;">
                <div class="lbl"><strong>Live-Orders an Testnet spiegeln</strong></div>
                <div id="tn-toggle" class="toggle ${state.testnet.enabled ? "on" : ""}"></div>
            </div>
            <div class="btn-row" style="margin-top:6px;">
                <button class="primary" id="tn-save">Speichern &amp; Testen</button>
            </div>
            <div id="tn-status" style="margin-top:6px; font-size:0.75rem; color:var(--muted);"></div>
        </div>`;
    $("#tn-save").onclick = async () => {
        state.testnet.apiKey = $("#tn-key").value.trim();
        state.testnet.apiSecret = $("#tn-secret").value.trim();
        sessionStorage.setItem("tb_testnet_key", state.testnet.apiKey);
        sessionStorage.setItem("tb_testnet_secret", state.testnet.apiSecret);
        $("#tn-status").textContent = "…verbinde";
        const acct = await testnetCheckConnection();
        if (acct) {
            const usdt = acct.balances.find((b) => b.asset === "USDT");
            $("#tn-status").innerHTML = `<span style="color:var(--green)">✓ verbunden</span> · Testnet-USDT: <strong>${usdt ? parseFloat(usdt.free).toFixed(2) : "?"}</strong>`;
            announce("Testnet verbunden.", "success");
        } else {
            $("#tn-status").innerHTML = `<span style="color:var(--red)">✗ Verbindung fehlgeschlagen</span> — Keys prüfen`;
        }
    };
    $("#tn-toggle").onclick = () => {
        state.testnet.enabled = !state.testnet.enabled;
        localStorage.setItem("tb_testnet_on", state.testnet.enabled ? "1" : "0");
        renderTestnetPanel();
    };
}
// Hook: mirror broker.submit to testnet if enabled
const _origSubmit = broker.submit.bind(broker);
broker.submit = function(symbol, side, qty, price, meta) {
    const r = _origSubmit(symbol, side, qty, price, meta);
    if (r && state.testnet.enabled && state.testnet.apiKey) {
        testnetSubmitOrder(symbol, side, r.qty, price).then((res) => {
            if (res.orderId) announce(`Testnet-Order gespiegelt: ${symbol} ${side}. Order-ID ${res.orderId}.`, "info");
            else if (res.msg) console.warn("Testnet-Order abgelehnt:", res.msg);
        }).catch(() => {});
    }
    return r;
};

// ============ v7: real PDF via html2pdf CDN ============
async function generatePdfTaxReport() {
    // load html2pdf on demand
    if (!window.html2pdf) {
        await new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
            s.onload = resolve; s.onerror = reject;
            document.head.appendChild(s);
        });
    }
    const trades = _pairTrades();
    trades.sort((a, b) => new Date(a.close_ts) - new Date(b.close_ts));
    const total = trades.reduce((s, t) => s + t.pnl, 0);
    const rows = trades.map((t) => {
        const days = (new Date(t.close_ts) - new Date(t.open_ts)) / (86400 * 1000);
        return `<tr><td>${new Date(t.open_ts).toLocaleDateString("de-DE")}</td><td>${new Date(t.close_ts).toLocaleDateString("de-DE")}</td><td>${t.symbol}</td><td>${t.side}</td><td style="text-align:right">${t.qty.toFixed(6)}</td><td style="text-align:right">${t.pnl.toFixed(2)}</td><td>${days >= 365 ? "§23 frei" : Math.round(days) + " T"}</td></tr>`;
    }).join("");
    const container = document.createElement("div");
    container.style.cssText = "padding:24px; font-family:Arial; color:#111;";
    container.innerHTML = `
        <h1 style="color:#1e40af;">Steuerreport § 23 EStG</h1>
        <div style="color:#555; margin-bottom:16px;">Erstellt ${new Date().toLocaleDateString("de-DE")} · ${trades.length} Trades · Netto ${total.toFixed(2)} USDT</div>
        <table style="border-collapse:collapse; width:100%; font-size:11px;">
            <thead><tr style="background:#e2e8f0;"><th style="padding:4px;border:1px solid #cbd5e1;">Kauf</th><th style="padding:4px;border:1px solid #cbd5e1;">Verkauf</th><th style="padding:4px;border:1px solid #cbd5e1;">Symbol</th><th style="padding:4px;border:1px solid #cbd5e1;">Seite</th><th style="padding:4px;border:1px solid #cbd5e1;">Menge</th><th style="padding:4px;border:1px solid #cbd5e1;">PnL</th><th style="padding:4px;border:1px solid #cbd5e1;">Status</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    document.body.appendChild(container);
    await window.html2pdf().from(container).set({
        margin: 10,
        filename: `steuerreport_${new Date().toISOString().slice(0, 10)}.pdf`,
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    }).save();
    container.remove();
    announce("PDF-Steuerreport erzeugt.", "success");
}

// ============ v7: ENCRYPTED BACKUP ============
async function exportEncryptedBackup() {
    const pw = prompt("Passwort für Backup (min. 8 Zeichen):");
    if (!pw || pw.length < 8) { alert("Passwort zu kurz."); return; }
    const dump = {};
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("tb_")) dump[k] = localStorage.getItem(k);
    }
    dump._exported_at = new Date().toISOString();
    dump._schema = "trading-bot-v7-enc";
    const encrypted = await window.TB.encryptWithPassword(JSON.stringify(dump), pw);
    const blob = new Blob([encrypted], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tradingbot_backup_${new Date().toISOString().slice(0, 10)}.enc`;
    a.click();
    URL.revokeObjectURL(a.href);
    announce("Verschlüsseltes Backup exportiert.", "success");
}
async function importEncryptedBackup(file) {
    const pw = prompt("Passwort für dieses Backup:");
    if (!pw) return;
    const text = await file.text();
    try {
        const decrypted = await window.TB.decryptWithPassword(text, pw);
        const dump = JSON.parse(decrypted);
        if (!confirm(`Backup vom ${dump._exported_at} importieren? Aktuelle Daten werden ersetzt.`)) return;
        for (const k in dump) if (k.startsWith("tb_")) localStorage.setItem(k, dump[k]);
        announce("Backup entschlüsselt und wiederhergestellt.", "success");
        setTimeout(() => location.reload(), 800);
    } catch (e) {
        alert("Entschlüsselung fehlgeschlagen — falsches Passwort oder korrupte Datei.");
    }
}

// Extend tools panel with new buttons
const _origRenderTools = renderToolsPanel;
renderToolsPanel = function() {
    _origRenderTools();
    // append encrypted backup + real PDF buttons
    const el = $("#tools-panel");
    if (!el) return;
    const actions = el.querySelector(".tools-actions");
    if (actions && !actions.querySelector("[data-v7]")) {
        actions.insertAdjacentHTML("beforeend", `
            <button class="ghost" id="tp-enc-export" data-v7>🔒 Verschlüsseltes Backup</button>
            <button class="ghost" id="tp-enc-import" data-v7>🔓 Verschlüsseltes importieren</button>
            <button class="ghost" id="tp-pdf" data-v7>📕 PDF-Steuerreport</button>`);
        actions.insertAdjacentHTML("afterend", `<input type="file" id="tp-enc-file" accept=".enc" style="display:none;"/>`);
        $("#tp-enc-export").onclick = exportEncryptedBackup;
        $("#tp-enc-import").onclick = () => $("#tp-enc-file").click();
        $("#tp-enc-file").onchange = (e) => { if (e.target.files[0]) importEncryptedBackup(e.target.files[0]); };
        $("#tp-pdf").onclick = generatePdfTaxReport;
    }
};

// ============ v7: JOURNAL METHOD SELECTOR ============
document.addEventListener("DOMContentLoaded", () => {
    const sel = $("#journal-method");
    if (sel) {
        sel.value = localStorage.getItem("tb_journal_method") || "fifo";
        sel.onchange = () => {
            localStorage.setItem("tb_journal_method", sel.value);
            renderJournal();
        };
    }
    // limit order add
    const addLim = $("#limit-add");
    if (addLim) addLim.onclick = () => {
        const sym = $("#limit-symbol").value;
        const side = $("#limit-side").value;
        const price = parseFloat($("#limit-price").value);
        const notional = parseFloat($("#limit-notional").value);
        if (!sym || !price || !notional) { alert("Preis + Notional angeben."); return; }
        addLimitOrder(sym, side, price, notional);
        $("#limit-price").value = "";
        renderLimitOrders();
    };
    const limSel = $("#limit-symbol");
    if (limSel) limSel.innerHTML = ALL_SYMBOLS.map((s) => `<option value="${s}">${s}</option>`).join("");
});

// ============ v7: hook into scan cycle for new automations ============
const _origScanAll = scanAll;
scanAll = async function() {
    await _origScanAll();
    checkLimitOrders();
    runDcaCheck();
    runRebalance(false);
    runPairCheck();
};

// ============ v7: augment renderAll for v7 panels ============
const _origRenderAllV7 = renderAll;
renderAll = function() {
    _origRenderAllV7();
    renderLimitOrders();
    renderDcaPanel();
    renderGridPanel();
    renderRebalancePanel();
    renderPairPanel();
    renderEconCalendar();
    renderWhaleList();
    renderAlphaDecay();
    renderIntegrationsPanel();
    renderTestnetPanel();
};

// =====================================================================
// v8: Tab navigation, Info-popup system, Regime detection, Confluence,
//      Risk-config panel, "safer trades" refinements
// =====================================================================

// ---- Tab switching ----
function initTabs() {
    const buttons = document.querySelectorAll(".tab-btn");
    const panes = document.querySelectorAll(".tab-pane");
    const savedTab = localStorage.getItem("tb_active_tab") || "dashboard";
    function activate(name) {
        buttons.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
        panes.forEach((p) => p.classList.toggle("active", p.dataset.pane === name));
        localStorage.setItem("tb_active_tab", name);
        window.scrollTo({ top: 0, behavior: "smooth" });
    }
    buttons.forEach((b) => b.onclick = () => activate(b.dataset.tab));
    activate(savedTab);
}

// ---- INFO POPUP DATABASE — plain-language explanations ----
const INFO_DB = {
    "signal": {
        title: "Handels-Signal",
        body: `
            <p>Das grosse Feld zeigt was der Bot <strong>gerade tun würde</strong>. Grün = kaufen, Rot = verkaufen, Grau = warten.</p>
            <p>Darunter siehst du:</p>
            <ul>
                <li><strong>Einstiegspreis</strong> — wo du kaufst</li>
                <li><strong>Stop-Loss</strong> — wo du automatisch aussteigst wenn's schief geht</li>
                <li><strong>Take-Profits</strong> — Gewinnziele in 3 Stufen</li>
                <li><strong>Risiko-Bewertung</strong> — wie unsicher der Trade ist (0-100)</li>
                <li><strong>Prognose</strong> — was du gewinnst oder verlierst</li>
            </ul>
            <div class="example">💡 <strong>Manueller Modus</strong>: du bestätigst. <strong>Auto-Modus</strong>: der Bot macht's von allein — aber nur bei sehr sicheren Setups.</div>
        `,
    },
    "portfolio": {
        title: "Portfolio-Übersicht",
        body: `
            <p><strong>Equity</strong> — dein Gesamtvermögen (Cash + Wert aller Positionen)</p>
            <p><strong>Cash</strong> — freies Geld für neue Trades</p>
            <p><strong>Realisierter PnL</strong> — Gewinn/Verlust aus bereits geschlossenen Trades</p>
            <p><strong>Peak-Equity</strong> — dein höchstes Vermögen bisher (wichtig für Drawdown-Berechnung)</p>
            <p><strong>EUR</strong> — Umrechnung deines Equity in Euro (Live-Wechselkurs).</p>
        `,
    },
    "killswitch": {
        title: "Kill-Switch",
        body: `
            <p>Automatische Not-Bremse. Der Bot <strong>stoppt sofort</strong> wenn:</p>
            <ul>
                <li>Du an einem Tag <strong>mehr als 4%</strong> verlierst</li>
                <li>Dein Vermögen <strong>mehr als 15%</strong> vom Peak entfernt ist</li>
                <li>Zu viele Positionen offen sind (max. 12)</li>
            </ul>
            <div class="warn">⚠ Nach Auslösung handelt der Bot bis zum nächsten Tag NICHT mehr. Du kannst manuell entschärfen — dann wird der Peak auf das aktuelle Level zurückgesetzt.</div>
            <p><strong>Warum wichtig?</strong> Der Kapitalerhalt hat immer Vorrang vor dem Gewinn. Ein Trader ohne Stopps ist ein toter Trader.</p>
        `,
    },
    "jarvis": {
        title: "Jarvis — Sprach-KI",
        body: `
            <p>Jarvis spricht dir auf Deutsch <strong>jedes Signal</strong>, jeden Stop-Loss und Take-Profit vor. Läuft komplett im Browser mit der Web-Speech-API — keine Cloud, keine Kosten.</p>
            <p>Aktivieren, Stimme wählen, fertig. Perfekt wenn du nebenbei arbeitest — dein Handy sagt Bescheid wenn was passiert.</p>
        `,
    },
    "positions": {
        title: "Offene Positionen",
        body: `
            <p>Jede Karte zeigt einen aktiven Trade mit:</p>
            <ul>
                <li><strong>Investiert</strong> — wieviel Geld drin steckt</li>
                <li><strong>Aktueller Wert</strong> — was du jetzt bekommen würdest</li>
                <li><strong>PnL / R-Multiple</strong> — Gewinn in USDT und in "Risk-Einheiten"</li>
                <li><strong>Stop-Loss</strong> — dein Ausstieg nach unten (wird bei Gewinn nachgezogen!)</li>
                <li><strong>Erwarteter Gewinn</strong> — was du bei allen TPs kassieren würdest</li>
            </ul>
            <p>Du kannst jederzeit <strong>voll</strong> oder <strong>teilweise</strong> schliessen.</p>
        `,
    },
    "manual-trade": {
        title: "Manueller Trade",
        body: `
            <p>Selbst einen Trade eröffnen. Du wählst:</p>
            <ul>
                <li><strong>Symbol</strong> (z.B. BTC/USDT)</li>
                <li><strong>Richtung</strong> — Long (steigt) oder Short (fällt)</li>
                <li><strong>Grösse</strong> — als % deines Cash</li>
            </ul>
            <p>Stop-Loss und Take-Profit werden <strong>automatisch</strong> per ATR berechnet — kein Trade ohne Stop.</p>
        `,
    },
    "limit-orders": {
        title: "Limit-Orders",
        body: `
            <p>Warten bis der Preis dein gewünschtes Level erreicht, dann automatisch ausführen.</p>
            <div class="example">Beispiel: BTC steht bei 65 000. Du willst nur kaufen wenn's auf 62 000 fällt. → LONG-Limit bei 62 000. Sobald der Preis dort ist, wird's ausgeführt.</div>
            <p>Perfekt für Support/Widerstand-Levels oder wenn du auf einen Rücksetzer wartest.</p>
        `,
    },
    "dca": {
        title: "DCA-Sparplan",
        body: `
            <p><strong>Dollar Cost Averaging</strong> nach Warren Buffett: regelmässig kaufen, aber nur wenn Angst am Markt herrscht.</p>
            <p>Der Bot kauft <strong>wöchentlich</strong> für den eingestellten Betrag in BTC/ETH/BNB — <strong>aber nur wenn der RSI unter 30 ist</strong> (überverkauft).</p>
            <div class="example">💡 So kaufst du automatisch günstig ein und verzichtest wenn's teuer ist. Zeitgetriebene Buy-Strategie ohne Emotionen.</div>
        `,
    },
    "grid": {
        title: "Grid-Trading",
        body: `
            <p>Für <strong>Seitwärts-Märkte</strong>: der Bot setzt gleichzeitig viele Kauf- und Verkauf-Limits im Raster um den aktuellen Preis.</p>
            <div class="example">Beispiel: BTC 65 000, Range ±4%, 5 Levels → 5 Kauf-Limits zwischen 62 400 und 64 480, 5 Verkauf-Limits zwischen 65 520 und 67 600.</div>
            <p>Bei jeder Bewegung wird ein Level gefüllt. Verdient stetig kleine Gewinne solange der Preis pendelt.</p>
            <div class="warn">⚠ Nicht ideal in klaren Trends — dann verlierst du auf der falschen Seite.</div>
        `,
    },
    "rebalance": {
        title: "Portfolio-Rebalancing",
        body: `
            <p>Du definierst eine <strong>Ziel-Verteilung</strong> (z.B. 30% BTC, 20% ETH, 10% SOL). Der Bot vergleicht regelmässig Ist vs Ziel und kauft/verkauft nach — automatisch.</p>
            <p><strong>Toleranz-Cap</strong> verhindert, dass wegen 0,3% Abweichung ständig gehandelt wird.</p>
            <div class="example">Klassisches Ray-Dalio-Prinzip: verkaufe was gestiegen ist, kaufe was gefallen ist. Diszipliniertes "buy low, sell high".</div>
        `,
    },
    "pair": {
        title: "Pair-Trading",
        body: `
            <p><strong>Marktneutrale Strategie</strong>: gleichzeitig ein Asset kaufen und ein anderes leerverkaufen.</p>
            <p>Der Bot beobachtet das Verhältnis zwischen zwei Coins (z.B. ETH/BTC). Wenn es zu weit vom Mittelwert entfernt ist, wettet er dass es wieder zurückkehrt.</p>
            <div class="example">ETH/BTC = 0.045, Mittel = 0.055 → ETH ist relativ günstig. Long ETH + Short BTC. Wenn Ratio zurück zu 0.055 geht → Gewinn, egal ob der Gesamtmarkt steigt oder fällt.</div>
        `,
    },
    "watchlist": {
        title: "Watchlist &amp; Preis-Alarme",
        body: `
            <p>Preis-Alarme ohne Trade-Ausführung. Der Bot sagt dir Bescheid wenn ein Level erreicht wird — via Jarvis-Stimme oder Push-Nachricht.</p>
            <p>Ideal um Support/Widerstand zu überwachen.</p>
        `,
    },
    "scans": {
        title: "Letzte Scans",
        body: `
            <p>Zeigt was der Bot bei seinem letzten Scan (alle 30 Sek.) gefunden hat: welche Symbole waren Kauf/Verkauf/Halten und mit welchem Score.</p>
            <p>Score &gt; 3.0 + Agreement &gt; 3 Strategien = Bot handelt (im Auto-Modus).</p>
        `,
    },
    "fng": {
        title: "Fear &amp; Greed Index",
        body: `
            <p>Zeigt die aktuelle <strong>Marktstimmung</strong> von 0 (extreme Angst) bis 100 (extreme Gier).</p>
            <ul>
                <li>&lt; 20 → alle in Panik → gute Kaufgelegenheit ("Buffett-Zone")</li>
                <li>&gt; 80 → euphorische Gier → Vorsicht, meist bald Rücksetzer</li>
                <li>40-60 → neutraler Markt</li>
            </ul>
            <p>Basiert auf Volatilität, Volumen, Social Media, BTC-Dominanz und Google-Trends.</p>
        `,
    },
    "fng-composite": {
        title: "Composite F&amp;G",
        body: `
            <p>Alternative Berechnung <strong>aus Binance-Daten in Echtzeit</strong>: RSI, Vola, Drawdown, Funding-Rate, Long/Short-Ratio.</p>
            <p>Vergleich mit dem alternative.me Index gibt zweite Bestätigung.</p>
        `,
    },
    "regime": {
        title: "Markt-Regime",
        body: `
            <p>Erkennt automatisch in welchem Markt-Zustand wir sind:</p>
            <ul>
                <li><strong>Trending</strong> (ADX &gt; 25) → Trend-Strategien funktionieren (EMA-Cross, Donchian, MACD)</li>
                <li><strong>Ranging</strong> (ADX &lt; 18) → Mean-Reversion funktioniert (RSI, Bollinger-Bounce)</li>
                <li><strong>Volatilität</strong>: calm / normal / high / panic</li>
            </ul>
            <p>Der Bot passt automatisch die Strategie-Auswahl an.</p>
        `,
    },
    "tv-chart": {
        title: "Live-Chart",
        body: `
            <p>Eingebetteter <strong>TradingView-Chart</strong> — der Weltstandard für Chart-Analyse. Alle Tools und Indikatoren wie auf tradingview.com verfügbar.</p>
        `,
    },
    "ticker24": {
        title: "24h Marktübersicht",
        body: `
            <p>Preise, 24h-Änderung, High/Low und Volumen aller aktiven Handelspaare in einer Tabelle. Klick auf ein Symbol öffnet den <strong>Manuellen-Trade-Dialog</strong> dafür.</p>
        `,
    },
    "multi-tf": {
        title: "Multi-Timeframe",
        body: `
            <p>Zeigt für jedes Symbol die Richtung auf 4 Zeitrahmen (15m, 1h, 4h, 1d).</p>
            <p>Grün = up, rot = down, grau = neutral.</p>
            <div class="example">💡 Sichere Trades: alle Zeitrahmen zeigen in dieselbe Richtung. Nennt sich "MTF-Alignment" — die grössten Trader schauen immer den höheren Zeitrahmen zuerst.</div>
        `,
    },
    "market-ctx": {
        title: "Markt-Kontext",
        body: `
            <p>Globale Krypto-Marktdaten:</p>
            <ul>
                <li><strong>BTC-Dominance</strong> — steigt = Alt-Coins schwach; sinkt = "Alt-Season"</li>
                <li><strong>Total Market Cap</strong> — Gesamtwert aller Kryptos</li>
                <li><strong>24h Volumen</strong> — Handel im letzten Tag</li>
                <li><strong>Trending</strong> — Coins die gerade meistgesucht werden (Social-Signal)</li>
            </ul>
        `,
    },
    "onchain": {
        title: "On-Chain Bitcoin",
        body: `
            <p>Daten direkt aus dem Bitcoin-Netzwerk:</p>
            <ul>
                <li><strong>Hashrate</strong> — Sicherheit des Netzwerks (höher = besser)</li>
                <li><strong>Difficulty</strong> — Schwierigkeit für Miner</li>
                <li><strong>Mempool</strong> — wartende Transaktionen (hoch = viel Aktivität)</li>
                <li><strong>Fees</strong> — Gebühren für nächsten Block</li>
            </ul>
            <p>Steigende Hashrate + hohe Fees = starke Nachfrage → oft bullisch.</p>
        `,
    },
    "whales": {
        title: "Whale-Transfers",
        body: `
            <p>Grosse Bitcoin-Bewegungen (&gt; 10 BTC) aus dem Mempool. Wale bewegen sich oft <strong>vor</strong> grossen Marktbewegungen — daher als Frühindikator interessant.</p>
        `,
    },
    "econ-cal": {
        title: "Makro-Kalender",
        body: `
            <p>Wichtige Wirtschaftstermine die Krypto stark beeinflussen:</p>
            <ul>
                <li><strong>FOMC</strong> — US-Zinsentscheid der Fed</li>
                <li><strong>CPI</strong> — US-Inflationsdaten</li>
                <li><strong>NFP</strong> — Arbeitsmarktzahlen</li>
                <li><strong>EZB</strong> — Europa-Zinsentscheid</li>
                <li><strong>BTC-Halving</strong> — historisch bullisch</li>
            </ul>
            <div class="warn">⚠ Rote Zone = binnen 24h. Positionsgrösse reduzieren, Vola-Spikes möglich.</div>
        `,
    },
    "futures": {
        title: "Futures-Sentiment",
        body: `
            <p>Zeigt was <strong>Futures-Trader machen</strong>:</p>
            <ul>
                <li><strong>Funding-Rate</strong> — bezahlen Longs an Shorts (positiv) oder umgekehrt. Extrem &gt; 0,05% = überkaufte Longs → Short-Warnung.</li>
                <li><strong>Long/Short-Ratio</strong> — &gt; 3 = crowded long → Kontra-Signal</li>
                <li><strong>Open Interest</strong> — offene Kontrakte, hoch = viel Skin-in-the-Game</li>
            </ul>
        `,
    },
    "news": {
        title: "Live-News",
        body: `
            <p>Aktuelle Kryptowährungs-News aus mehreren Quellen (CoinDesk, Cointelegraph, Decrypt, Reddit). Wird alle 5 Min aktualisiert.</p>
        `,
    },
    "risk-metrics": {
        title: "Risiko-Metriken",
        body: `
            <p>Institutional-Grade Risikokennzahlen. Die grossen Fonds messen ihr Portfolio damit — jetzt du auch:</p>
        `,
    },
    "var": {
        title: "Value at Risk (VaR)",
        body: `
            <p>Der <strong>maximale Verlust</strong> den du bei normaler Marktbewegung an einem Tag mit 95% Wahrscheinlichkeit haben wirst.</p>
            <div class="example">VaR = -450 USDT → in 95% aller Fälle verlierst du morgen höchstens 450 USDT.</div>
            <p>An 1 von 20 Tagen kann's mehr sein.</p>
        `,
    },
    "es": {
        title: "Expected Shortfall (ES)",
        body: `
            <p>Wie viel verlierst du <strong>wenn</strong> es zum schlechten 5%-Fall kommt? Sagt was der Durchschnitts-Verlust in Katastrophen-Fällen ist.</p>
            <p>ES ist immer &gt; VaR. Wenn ES sehr viel höher ist als VaR → dein Portfolio hat "fette Ränder" (Tail-Risk).</p>
        `,
    },
    "kelly": {
        title: "Kelly-Formel",
        body: `
            <p>Berechnet die <strong>optimale Positionsgrösse</strong> aus deiner Win-Rate und Reward/Risk-Ratio. Warren Buffett, Jim Simons und Ed Thorp nutzen sie.</p>
            <p>Der Bot zeigt <strong>Half-Kelly</strong> — halbiert für Sicherheit (Full-Kelly kann bei Fehlern schnell 50% Drawdown verursachen).</p>
            <div class="warn">Erst ab 20+ abgeschlossenen Trades sinnvoll.</div>
        `,
    },
    "sharpe": {
        title: "Sharpe-Ratio",
        body: `
            <p>Rendite pro Einheit Risiko. <strong>Höher = besser</strong>.</p>
            <ul>
                <li>&gt; 2 = exzellent (Hedge-Fund-Level)</li>
                <li>1 - 2 = gut</li>
                <li>0 - 1 = mittelmässig</li>
                <li>&lt; 0 = verlierend</li>
            </ul>
        `,
    },
    "sortino": {
        title: "Sortino-Ratio",
        body: `
            <p>Wie Sharpe, aber zählt nur <strong>negative Bewegungen</strong> als Risiko. Fairer, weil grosse Gewinne dich nicht "bestrafen".</p>
            <p>Meist höher als Sharpe.</p>
        `,
    },
    "calmar": {
        title: "Calmar-Ratio",
        body: `
            <p>Jahresrendite dividiert durch maximalen Drawdown. Zeigt <strong>Effizienz relativ zum schlimmsten Rückschlag</strong>.</p>
            <p>Calmar &gt; 3 = sehr gutes Verhältnis.</p>
        `,
    },
    "allocation": {
        title: "Portfolio-Aufteilung",
        body: `
            <p>Wie ist dein Vermögen verteilt? Cash + jede Position.</p>
            <p>Der farbige Balken zeigt Anteile. Die Liste darunter zeigt Details pro Position.</p>
            <div class="example">💡 Ray Dalio: "Der heilige Gral der Investition ist Diversifikation". Nicht mehr als 15-20% pro einzelnes Asset.</div>
        `,
    },
    "confluence": {
        title: "Konfluenz-Score",
        body: `
            <p><strong>Neu in v8</strong>: für jedes Symbol wird geprüft wie viele der 12 Indikatoren (EMA, MACD, RSI, Bollinger, Ichimoku, VWAP, Keltner, Divergenz, Stoch, Volumen, ADX, Donchian) in dieselbe Richtung zeigen.</p>
            <ul>
                <li>8+ Signale = <strong>sehr sicher</strong> (grün)</li>
                <li>6-7 = hoch</li>
                <li>4-5 = mittel</li>
                <li>&lt; 4 = niedrig, nicht handeln</li>
            </ul>
            <div class="example">💡 <strong>Konfluenz schlägt Überzeugung.</strong> Ein Trader mit 3 unabhängigen Bestätigungen gewinnt gegen einen mit "Bauchgefühl".</div>
        `,
    },
    "backtest": {
        title: "Backtest",
        body: `
            <p>Simuliert den Bot rückwirkend auf echten Binance-Kursen. Zeigt <strong>was du verdient hättest</strong> wenn du in den letzten X Tagen mitgelaufen wärst.</p>
            <p>Enthält realistische Slippage (5 bps) und 1-Bar-Latenz. Danach läuft Monte-Carlo mit 1000 Permutationen der Trade-Reihenfolge → schätzt den "wahren" Drawdown.</p>
        `,
    },
    "return-hist": {
        title: "Return-Verteilung",
        body: `
            <p>Histogramm aller abgeschlossenen Trade-PnLs.</p>
            <ul>
                <li>Fette rechte Flanke = viele grosse Gewinne (Trend-System)</li>
                <li>Fette linke Flanke = Katastrophen-Risiko!</li>
                <li>Symmetrisch = Mean-Reversion</li>
            </ul>
            <p>Die gelbe Kurve zeigt die theoretische Normalverteilung — reale PnLs weichen oft davon ab.</p>
        `,
    },
    "correlation": {
        title: "Korrelations-Matrix",
        body: `
            <p>Zeigt wie stark sich zwei Coins <strong>gemeinsam bewegen</strong>. 1.0 = identisch, 0 = unabhängig, -1 = gegensätzlich.</p>
            <div class="warn">⚠ Rote Zellen = hohe Korrelation. Wenn du BTC + ETH + SOL hältst und alle rot korrelieren, hast du KEINE Diversifikation — dann fällt alles zusammen.</div>
            <p>Grüne (negative) Korrelation = Diversifikations-Schutz.</p>
        `,
    },
    "alpha-decay": {
        title: "Alpha-Decay",
        body: `
            <p>Zeigt für jede Strategie <strong>ob sie noch funktioniert</strong> oder schon "verbraucht" ist.</p>
            <p>Die Balken sind 15-Trade-Buckets in Zeitreihe. Wenn die letzten Buckets kleiner werden → die Strategie verliert ihre Edge.</p>
            <div class="example">💡 Jedes Setup hat begrenzte Lebensdauer. Wenn du hier "↘ verliert Edge" siehst → pausieren und neu backtesten.</div>
        `,
    },
    "strat-perf": {
        title: "Strategie-Performance",
        body: `
            <p>PnL pro Strategie. Zeigt welche der 16 aktiven Strategien am meisten verdient und welche am meisten verliert.</p>
        `,
    },
    "adaptive": {
        title: "Adaptive Gewichte",
        body: `
            <p>Der Bot <strong>lernt selbst</strong> welche Strategien gerade funktionieren. Gewinnende Strategien bekommen mehr Stimmrecht im Ensemble, verlierende weniger.</p>
            <p>Braucht 5+ Trades pro Strategie zum Kalibrieren.</p>
        `,
    },
    "strategies": {
        title: "Aktive Strategien",
        body: `
            <p>Alle 16 laufenden Strategien im Bot:</p>
            <ul>
                <li>Klassiker: EMA-Cross, MACD, RSI, Bollinger, Donchian</li>
                <li>Persona-Strategien: Soros, Buffett, Paulson, PTJ, Livermore, Dalio, Templeton, Ackman, Weinstein, MMCrypto</li>
            </ul>
            <p>Jede prüft jeden Kerzenschluss die Symbole. Das Ensemble kombiniert deren Votes.</p>
        `,
    },
    "journal": {
        title: "Handels-Journal",
        body: `
            <p>Vollständige Historie aller abgeschlossenen Trades. <strong>Steuertauglich für das Finanzamt (§ 23 EStG)</strong>.</p>
            <ul>
                <li>Filter: Tag, Monat, Jahr, Gesamt</li>
                <li>FIFO/LIFO für Teil-Schliessungen</li>
                <li>Haltefrist-Badge: &gt; 1 Jahr = steuerfrei</li>
                <li>CSV-Export + druckbarer HTML-Bericht + echtes PDF</li>
            </ul>
        `,
    },
    "appearance": {
        title: "Erscheinungsbild",
        body: `
            <p>Anpassen von Design, Sprache und Onboarding-Tour.</p>
        `,
    },
    "symbols": {
        title: "Handelspaare",
        body: `
            <p>Wähle welche Paare der Bot analysieren und handeln soll.</p>
            <p>Mehr Paare = mehr Trade-Möglichkeiten, aber auch mehr API-Requests. 8-12 ist ein guter Standard.</p>
        `,
    },
    "risk-config": {
        title: "Risiko-Einstellungen",
        body: `
            <p>Alle Risiko-Parameter des Bots — <strong>Verlust minimieren, Gewinn maximieren</strong>:</p>
            <ul>
                <li><strong>Basis-Risiko/Trade</strong> — Verlust bei Stop, in % des Equity</li>
                <li><strong>Max-Risiko/Trade</strong> — bei sehr guten Setups darf das Risiko hochskaliert werden</li>
                <li><strong>ATR-Stop-Multiplier</strong> — wie weit weg der Stop-Loss steht (höher = mehr Luft, aber grösserer Verlust)</li>
                <li><strong>Take-Profit-Ratios</strong> — Reward-Multiplikatoren (2R, 3.5R, 5R = "Trend-your-winners")</li>
                <li><strong>Max Positionen</strong> — wie viele Trades gleichzeitig</li>
                <li><strong>Strict Filter</strong> — nur diese Score/Agreement-Werte lösen Auto-Trades aus</li>
                <li><strong>Kill-Switch-Limits</strong> — Tages-Verlust und Drawdown-Deckel</li>
            </ul>
            <div class="warn">⚠ Höheres Risiko = grössere Gewinne aber auch grössere Verluste. Kelly-Formel-Prinzip.</div>
        `,
    },
    "integrations": {
        title: "Externe Integrationen",
        body: `
            <p>Verbinde den Bot mit:</p>
            <ul>
                <li><strong>Telegram</strong> — Alerts direkt in deinen Chat (Bot-Token nötig)</li>
                <li><strong>EmailJS</strong> — Alerts als E-Mail (kostenlos, braucht Registrierung)</li>
                <li><strong>ntfy.sh</strong> — kostenlose Push-Nachrichten (unter "Tools")</li>
            </ul>
            <div class="warn">🔒 Alle Credentials bleiben lokal im Browser. Werden nie an einen Server gesendet.</div>
        `,
    },
    "testnet": {
        title: "Binance Testnet",
        body: `
            <p>Der Bot spiegelt bei Aktivierung jeden Paper-Trade als <strong>echte Order auf testnet.binance.vision</strong>. Nutzt kostenloses Testgeld — kein Risiko.</p>
            <p>Du testest so ob deine Strategie auch im echten Order-Flow funktioniert (Slippage, Latenz, Fills).</p>
            <p>API-Keys hier holen: <a href="https://testnet.binance.vision/" target="_blank" rel="noopener" style="color:var(--accent);">testnet.binance.vision</a></p>
            <div class="warn">🔒 Keys nur in Session-Speicher — nach Reload weg.</div>
        `,
    },
    "tools": {
        title: "Benachrichtigungen &amp; Tools",
        body: `
            <p>Diverse Zusatzfunktionen:</p>
            <ul>
                <li><strong>Backup / Restore</strong> — alles als JSON exportieren, verschlüsselt oder unverschlüsselt</li>
                <li><strong>Push-Notifications</strong> — Browser-Alerts</li>
                <li><strong>ntfy.sh</strong> — kostenlose Handy-Push</li>
                <li><strong>QR-Code</strong> — für Freunde teilen</li>
                <li><strong>Steuerreport</strong> — druckbar oder als echtes PDF</li>
                <li><strong>Tour</strong> — Onboarding neu starten</li>
            </ul>
        `,
    },
    "health": {
        title: "System-Health",
        body: `
            <p>Pingt alle wichtigen APIs (Binance, CoinGecko, F&amp;G, mempool.space, rss2json …) und zeigt Status + Antwortzeit.</p>
            <p>Wenn eine API rot ist → betroffene Funktion fällt aus, Bot läuft aber weiter mit dem Rest.</p>
        `,
    },
    "rulebook": {
        title: "Rulebook",
        body: `
            <p>Die 10 goldenen Regeln des Bots. Diese sind in Code gegossen und werden immer eingehalten. Perfekte Trader-Disziplin.</p>
        `,
    },
    "danger-zone": {
        title: "Gefahren-Zone",
        body: `
            <p><strong>Reset auf 10k</strong>: setzt Broker zurück, behält Journal + Watchlist + Konfig.</p>
            <p><strong>Alles zurücksetzen</strong>: löscht wirklich ALLES (Journal, Watchlist, Alarme, Konfig). Nur bei Fehlern nutzen.</p>
        `,
    },
};

function showInfo(key) {
    const info = INFO_DB[key];
    if (!info) { console.warn("no info for", key); return; }
    $("#info-title").innerHTML = info.title;
    $("#info-body").innerHTML = info.body;
    $("#info-modal").classList.remove("hidden");
}
function initInfoIcons() {
    document.addEventListener("click", (e) => {
        const btn = e.target.closest(".info");
        if (btn && btn.dataset.info) {
            e.preventDefault(); e.stopPropagation();
            showInfo(btn.dataset.info);
        }
    });
    $("#info-close")?.addEventListener("click", () => $("#info-modal").classList.add("hidden"));
    $("#info-modal")?.addEventListener("click", (e) => {
        if (e.target.id === "info-modal") $("#info-modal").classList.add("hidden");
    });
}

// ---- Regime detection panel ----
function renderRegimePanel() {
    const el = $("#regime-panel");
    if (!el) return;
    const btcCandles = state.candles["BTC/USDT"];
    if (!btcCandles || btcCandles.length < 100) { el.textContent = "warte auf BTC-Daten …"; return; }
    const reg = window.TB.detectRegime(
        window.TB.highs(btcCandles), window.TB.lows(btcCandles), window.TB.closes(btcCandles)
    );
    const badge = $("#regime-badge");
    if (badge) badge.textContent = reg.trend + " · " + reg.volatility;
    el.innerHTML = `
        <div class="regime-grid">
            <div class="regime-item ${reg.trend === "trending" ? "trending" : reg.trend === "ranging" ? "ranging" : ""}">
                <div class="k">Trend-Regime</div>
                <div class="v">${reg.trend.toUpperCase()}</div>
                <small style="color:var(--muted); font-size:0.72rem;">ADX ${reg.adx.toFixed(1)}</small>
            </div>
            <div class="regime-item ${reg.volatility === "panic" ? "volatile" : reg.volatility === "high" ? "ranging" : "trending"}">
                <div class="k">Volatilitäts-Regime</div>
                <div class="v">${reg.volatility.toUpperCase()}</div>
                <small style="color:var(--muted); font-size:0.72rem;">ATR ${reg.atrPct.toFixed(2)}%</small>
            </div>
        </div>
        <div style="margin-top:10px; padding:10px 12px; background:rgba(77, 148, 255, 0.06); border-radius:8px; font-size:0.82rem;">
            <strong style="color:var(--accent);">Empfehlung:</strong> ${reg.recommend}
        </div>`;
}

// ---- Confluence panel per symbol ----
function renderConfluencePanel() {
    const el = $("#confluence-panel");
    if (!el) return;
    const rows = CFG.symbols
        .map((sym) => {
            const c = state.candles[sym];
            if (!c || c.length < 100) return null;
            const conf = window.TB.confluenceScore(c);
            if (!conf) return null;
            return { sym, conf };
        })
        .filter(Boolean)
        .sort((a, b) => b.conf.score - a.conf.score);
    if (!rows.length) { el.textContent = "lade Konfluenz-Daten …"; return; }
    el.innerHTML = rows.slice(0, 15).map((r) => {
        const c = r.conf;
        const cls = c.score >= 8 ? "high" : c.score >= 5 ? "mid" : "low";
        const dots = [];
        for (let i = 0; i < c.total; i++) {
            dots.push(`<span class="conf-dot ${i < Math.max(c.bullCount, c.bearCount) ? "on" : ""}"></span>`);
        }
        const sideTxt = c.side === "long" ? "▲ LONG" : c.side === "short" ? "▼ SHORT" : "− FLAT";
        const sideColor = c.side === "long" ? "var(--green)" : c.side === "short" ? "var(--red)" : "var(--muted)";
        const list = (c.side === "long" ? c.bull : c.side === "short" ? c.bear : []).slice(0, 4).join(", ");
        return `<div class="confluence-row ${cls}">
            <span style="color:${sideColor}; font-weight:700; min-width:70px;">${sideTxt}</span>
            <div>
                <strong>${r.sym}</strong>
                <div style="color:var(--muted); font-size:0.7rem;">${list || "keine klare Konfluenz"}</div>
            </div>
            <span class="conf-dots">${dots.join("")}</span>
            <span class="conf-score ${cls}">${c.score}/${c.total}</span>
        </div>`;
    }).join("");
}

// ---- Risk config panel ----
const RISK_CONFIG_ITEMS = [
    { key: "baseRiskPct", label: "Basis-Risiko / Trade", unit: "%", min: 0.1, max: 5, step: 0.1, hint: "Verlust bei Stop-Loss als % des Equity" },
    { key: "maxRiskPct", label: "Max-Risiko / Trade", unit: "%", min: 0.5, max: 10, step: 0.5, hint: "Obergrenze bei starken Setups" },
    { key: "atrStopMult", label: "ATR-Stop-Multiplier", unit: "×", min: 0.5, max: 5, step: 0.1, hint: "Wie weit weg der Stop steht" },
    { key: "maxOpenPositions", label: "Max Positionen", unit: "", min: 1, max: 20, step: 1, hint: "Wie viele Trades gleichzeitig" },
    { key: "maxNotionalPctPerPosition", label: "Max Grösse / Position", unit: "%", min: 1, max: 50, step: 1, hint: "Anteil des Equity pro Position" },
    { key: "strictMinScore", label: "Auto-Min-Score", unit: "", min: 1, max: 6, step: 0.1, hint: "Nur Signale ≥ diesem Score werden auto-gehandelt" },
    { key: "strictAgreement", label: "Auto-Min-Agreement", unit: "", min: 1, max: 8, step: 1, hint: "Mindestanzahl Strategien die zustimmen müssen" },
    { key: "strictMaxRisk", label: "Auto-Max-Risk-Score", unit: "", min: 10, max: 100, step: 5, hint: "Nur Signale mit Risk-Score ≤ X werden auto-gehandelt" },
    { key: "maxDailyLossPct", label: "Kill-Switch: Tages-Verlust", unit: "%", min: 1, max: 20, step: 0.5, hint: "Ab diesem Verlust an einem Tag stoppt der Bot" },
    { key: "maxDrawdownPct", label: "Kill-Switch: Max-Drawdown", unit: "%", min: 5, max: 50, step: 1, hint: "Ab dieser Distanz vom Peak stoppt der Bot" },
    { key: "correlationWarnThreshold", label: "Korr.-Warnschwelle", unit: "", min: 0.3, max: 0.95, step: 0.05, hint: "Ab dieser Korrelation zwischen Symbolen warnt Bot" },
];
function renderRiskConfig() {
    const el = $("#risk-config");
    if (!el) return;
    // Load overrides
    const saved = JSON.parse(localStorage.getItem("tb_risk_config") || "{}");
    Object.assign(CFG, saved);
    el.innerHTML = `
        <div class="perf-hint">Änderungen wirken sofort. Bei Unsicherheit: Reset-Button unten.</div>
        ${RISK_CONFIG_ITEMS.map((it) => `
            <div class="risk-config-row">
                <div class="lbl">${it.label}<small>${it.hint}</small></div>
                <div>
                    <input type="number" data-key="${it.key}" min="${it.min}" max="${it.max}" step="${it.step}" value="${CFG[it.key]}"/>
                    ${it.unit ? `<span style="color:var(--muted); font-size:0.72rem; margin-left:4px;">${it.unit}</span>` : ""}
                </div>
            </div>`).join("")}
        <div class="btn-row" style="margin-top:12px;">
            <button id="risk-reset" class="ghost">Standard-Werte</button>
        </div>`;
    el.querySelectorAll("input[data-key]").forEach((inp) => {
        inp.onchange = () => {
            const v = parseFloat(inp.value);
            if (isFinite(v)) {
                CFG[inp.dataset.key] = v;
                const saved = JSON.parse(localStorage.getItem("tb_risk_config") || "{}");
                saved[inp.dataset.key] = v;
                localStorage.setItem("tb_risk_config", JSON.stringify(saved));
                announce("Einstellung gespeichert.", "info");
            }
        };
    });
    $("#risk-reset").onclick = () => {
        if (!confirm("Alle Risiko-Einstellungen auf Standard zurücksetzen?")) return;
        localStorage.removeItem("tb_risk_config");
        location.reload();
    };
}

// ---- Boost the ensemble with confluence + regime ----
// Wrap existing scanSymbol to add confluence penalty
const _origMakePending = makePending;
makePending = function(symbol, sig, candles, price) {
    const pending = _origMakePending(symbol, sig, candles, price);
    if (!pending) return null;
    // Confluence check — reject if agreement < 4 (except in auto-mode this is already stricter)
    const conf = window.TB.confluenceScore(candles);
    if (conf) {
        pending.confluenceScore = conf.score;
        pending.confluenceSide = conf.side;
        // if confluence disagrees with strategy signal → reject
        if (conf.side !== "flat" && conf.side !== pending.side) {
            return null;
        }
        // Regime-aware boost
        const reg = window.TB.detectRegime(
            window.TB.highs(candles), window.TB.lows(candles), window.TB.closes(candles)
        );
        pending.regime = reg;
        // Reject during panic volatility to reduce loss
        if (reg.volatility === "panic") return null;
    }
    return pending;
};

// ---- Wire "Manueller Trade" buttons ----
document.addEventListener("DOMContentLoaded", () => {
    const btn1 = $("#btn-manual-trade");
    const btn2 = $("#btn-manual-trade-2");
    const trigger = () => {
        // pick first available symbol
        openManualOrderModal(CFG.symbols[0]);
    };
    if (btn1) btn1.onclick = trigger;
    if (btn2) btn2.onclick = trigger;
    // tour restart in Einstellungen
    const tour = $("#tour-restart");
    if (tour) tour.onclick = () => { localStorage.removeItem("tb_onboarded"); startOnboarding(); };
});

// ---- Extend renderAll with v8 panels ----
const _origRenderAllV8 = renderAll;
renderAll = function() {
    _origRenderAllV8();
    renderRegimePanel();
    renderConfluencePanel();
};

document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    initInfoIcons();
    initTheme();
    initLang();
    renderToolsPanel();
    renderRiskConfig();
    checkFirstLaunch();
    setTimeout(() => {
        refreshMarketCtx();
        refreshOnChain();
        refreshEurRate();
        checkHealth();
        refreshWhales();
        renderEconCalendar();
    }, 2000);
    setInterval(refreshMarketCtx, 5 * 60 * 1000);
    setInterval(refreshOnChain, 5 * 60 * 1000);
    setInterval(refreshEurRate, 15 * 60 * 1000);
    setInterval(checkHealth, 10 * 60 * 1000);
    setInterval(refreshWhales, 3 * 60 * 1000);
    setInterval(renderEconCalendar, 60 * 1000);
});

document.addEventListener("DOMContentLoaded", boot);

})();
