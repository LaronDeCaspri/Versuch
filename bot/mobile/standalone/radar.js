/* =====================================================================
 * Trading Bot — v39 Aufmerksamkeits-Radar
 * Which coins is the market suddenly paying attention to? Keyless sources:
 * CoinGecko search trends + logos, live-news mentions, Binance volume vs
 * its 30-day median, perp funding / open interest. Information only — the
 * radar never changes trading decisions (no history exists to test it).
 * Pure scoring lives here (DOM-free, testable); rendering is in app.js.
 * ===================================================================== */
(function (root) {
"use strict";
const TB = root.TB || (root.TB = {});

// CoinGecko ids for the symbols the bot can trade
const GECKO_IDS = {
    BTC: "bitcoin", ETH: "ethereum", BNB: "binancecoin", SOL: "solana", XRP: "ripple", ADA: "cardano",
    AVAX: "avalanche-2", LINK: "chainlink", DOT: "polkadot", MATIC: "matic-network", TRX: "tron",
    TON: "the-open-network", DOGE: "dogecoin", SHIB: "shiba-inu", LTC: "litecoin", BCH: "bitcoin-cash",
    UNI: "uniswap", ATOM: "cosmos", NEAR: "near", APT: "aptos", ARB: "arbitrum", OP: "optimism",
    SUI: "sui", SEI: "sei-network", ICP: "internet-computer", AAVE: "aave", FIL: "filecoin",
    INJ: "injective-protocol", RNDR: "render-token", FET: "fetch-ai",
};
const NAMES = {
    BTC: "Bitcoin", ETH: "Ethereum", BNB: "BNB", SOL: "Solana", XRP: "XRP", ADA: "Cardano", AVAX: "Avalanche",
    LINK: "Chainlink", DOT: "Polkadot", MATIC: "Polygon", TRX: "TRON", TON: "Toncoin", DOGE: "Dogecoin",
    SHIB: "Shiba Inu", LTC: "Litecoin", BCH: "Bitcoin Cash", UNI: "Uniswap", ATOM: "Cosmos", NEAR: "NEAR",
    APT: "Aptos", ARB: "Arbitrum", OP: "Optimism", SUI: "Sui", SEI: "Sei", ICP: "Internet Computer",
    AAVE: "Aave", FIL: "Filecoin", INJ: "Injective", RNDR: "Render", FET: "Fetch.ai",
};

const WEIGHTS = { search: 0.30, news: 0.20, volume: 0.25, move: 0.15, crowd: 0.10 };
const COMPONENT_LABELS = { search: "Suchtrend", news: "News", volume: "Volumen", move: "Kursbewegung", crowd: "Positionierung" };
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Logos only from two pinned, well-known image hosts (https). Anything else is dropped.
function safeImage(url) {
    try {
        const u = new URL(String(url));
        if (u.protocol !== "https:") return null;
        if (/(^|\.)coingecko\.com$/.test(u.hostname)) return u.href;
        if (u.hostname === "cdn.jsdelivr.net" && u.pathname.startsWith("/npm/cryptocurrency-icons@0.18.1/")) return u.href;
        return null;
    } catch (e) { return null; }
}
// Static fallback logo (version-pinned npm package via jsDelivr) for when CoinGecko is unreachable.
function fallbackImage(symbol) {
    const s = String(symbol || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return s ? `https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/${s}.svg` : null;
}

function countMentions(news, symbol, name, sinceMs) {
    if (!Array.isArray(news) || !news.length) return 0;
    const sym = String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!sym) return 0;
    const symRe = new RegExp(`(^|[^A-Z0-9$])\\$?${sym}([^A-Z0-9]|$)`);
    const nm = String(name || "").toLowerCase();
    let n = 0;
    for (const item of news) {
        if (sinceMs && new Date(item.ts).getTime() < sinceMs) continue;
        const title = String(item.title || "");
        const tags = (item.categories || []).join(" ");
        const hit = (sym.length >= 3 && symRe.test(title.toUpperCase())) ||
            (nm.length >= 4 && title.toLowerCase().includes(nm)) ||
            new RegExp(`(^|\\s)${sym}(\\s|$)`).test(tags.toUpperCase());
        if (hit) n++;
    }
    return n;
}

// Builds the coin universe (bot symbols + trending coins) and scores each 0–100.
function computeAttention(input, now = Date.now()) {
    const tracked = input.tracked || [];
    const trending = (input.trending || []).slice(0, 15);
    const markets = {};
    for (const m of input.markets || []) if (m && m.symbol) markets[String(m.symbol).toUpperCase()] = m;
    const coins = new Map();
    const ensure = (sym, base) => {
        const key = String(sym).toUpperCase();
        if (!coins.has(key)) coins.set(key, { symbol: key, name: NAMES[key] || key, tracked: false, ...base });
        return coins.get(key);
    };
    for (const t of tracked) ensure(t.symbol, { tracked: true, geckoId: GECKO_IDS[t.symbol] || null });
    trending.forEach((t, i) => {
        const c = ensure(t.symbol, { geckoId: t.id });
        c.trendPos = i + 1;
        if (t.name) c.name = t.name;
        c.image = c.image || safeImage(t.image);
        if (Number.isFinite(t.change24h) && !Number.isFinite(c.change24h)) c.change24h = t.change24h;
        if (Number.isFinite(t.price) && !Number.isFinite(c.price)) c.price = t.price;
        if (Number.isFinite(t.mcRank)) c.mcRank = t.mcRank;
    });

    const since = now - 24 * 3600e3;
    const out = [];
    for (const c of coins.values()) {
        const m = markets[c.symbol];
        if (m) {
            if (m.name && !c.tracked) c.name = m.name;
            c.image = safeImage(m.image) || c.image || null;
            if (Number.isFinite(m.price)) c.price = m.price;
            if (Number.isFinite(m.change24h)) c.change24h = m.change24h;
            if (Array.isArray(m.sparkline)) c.sparkline = m.sparkline.filter(Number.isFinite);
        }
        const t = tracked.find((x) => x.symbol === c.symbol) || {};
        if (Number.isFinite(t.change24h) && !Number.isFinite(c.change24h)) c.change24h = t.change24h;
        if (Number.isFinite(t.price) && !Number.isFinite(c.price)) c.price = t.price;

        const comp = {}, raw = {};
        comp.search = c.trendPos ? clamp01(1 - (c.trendPos - 1) / 15) : 0;
        raw.search = c.trendPos || null;
        raw.news = countMentions(input.news, c.symbol, c.name, since);
        comp.news = clamp01(raw.news / 6);
        if (Number.isFinite(t.volRatio)) { raw.volume = t.volRatio; comp.volume = clamp01((t.volRatio - 1) / 2); }
        if (Number.isFinite(c.change24h)) { raw.move = c.change24h; comp.move = clamp01(Math.abs(c.change24h) / 15); }
        if (Number.isFinite(t.fundingZ) || Number.isFinite(t.oiChange1h)) {
            raw.crowd = { fundingZ: t.fundingZ, oiChange1h: t.oiChange1h };
            comp.crowd = Math.max(Number.isFinite(t.fundingZ) ? clamp01(Math.abs(t.fundingZ) / 3) : 0,
                                  Number.isFinite(t.oiChange1h) ? clamp01(Math.abs(t.oiChange1h) / 0.1) : 0);
        }
        let wsum = 0, ssum = 0;
        for (const k of Object.keys(WEIGHTS)) if (k in comp) { wsum += WEIGHTS[k]; ssum += WEIGHTS[k] * comp[k]; }
        const score = wsum > 0 ? Math.round((ssum / wsum) * 100) : 0;
        const level = score >= 70 ? "HYPE" : score >= 45 ? "ERHÖHT" : "RUHIG";
        const alt = fallbackImage(c.symbol);
        out.push({ ...c, image: c.image || alt, imageAlt: c.image && c.image !== alt ? alt : null, score, level, components: comp, raw, advice: adviceFor(level, c, comp, raw) });
    }
    out.sort((a, b) => b.score - a.score || (a.tracked === b.tracked ? 0 : a.tracked ? -1 : 1));
    return out;
}

function adviceFor(level, c, comp, raw) {
    const up = Number.isFinite(c.change24h) && c.change24h >= 5;
    const down = Number.isFinite(c.change24h) && c.change24h <= -5;
    const crowded = (comp.crowd || 0) >= 0.66;
    if (level === "HYPE") {
        if (crowded && up) return "Hype mit überfüllter Positionierung nach starkem Anstieg — erhöhte Rückschlaggefahr, keine Longs hinterherjagen.";
        if (up) return "Viel Aufmerksamkeit nach einem Anstieg — Einstiege am Hoch sind riskant, Spreads und Volatilität prüfen.";
        if (down) return "Aufmerksamkeit durch Abverkauf — sehr volatile Phase, Stops nicht zu eng setzen.";
        return "Der Markt schaut ungewöhnlich stark auf diesen Coin — Nachrichtenlage prüfen, bevor gehandelt wird.";
    }
    if (level === "ERHÖHT") return c.tracked ? "Erhöhte Aufmerksamkeit — beobachten. Der Bot handelt weiter nur nach seinen getesteten Regeln." : "Erhöhte Aufmerksamkeit — auf die Beobachtungsliste.";
    return "Keine ungewöhnliche Aufmerksamkeit.";
}

// Score change against the snapshot closest to `agoMs` before now (default 1 h).
function trendFor(history, symbol, score, now = Date.now(), agoMs = 3600e3) {
    if (!Array.isArray(history) || !history.length) return null;
    let best = null;
    for (const h of history) {
        if (!h || !h.scores || !(symbol in h.scores)) continue;
        if (now - h.t < agoMs * 0.5) continue;
        if (!best || Math.abs(now - h.t - agoMs) < Math.abs(now - best.t - agoMs)) best = h;
    }
    return best ? score - best.scores[symbol] : null;
}

// ---------------- data fetching (browser and Node) ----------------
async function getJson(url, ms = 9000) {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const t = setTimeout(() => ctl && ctl.abort(), ms);
    try {
        const res = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
        if (!res.ok) throw new Error("HTTP " + res.status);
        return await res.json();
    } finally { clearTimeout(t); }
}

async function fetchTrending() {
    const d = await getJson("https://api.coingecko.com/api/v3/search/trending");
    return ((d && d.coins) || []).slice(0, 15).map((x) => {
        const it = x.item || {};
        const data = it.data || {};
        const chg = data.price_change_percentage_24h && data.price_change_percentage_24h.usd;
        return {
            id: it.id, symbol: String(it.symbol || "").toUpperCase(), name: it.name,
            image: it.large || it.small || it.thumb, mcRank: it.market_cap_rank,
            change24h: Number.isFinite(+chg) ? +chg : undefined,
            price: Number.isFinite(+data.price) ? +data.price : undefined,
        };
    }).filter((x) => x.symbol);
}

async function fetchMarkets(ids) {
    const list = [...new Set(ids.filter(Boolean))].slice(0, 60);
    if (!list.length) return [];
    const d = await getJson(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(list.join(","))}&sparkline=true&price_change_percentage=24h`);
    return (Array.isArray(d) ? d : []).map((m) => ({
        id: m.id, symbol: String(m.symbol || "").toUpperCase(), name: m.name, image: m.image,
        price: +m.current_price, change24h: +m.price_change_percentage_24h,
        volume: +m.total_volume, sparkline: m.sparkline_in_7d && m.sparkline_in_7d.price,
    }));
}

// 24 h quote volume vs the median of the previous 30 full days (Binance spot)
async function fetchVolumeRatios(symbols) {
    const out = {};
    await Promise.all(symbols.map(async (s) => {
        const sym = s.replace("/", "");
        try {
            const [tick, daily] = await Promise.all([
                getJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}`),
                getJson(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1d&limit=31`),
            ]);
            const vols = (Array.isArray(daily) ? daily.slice(0, -1) : []).map((k) => +k[7]).filter((v) => v > 0).sort((a, b) => a - b);
            const median = vols.length ? vols[Math.floor(vols.length / 2)] : null;
            const q24 = +tick.quoteVolume;
            out[s] = {
                volRatio: median > 0 && q24 > 0 ? q24 / median : undefined,
                change24h: Number.isFinite(+tick.priceChangePercent) ? +tick.priceChangePercent : undefined,
                price: Number.isFinite(+tick.lastPrice) ? +tick.lastPrice : undefined,
            };
        } catch (e) { out[s] = {}; }
    }));
    return out;
}

TB.radar = {
    version: "39.0", GECKO_IDS, NAMES, WEIGHTS, COMPONENT_LABELS,
    computeAttention, countMentions, trendFor, safeImage, fallbackImage,
    fetchTrending, fetchMarkets, fetchVolumeRatios,
};
})(typeof window !== "undefined" ? window : globalThis);
