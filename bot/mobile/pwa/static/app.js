const $ = (sel) => document.querySelector(sel);
const fmt  = (n, d = 2) => (n == null ? "–" : Number(n).toLocaleString("de-DE", { maximumFractionDigits: d }));
const money = (n) => (n == null ? "–" : Number(n).toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).replace("€", "USDT"));

let lastPendingId = null;
let audioCtx = null;
let notificationsGranted = false;

async function api(path, opts = {}) {
    const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
    return res.json();
}

// --- audible alert -------------------------------------------------------
function beep(kind = "buy") {
    if (!audioCtx) return;
    const freqs = kind === "buy" ? [880, 1174, 1760] : kind === "sell" ? [660, 494, 330] : [500];
    let t = audioCtx.currentTime;
    freqs.forEach((f) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.value = f;
        osc.type = "sine";
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.23);
        t += 0.25;
    });
    if ("vibrate" in navigator) navigator.vibrate(kind === "buy" ? [80, 40, 80, 40, 200] : [200, 80, 200]);
}

function notify(title, body) {
    if (!notificationsGranted || document.visibilityState === "visible") return;
    try { new Notification(title, { body, icon: "/static/icon-192.png", tag: "trading-signal", requireInteraction: true }); }
    catch (e) { /* ignore */ }
}

$("#btn-enable-sound").onclick = async () => {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if ("Notification" in window && Notification.permission !== "granted") {
        const p = await Notification.requestPermission();
        notificationsGranted = p === "granted";
    } else if (Notification.permission === "granted") {
        notificationsGranted = true;
    }
    beep("buy");
    $("#btn-enable-sound").textContent = notificationsGranted ? "🔔 aktiv" : "🔔 nur Ton";
    $("#btn-enable-sound").classList.add("primary");
};

// --- big signal tile -----------------------------------------------------
function renderSignalTile(pending, lightFallback) {
    const tile = $("#signal-tile");
    tile.innerHTML = "";
    if (pending) {
        const cls = pending.action === "BUY" ? "green" : pending.action === "SELL" ? "red" : "grey";
        tile.className = "signal " + cls;
        const f = pending.forecast || {};
        const tpLines = (pending.take_profits || []).map((tp, i) =>
            `<div class="row"><span>TP${i + 1} (${(tp.fraction*100).toFixed(0)}%)</span><strong>${fmt(tp.price, 4)}</strong></div>`).join("");
        const r = pending.risk || {};
        const riskFactors = (r.factors || []).map(x =>
            `<div class="risk-factor"><span>${x.name} <small>(${x.value})</small></span><span class="impact">+${fmt(x.impact,1)}</span></div>`).join("");
        const patterns = (pending.patterns || []).slice(0,2).map(p =>
            `<div style="margin-top:6px; font-size:0.8rem; color:${p.direction==='bullish'?'#3fb950':p.direction==='bearish'?'#f85149':'#d29922'}">
                <b>${p.name_de}:</b> ${p.means}
            </div>`).join("");
        tile.innerHTML = `
            <div class="signal-label">${pending.action}</div>
            <div class="signal-symbol">${pending.symbol}</div>
            <img src="${pending.chart_url}" alt="chart" style="width:100%; margin-top:10px; border-radius:8px; background:#000;"/>
            <div style="text-align:left; margin-top:12px;">
                <div class="row"><span>Entry</span><strong>${fmt(pending.entry, 4)}</strong></div>
                <div class="row"><span>Stop-Loss</span><strong style="color:#f85149">${fmt(pending.stop, 4)}</strong></div>
                ${tpLines}
                <div class="row"><span>Grösse</span><strong>${fmt(pending.size, 6)}</strong></div>
                <div class="row"><span>Risiko</span><strong>${money(pending.risk_amount)}</strong></div>
            </div>
            ${r.score !== undefined ? `
            <div class="risk-block">
                <div class="signal-score" style="text-align:left;">Risiko-Bewertung: <strong style="color:var(--${r.color || 'yellow'})">${(r.label||'').toUpperCase()} · ${r.score}/100</strong></div>
                <div class="risk-bar-bg"><div class="risk-bar-fill risk-color-${r.color||'yellow'}" style="width:${r.score}%;"></div></div>
                ${riskFactors}
            </div>` : ""}
            <div class="risk-block">
                <div class="signal-score" style="text-align:left;">Gewinn-Prognose</div>
                <div class="row"><span>Bei allen TPs</span><strong style="color:#3fb950">+${money(f.weighted_profit)}</strong></div>
                <div class="row"><span>Bei vollem Run</span><strong style="color:#3fb950">+${money(f.max_profit_full_run)}</strong></div>
                <div class="row"><span>Bei Stop</span><strong style="color:#f85149">-${money(f.loss_at_stop)}</strong></div>
                <div class="row"><span>Erwartungswert (50/50)</span><strong>${money(f.expected_value_50_50)}</strong></div>
                <div class="row"><span>Risk / Reward</span><strong>1 : ${fmt(f.risk_reward_final)}</strong></div>
            </div>
            ${patterns ? `<div style="margin-top:8px; text-align:left;"><b style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;">Erkannte Muster</b>${patterns}</div>` : ""}
            <div class="btn-row" style="margin-top:16px;">
                <button class="primary" id="confirm-btn">✓ BESTÄTIGEN</button>
                <button class="danger" id="cancel-btn">✕ VERWERFEN</button>
            </div>
            <div style="margin-top:10px; font-size:0.75rem; opacity:0.75; text-align:left;">${(pending.reasons || []).slice(0,3).join(" · ")}</div>
        `;
        $("#confirm-btn").onclick = async () => {
            $("#confirm-btn").textContent = "…";
            await api(`/api/pending/${pending.id}/confirm`, { method: "POST" });
            refreshPending();
            refresh();
        };
        $("#cancel-btn").onclick = async () => {
            await api(`/api/pending/${pending.id}/cancel`, { method: "POST" });
            refreshPending();
        };
    } else {
        const light = lightFallback || { action: "HOLD", color: "grey", symbol: "–", score: 0 };
        tile.className = "signal " + (light.color || "grey");
        tile.innerHTML = `
            <div class="signal-label">${light.action === "BUY" ? "KAUFEN" : light.action === "SELL" ? "VERKAUFEN" : "HALTEN"}</div>
            <div class="signal-symbol">${light.symbol || "–"}</div>
            <div class="signal-details">
                <div>Konfluenz<strong>${fmt(light.score, 2)}</strong></div>
                <div>Signale<strong>${(light.reasons || []).length}</strong></div>
            </div>
            <div class="signal-score">Warte auf konfluentes Setup</div>
        `;
    }
}

// --- other panels --------------------------------------------------------
function renderPositions(positions) {
    const el = $("#positions");
    if (!positions || positions.length === 0) { el.textContent = "keine offenen Positionen"; return; }
    el.innerHTML = positions.map(p => `
        <div class="pos-row">
            <span>${p.symbol}<br><small>${fmt(p.qty, 6)} @ ${fmt(p.entry, 4)}</small></span>
            <span class="side-${p.side}">${p.side.toUpperCase()}</span>
            <span>SL ${fmt(p.stop, 4)}</span>
        </div>`).join("");
}

function renderSignals(signals) {
    const el = $("#signals");
    if (!signals || signals.length === 0) { el.textContent = "noch kein Scan"; return; }
    el.innerHTML = signals.map(s => `
        <div class="sig-row">
            <span>${s.symbol}<br><small>${(s.signals || []).map(x => x.strategy).join(", ") || "-"}</small></span>
            <span class="side-${s.side}">${s.side.toUpperCase()}</span>
            <span>${fmt(s.score, 2)}</span>
        </div>`).join("");
}

function renderConfluence(rows) {
    const el = $("#confluence-wrap");
    if (!rows || !rows.length) { el.textContent = "…"; return; }
    el.innerHTML = rows.map(r => {
        const pct = Math.max(0, Math.min(100, Math.abs(r.score)));
        const color = r.score > 0 ? "var(--green)" : r.score < 0 ? "var(--red)" : "var(--muted)";
        return `<div style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;font-size:0.8rem;">
                <span>${r.symbol}</span><span style="color:${color}">${r.score > 0 ? "+" : ""}${r.score}%</span>
            </div>
            <div class="confluence-bar-bg">
                <div class="confluence-bar-fill" style="width:${pct}%;background:${color};"></div>
            </div>
        </div>`;
    }).join("");
}

function renderMatrix(rows) {
    if (!rows || !rows.length) return;
    const timeframes = Object.keys(rows[0].tf || {});
    let html = `<div class="head">Symbol</div>` + timeframes.map(t => `<div class="head" style="text-align:center">${t}</div>`).join("");
    for (const r of rows) {
        html += `<div>${r.symbol}</div>`;
        for (const t of timeframes) {
            const s = r.tf[t] || "flat";
            html += `<div><div class="dot ${s === "up" ? "up" : s === "down" ? "down" : ""}"></div></div>`;
        }
    }
    $("#matrix").innerHTML = html;
}

function renderFng(data) {
    if (!data) return;
    const v = data.value;
    let cls = "grey";
    if (v <= 24) cls = "red";
    else if (v <= 44) cls = "warn";
    else if (v >= 75) cls = "red";
    else if (v >= 55) cls = "green";
    const el = $("#fng-value");
    el.textContent = v;
    el.style.borderColor = cls === "red" ? "var(--red)" : cls === "green" ? "var(--green)" : cls === "warn" ? "var(--yellow)" : "var(--grey)";
    $("#fng-class").textContent = data.classification;
}

function renderPatterns(items) {
    const el = $("#patterns");
    if (!items || items.length === 0) { el.textContent = "aktuell keine markanten Muster erkannt"; return; }
    el.innerHTML = items.slice(0, 8).map(p => `
        <div class="pattern-card">
            <div class="pattern-head">
                <span>
                    <span class="pattern-title">${p.name_de}</span>
                    <span class="pattern-meta"> · ${p.symbol} · ${p.timeframe}</span>
                </span>
                <span class="pattern-dir ${p.direction}">
                    ${p.direction === "bullish" ? "▲ BULLISCH" : p.direction === "bearish" ? "▼ BÄRISCH" : "— NEUTRAL"}
                </span>
            </div>
            <div class="pattern-block"><b>Was ist das?</b> ${p.why}</div>
            <div class="pattern-block"><b>Warum ist das wichtig?</b> ${p.means}</div>
            <div class="pattern-block"><b>Was tun?</b> ${p.action}</div>
            <div style="text-align:right"><span class="pattern-conf">Vertrauen ${(p.confidence*100).toFixed(0)}%</span></div>
        </div>
    `).join("");
}

function renderCouncil(items) {
    const el = $("#council");
    if (!items || items.length === 0) { el.textContent = "still — kein Trader fährt aktuell einen Setup"; return; }
    el.innerHTML = items.map(i => `
        <div class="council-item">
            <span class="name">${i.trader.replace(/_/g, " ")}</span>
            <span class="verdict"><span class="side-${i.side}">${i.side.toUpperCase()}</span> ${i.symbol}<br>${i.reason}</span>
        </div>
    `).join("");
}

// --- polling -------------------------------------------------------------
async function refresh() {
    const s = await api("/api/status");
    $("#equity").textContent = fmt(s.equity) + " USDT";
    $("#cash").textContent = fmt(s.cash) + " USDT";
    $("#pos-count").textContent = s.positions ? s.positions.length : 0;
    $("#status-pill").textContent = s.running ? "running" : "idle";
    $("#status-pill").classList.toggle("on", !!s.running);
    renderPositions(s.positions);
}

async function refreshPending() {
    const items = await api("/api/pending");
    const light = items.length ? null : await api("/api/light");
    const top = items[0] || null;
    if (top && top.id !== lastPendingId) {
        lastPendingId = top.id;
        beep(top.action === "BUY" ? "buy" : "sell");
        notify(`${top.action}  ${top.symbol}`, `Entry ${fmt(top.entry, 4)} · SL ${fmt(top.stop, 4)}`);
    } else if (!top) {
        lastPendingId = null;
    }
    renderSignalTile(top, light);
}

function renderIntel(d) {
    if (!d) return;
    const el = $("#intel");
    const movers = (d.top_movers_24h || []).slice(0, 6).map(m => `
        <div class="row">
            <span>${m.symbol}</span>
            <span class="side-${m.change_24h_pct >= 0 ? 'long' : 'short'}">${m.change_24h_pct >= 0 ? '+' : ''}${fmt(m.change_24h_pct, 2)}%</span>
        </div>`).join("");
    const funding = Object.entries(d.funding_rates || {}).map(([k, v]) =>
        `<div class="row"><span>Funding ${k}</span><strong>${(v*100).toFixed(3)}%</strong></div>`).join("");
    const ls = Object.entries(d.long_short_ratio || {}).map(([k, v]) =>
        `<div class="row"><span>L/S ${k}</span><strong>${fmt(v, 2)}</strong></div>`).join("");
    el.innerHTML = `
        <div class="row"><span>BTC Dominanz</span><strong>${fmt(d.btc_dominance, 2)}%</strong></div>
        <div class="row"><span>Total Marketcap</span><strong>${fmt(d.total_market_cap_usd/1e9,1)} Mrd. USD</strong></div>
        <div class="row"><span>24h Volumen</span><strong>${fmt(d.total_volume_usd/1e9,1)} Mrd.</strong></div>
        ${d.btc_hashrate ? `<div class="row"><span>BTC Hashrate</span><strong>${fmt(d.btc_hashrate/1e6,1)} EH/s</strong></div>` : ""}
        ${d.btc_mempool_txs ? `<div class="row"><span>BTC Mempool</span><strong>${fmt(d.btc_mempool_txs,0)} tx</strong></div>` : ""}
        ${funding}
        ${ls}
        <div style="margin-top:8px; color:var(--muted); font-size:0.75rem;">Top Bewegungen 24h</div>
        ${movers}
    `;
}

function renderAnalytics(d) {
    if (!d) return;
    const el = $("#analytics");
    if (!d.trades) { el.textContent = "noch keine abgeschlossenen Trades"; return; }
    const byStrat = Object.entries(d.by_strategy || {}).map(([k, v]) =>
        `<div class="row"><span>${k}</span><span>${v.trades} trades · win ${fmt(v.win_rate)}%</span></div>`).join("");
    el.innerHTML = `
        <div class="row"><span>Trades</span><strong>${d.trades}</strong></div>
        <div class="row"><span>Win-Rate</span><strong>${fmt(d.win_rate)}%</strong></div>
        <div class="row"><span>PnL total</span><strong>${money(d.pnl_total)}</strong></div>
        <div class="row"><span>Avg R</span><strong>${fmt(d.avg_r,2)}</strong></div>
        <div class="row"><span>Profit Factor</span><strong>${fmt(d.profit_factor,2)}</strong></div>
        <div class="row"><span>Max DD</span><strong>${fmt(d.max_drawdown_pct)}%</strong></div>
        <div class="row"><span>Sharpe</span><strong>${fmt(d.sharpe,2)}</strong></div>
        <div class="row"><span>Sortino</span><strong>${fmt(d.sortino,2)}</strong></div>
        <div style="margin-top:8px; color:var(--muted); font-size:0.75rem;">nach Strategie</div>
        ${byStrat}
    `;
}

let shownNewsIds = new Set();
function renderNews(items) {
    if (!items || items.length === 0) { $("#news").textContent = "keine News aktuell"; return; }
    $("#news").innerHTML = items.slice(0, 12).map(n => `
        <div class="news-item imp-${n.importance}">
            <div class="src">${n.source} · ${new Date(n.ts).toLocaleTimeString("de-DE")}</div>
            <a href="${n.url}" target="_blank" rel="noopener">${n.title}</a>
        </div>`).join("");
    // popup for the newest high-importance item we haven't shown yet
    const important = items.find(n => n.importance >= 3 && !shownNewsIds.has(n.title));
    if (important) {
        shownNewsIds.add(important.title);
        showNewsPopup(important);
    }
}

function showNewsPopup(item) {
    const el = $("#news-popup");
    el.querySelector(".news-popup-title").textContent = item.title;
    el.querySelector(".news-popup-summary").textContent = (item.summary || "").slice(0, 200);
    el.querySelector(".news-popup-source").textContent = item.source;
    el.classList.remove("hidden");
    if (audioCtx) beep("neutral");
    notify(`📰 ${item.source}`, item.title);
    setTimeout(() => el.classList.add("hidden"), 12000);
}
document.querySelector(".news-popup-close")?.addEventListener("click", () => {
    $("#news-popup").classList.add("hidden");
});

async function loadTvWidget() {
    const primary = ($(".pos-row a") || {}).textContent || "BTC/USDT";
    const url = `https://s.tradingview.com/widgetembed/?symbol=BINANCE:${primary.replace('/','')}&interval=15&theme=dark&style=1&locale=en`;
    $("#tv-iframe").src = url;
}

let modeAuto = false;
const modeToggle = $("#mode-toggle");
async function loadMode() {
    const d = await api("/api/mode");
    modeAuto = !!d.auto;
    modeToggle.classList.toggle("on", modeAuto);
    $("#mode-label").textContent = modeAuto ? "Vollautomatik (Demo)" : "Manuell (Demo)";
}
modeToggle.onclick = async () => {
    modeAuto = !modeAuto;
    await api(`/api/mode?auto=${modeAuto}`, { method: "POST" });
    loadMode();
};

async function refreshExtras() {
    try { renderConfluence(await api("/api/confluence")); } catch(e){}
    try { renderMatrix(await api("/api/confluence")); } catch(e){}
    try { renderFng(await api("/api/fear-greed")); } catch(e){}
    try { renderCouncil(await api("/api/council")); } catch(e){}
    try { renderPatterns(await api("/api/patterns")); } catch(e){}
    try { renderIntel(await api("/api/intel")); } catch(e){}
    try { renderAnalytics(await api("/api/analytics")); } catch(e){}
    try { renderNews(await api("/api/news")); } catch(e){}
}

async function loadKnowledge() {
    const k = await api("/api/knowledge");
    $("#rules").innerHTML = k.rulebook.map(x => `<li>${x.replace(/^\d+\.\s*/, "")}</li>`).join("");
}

$("#btn-start").onclick = async () => { await api("/api/start", { method: "POST" }); refresh(); };
$("#btn-stop").onclick  = async () => { await api("/api/stop",  { method: "POST" }); refresh(); };
$("#btn-scan").onclick  = async () => {
    $("#btn-scan").textContent = "…scanning";
    await api("/api/scan", { method: "POST" });
    await refreshPending();
    await refreshExtras();
    $("#btn-scan").textContent = "Scan";
    refresh();
};

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

loadKnowledge();
loadMode();
loadTvWidget();
refresh();
refreshPending();
refreshExtras();
setInterval(refresh, 5000);
setInterval(refreshPending, 4000);
setInterval(refreshExtras, 30000);
setInterval(async () => { try { renderNews(await api("/api/news")); } catch(e){} }, 60000);
