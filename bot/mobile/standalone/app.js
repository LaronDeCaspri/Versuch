/* ============================================================
 * Trading Bot — standalone browser app orchestration
 * Runs autonomously in the tab. Persists everything in localStorage.
 * ============================================================ */
(function () {

const CFG = {
    symbols: [
        "BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT",
        "XRP/USDT", "ADA/USDT", "AVAX/USDT", "LINK/USDT",
    ],
    primaryTf: "15m",
    scanIntervalSec: 30,
    priceIntervalSec: 10,
    riskPctPerTrade: 0.5,                    // very conservative
    atrStopMult: 1.8,
    tpMultiples: [2.0, 3.5, 5.0],
    maxOpenPositions: 3,
    // strict filters — auto-trade ONLY on best setups
    strictMinScore: 3.0,
    strictAgreement: 3,
    strictMaxRisk: 30,
    // manual filters — a bit looser so the user still sees candidates
    softMinScore: 1.8,
    softAgreement: 2,
    softMaxRisk: 55,
};

const state = {
    candles: {},                             // {symbol: [candles]}
    prices: {},                              // {symbol: price}
    pending: [],                             // pending signals awaiting confirm
    autoMode: localStorage.getItem("tb_auto") === "1",
    fng: null,
    scanCount: 0,
    tradeCount: 0,
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
            <div class="btn-row" style="margin-top:16px;">
                <button class="confirm" id="confirm-btn">✓ BESTÄTIGEN</button>
                <button class="danger" id="cancel-btn">✕ VERWERFEN</button>
            </div>
            <div style="margin-top:10px; font-size:0.72rem; color:var(--muted); text-align:left;">${pending.reasons.slice(0, 3).join(" · ")}</div>
        `;
        $("#confirm-btn").onclick = () => confirmPending(pending);
        $("#cancel-btn").onclick = () => cancelPending(pending);
    } else if (fallback) {
        tile.className = "signal " + (fallback.color || "grey");
        tile.innerHTML = `
            <div class="signal-badge">Handelsentscheidung</div>
            <div class="signal-label">${fallback.action || "HALTEN"}</div>
            <div class="signal-symbol">${fallback.symbol || "–"}</div>
            <div class="signal-price num">${fallback.hint || "Warte auf konfluentes Setup"}</div>`;
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
    const keys = Object.keys(pos);
    if (!keys.length) { el.textContent = "keine offenen Positionen"; return; }
    el.innerHTML = keys.map((k) => {
        const p = pos[k];
        const price = state.prices[k] || p.entry;
        const upnl = p.side === "long" ? (price - p.entry) * p.qty : (p.entry - price) * p.qty;
        const pnlPct = ((price / p.entry - 1) * 100 * (p.side === "long" ? 1 : -1));
        return `
            <div class="pos-row">
                <span>${p.symbol}<br><small>${fmt(p.qty, 6)} @ ${fmt(p.entry, 4)}</small></span>
                <span class="side-${p.side}">${p.side.toUpperCase()}</span>
                <span class="num" style="color:${upnl >= 0 ? 'var(--green)' : 'var(--red)'}">${upnl >= 0 ? '+' : ''}${fmt(upnl, 2)}<br><small>${pnlPct >= 0 ? '+' : ''}${fmt(pnlPct, 2)}%</small></span>
            </div>`;
    }).join("");
}

function renderMatrix() {
    const el = $("#matrix");
    const tfs = ["15m", "1h", "4h", "1d"];
    let html = `<div class="head">Symbol</div>` + tfs.map((t) => `<div class="head">${t}</div>`).join("");
    for (const sym of CFG.symbols) {
        html += `<div>${sym}</div>`;
        for (const tf of tfs) {
            const key = `${sym}_${tf}`;
            const dir = state.tfDir?.[key] || "flat";
            html += `<div><div class="dot ${dir}"></div></div>`;
        }
    }
    el.innerHTML = html;
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

function renderJournal() {
    const el = $("#journal");
    const j = [...broker.journal].reverse().slice(0, 15);
    if (!j.length) { el.textContent = "noch keine Trades"; return; }
    el.innerHTML = j.map((e) => {
        const t = new Date(e.ts).toLocaleTimeString("de-DE");
        const isClose = e.kind === "close";
        const pnl = isClose ? e.pnl : 0;
        const pnlStr = isClose ? `<span class="num" style="color:${pnl >= 0 ? 'var(--green)' : 'var(--red)'}">${pnl >= 0 ? '+' : ''}${fmt(pnl, 2)}</span>` : "";
        return `<div class="sig-row">
            <span>${t}  ${e.kind === "open" ? "▶ open" : "◀ close"} ${e.symbol}<br><small>${e.strategy || ""}</small></span>
            <span class="side-${e.side}">${e.side.toUpperCase()}</span>
            ${pnlStr || `<span class="num">${fmt(e.price, 4)}</span>`}
        </div>`;
    }).join("");
}

function renderStrategies() {
    $("#strategies").innerHTML = window.TB.STRATEGIES.map((s) =>
        `<span class="chip">${s.name.replace(/_/g, " ")}</span>`).join("");
    $("#strat-count").textContent = window.TB.STRATEGIES.length + " aktiv";
}

function renderFng() {
    const el = $("#fng-value");
    if (!state.fng) { el.textContent = "–"; return; }
    el.textContent = state.fng.value;
    $("#fng-class").textContent = state.fng.label;
    const color = state.fng.value <= 24 ? "red" : state.fng.value <= 44 ? "amber" : state.fng.value >= 75 ? "red" : state.fng.value >= 55 ? "green" : "grey";
    el.style.borderColor = `var(--${color})`;
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

function makePending(symbol, sig, candles, price) {
    if (broker.positions[symbol]) return null;
    if (Object.keys(broker.positions).length >= CFG.maxOpenPositions) return null;
    const atrValues = window.TB.atr(window.TB.highs(candles), window.TB.lows(candles), window.TB.closes(candles), 14);
    const atrVal = atrValues[atrValues.length - 1];
    if (!atrVal || isNaN(atrVal)) return null;
    const equity = broker.equity(state.prices);
    const plan = window.TB.planTrade(sig.side, price, atrVal, equity, CFG);
    if (!plan || plan.size <= 0) return null;
    const forecast = window.TB.forecast(plan);
    const risk = window.TB.assessRisk(plan, candles, broker.positions, equity);
    return {
        id: symbol + "_" + Date.now(),
        symbol, ...plan,
        score: sig.score,
        signals: sig.signals,
        reasons: sig.signals.map((s) => `${s.strategy}: ${s.reason}`),
        strategy: sig.signals.map((s) => s.strategy).join(","),
        forecast, risk,
    };
}

function passesStrictFilter(pending) {
    return pending.score >= CFG.strictMinScore
        && pending.signals.length >= CFG.strictAgreement
        && pending.risk.score <= CFG.strictMaxRisk;
}

// =========== main scan loop ============================================
async function refreshMatrix(symbol, candles) {
    const closes = window.TB.closes(candles);
    if (closes.length < 210) return;
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
    state.tfDir = state.tfDir || {};
    state.tfDir[`${symbol}_${CFG.primaryTf}`] = votes >= 2 ? "up" : votes <= -2 ? "down" : "flat";
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
            const verb = ev.kind === "sl" ? "Stop-Loss ausgelöst" : "Take-Profit erreicht";
            const level = ev.pnl >= 0 ? "success" : "warn";
            announce(`${verb} bei ${symbol.replace("/", " gegen ")}. ${ev.pnl >= 0 ? "Gewinn" : "Verlust"} ${Math.abs(ev.pnl).toFixed(2)} Dollar.`, level);
        }

        // ensemble
        const result = window.TB.ensemble(candles, CFG.softMinScore, CFG.softAgreement);
        return { symbol, ...result, price };
    } catch (e) {
        return { symbol, error: e.message };
    }
}

async function scanAll() {
    state.scanCount++;
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
}

// =========== event bindings ============================================
$("#btn-scan").onclick = async () => {
    $("#btn-scan").textContent = "…scanne";
    await scanAll();
    $("#btn-scan").textContent = "Jetzt scannen";
};

$("#btn-reset").onclick = () => {
    if (!confirm("Portfolio wirklich zurücksetzen? Alle Trades und das Guthaben werden gelöscht.")) return;
    broker.reset();
    state.pending = [];
    announce("Portfolio zurückgesetzt. 10 000 Dollar Spielgeld wieder verfügbar.");
    renderAll();
};

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

// =========== boot ============================================
async function boot() {
    renderStrategies();
    renderTvSelect();
    updateModePill();
    renderAll();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
    keepAwake();
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") keepAwake();
    });

    // initial scan
    await scanAll();
    refreshFng();

    // loops
    setInterval(scanAll, CFG.scanIntervalSec * 1000);
    setInterval(refreshPrices, CFG.priceIntervalSec * 1000);
    setInterval(refreshFng, 5 * 60 * 1000);
}

document.addEventListener("DOMContentLoaded", boot);

})();
