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
            <div style="margin-top:10px; font-size:0.72rem; color:var(--muted); text-align:left;">
                Dynamisches Risiko: ${(pending.dynRiskPct || CFG.baseRiskPct).toFixed(2)}% des Depots
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
                <div class="btn-row" style="margin-top:8px;">
                    <button class="ghost pos-close" data-sym="${k}" style="flex:1; font-size:0.78rem; padding:6px 8px;">Position jetzt schliessen</button>
                </div>
            </div>`;
    }).join("");
    el.querySelectorAll(".pos-close").forEach((btn) => {
        btn.onclick = () => {
            const sym = btn.dataset.sym;
            const p = pos[sym];
            if (!p) return;
            if (!confirm(`Position ${sym} jetzt zum Marktpreis schliessen?`)) return;
            const price = state.prices[sym] || p.entry;
            const r = broker.close(sym, price, 1);
            if (r) announce(`Position ${sym.replace("/", " gegen ")} manuell geschlossen. ${r.pnl >= 0 ? "Gewinn" : "Verlust"} ${Math.abs(r.pnl).toFixed(2)} Dollar.`, r.pnl >= 0 ? "success" : "warn");
            renderAll();
        };
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

function dynamicRiskPct(score, riskScore) {
    // Score 3 → base risk, higher score linearly up to max risk
    const scoreBoost = Math.min(Math.max((score - 2.0) / 3.0, 0), 1);
    const riskDampen = 1 - Math.min(riskScore / 100, 0.7);
    const pct = CFG.baseRiskPct + (CFG.maxRiskPct - CFG.baseRiskPct) * scoreBoost * riskDampen;
    return Math.max(CFG.baseRiskPct * 0.5, Math.min(CFG.maxRiskPct, pct));
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
    for (let i = 220; i < candles.length; i++) {
        const win = candles.slice(Math.max(0, i - 500), i + 1);
        const price = candles[i].close;
        const events = bt.onPrice(symbol, price);
        for (const ev of events) {
            if (ev.kind === "tp" || ev.kind === "sl") {
                trades++;
                if (ev.pnl > 0) wins++;
                else if (ev.pnl < 0) losses++;
            }
        }
        if (!bt.positions[symbol] && i % 4 === 0) {                // scan every 4 bars = 1h
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
                    bt.submit(symbol, result.side, plan.size, price,
                        { stop: plan.stop, take_profits: plan.take_profits,
                          strategy: result.signals.map((s) => s.strategy).join(",") });
                }
            }
        }
        equity.push({ ts: candles[i].ts, eq: bt.equity({ [symbol]: price }) });
    }
    const finalEq = bt.equity({ [symbol]: candles[candles.length - 1].close });
    const pnl = finalEq - 10000;
    const wr = trades ? (wins / trades * 100) : 0;

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
            ${equity.length} Bars simuliert · Start 10 000 USDT · Strikte Filter (Score ≥ 3.0, Agreement ≥ 3)
        </div>`;
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
    const cashPct = broker.cash / eq * 100;
    const positions = broker.positions;
    const items = [{ label: "Cash", value: broker.cash, pct: cashPct, color: "#6b7891" }];
    const palette = ["#4d94ff", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6", "#ec4899", "#84cc16", "#f97316", "#6366f1", "#0ea5e9", "#eab308"];
    let colorIdx = 0;
    for (const sym in positions) {
        const p = positions[sym];
        const price = state.prices[sym] || p.entry;
        const value = p.side === "long" ? p.qty * price : p.qty * (2 * p.entry - price);
        items.push({
            label: sym.replace("/USDT", "") + " " + (p.side === "long" ? "L" : "S"),
            value, pct: value / eq * 100, color: palette[colorIdx++ % palette.length],
        });
    }
    const bar = items.map((i) => i.pct > 0
        ? `<div style="flex-basis:${i.pct}%; background:${i.color};" title="${i.label} ${i.pct.toFixed(1)}%">${i.pct >= 6 ? i.label : ""}</div>`
        : ""
    ).join("");
    const list = items.map((i) =>
        `<div class="item"><span><span class="swatch" style="background:${i.color}"></span>${i.label}</span><span class="num">${fmt(i.value, 2)} · ${i.pct.toFixed(1)}%</span></div>`
    ).join("");
    el.innerHTML = `<div class="alloc-bar">${bar}</div><div class="alloc-list">${list}</div>`;
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
    $("#peak-eq").textContent = money(state.peakEquity);
    checkWatchlist();
    checkWeeklyReport();
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

document.addEventListener("DOMContentLoaded", boot);

})();
