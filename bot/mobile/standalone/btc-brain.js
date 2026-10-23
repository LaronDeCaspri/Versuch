/*
 * BTC-Gedächtnis — die komplette Bitcoin-Kurshistorie seit 2010 als Wissensbasis.
 * DOM-frei (läuft im Browser und im Node-Server). Exponiert TB.btcBrain:
 *   analyze(daily, now)  → Zyklus, Allzeithochs, Crashs, Regime, Saisonalität, historische Analogien,
 *                          Risiko-Kontext für alle Trades
 *   summary(a)           → deutsche Zusammenfassung (für Jarvis)
 *   fetchers             → Datenquellen (CryptoCompare ab 2010, Bitstamp ab 2011, Binance ab 2017)
 * Eine Kerze: { t: ms (00:00 UTC), o, h, l, c, v }.
 */
(function (root) {
    "use strict";
    const TB = (root.TB = root.TB || {});
    const DAY = 86400e3;

    // Block-reward halvings (UTC dates). The next one is an estimate (~210 000 blocks later).
    const HALVINGS = ["2012-11-28", "2016-07-09", "2020-05-11", "2024-04-20"].map((d) => Date.parse(d + "T00:00:00Z"));
    const NEXT_HALVING_EST = Date.parse("2028-04-15T00:00:00Z");

    const pct = (a, b) => (b ? (a / b - 1) * 100 : 0);
    function sma(values, n) {
        const out = new Array(values.length).fill(null);
        let s = 0;
        for (let i = 0; i < values.length; i++) {
            s += values[i];
            if (i >= n) s -= values[i - n];
            if (i >= n - 1) out[i] = s / n;
        }
        return out;
    }
    const median = (xs) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

    // Clean + merge daily candles from several sources: one row per UTC day, earlier sources fill gaps.
    function mergeDaily(...lists) {
        const by = new Map();
        for (const list of lists) for (const k of list || []) {
            if (!k || !(k.c > 0)) continue;
            const t = Math.floor(k.t / DAY) * DAY;
            if (!by.has(t)) by.set(t, { t, o: +k.o || k.c, h: +k.h || k.c, l: +k.l || k.c, c: +k.c, v: +k.v || 0 });
        }
        return [...by.values()].sort((a, b) => a.t - b.t);
    }

    // Every drawdown of at least `minDepth` % from an all-time high, with its recovery.
    function drawdowns(daily, minDepth = 30) {
        const out = [];
        let peak = null, trough = null;
        for (const k of daily) {
            if (!peak || k.c >= peak.c) {
                if (peak && trough && pct(trough.c, peak.c) <= -minDepth) out.push({ peakT: peak.t, peak: peak.c, troughT: trough.t, trough: trough.c, depth: pct(trough.c, peak.c), days: Math.round((trough.t - peak.t) / DAY), recoveryT: k.t, recoveryDays: Math.round((k.t - trough.t) / DAY) });
                peak = k; trough = k;
            } else if (k.c < trough.c) trough = k;
        }
        if (peak && trough && pct(trough.c, peak.c) <= -minDepth) out.push({ peakT: peak.t, peak: peak.c, troughT: trough.t, trough: trough.c, depth: pct(trough.c, peak.c), days: Math.round((trough.t - peak.t) / DAY), recoveryT: null, recoveryDays: null, ongoing: true });
        return out;
    }

    function cycleInfo(daily, now) {
        let idx = -1;
        for (let i = 0; i < HALVINGS.length; i++) if (HALVINGS[i] <= now) idx = i;
        const since = idx >= 0 ? Math.floor((now - HALVINGS[idx]) / DAY) : null;
        const len = idx >= 0 ? Math.round(((HALVINGS[idx + 1] || NEXT_HALVING_EST) - HALVINGS[idx]) / DAY) : null;
        // How earlier cycles behaved: top after the halving, and the move from "this cycle day" onwards.
        const byT = new Map(daily.map((k) => [k.t, k]));
        const at = (t) => { for (let d = 0; d < 5; d++) { const k = byT.get(Math.floor(t / DAY) * DAY + d * DAY); if (k) return k; } return null; };
        const past = [];
        for (let i = 0; i < idx; i++) {
            const h = HALVINGS[i], end = HALVINGS[i + 1];
            // Cycle top = highest close within ~3 years after the halving (later highs belong to the next run-up).
            const seg = daily.filter((k) => k.t >= h && k.t < Math.min(end, h + 1100 * DAY));
            if (seg.length < 100) continue;
            const top = seg.reduce((a, b) => (b.c > a.c ? b : a));
            const startK = at(h);
            const sameDay = since != null ? at(h + since * DAY) : null;
            const later = since != null ? at(h + (since + 90) * DAY) : null;
            const later180 = since != null ? at(h + (since + 180) * DAY) : null;
            past.push({
                n: i + 1, halving: h, topT: top.t, top: top.c, daysToTop: Math.round((top.t - h) / DAY),
                gainToTop: startK ? pct(top.c, startK.c) : null,
                fwd90: sameDay && later ? pct(later.c, sameDay.c) : null,
                fwd180: sameDay && later180 ? pct(later180.c, sameDay.c) : null,
            });
        }
        const medTop = median(past.map((p) => p.daysToTop));
        let phase = "unbekannt";
        if (since != null) {
            phase = since < 180 ? "früh nach dem Halving (Akkumulation)" : medTop && since < medTop - 60 ? "Aufwärtsphase des Zyklus (historisch stärkster Abschnitt)"
                : medTop && since <= medTop + 120 ? "Zone früherer Zyklus-Hochs" : since < (len || 1460) - 360 ? "nach den früheren Zyklus-Hochs (historisch Bärenmarkt-Phase)" : "Vorlauf zum nächsten Halving";
        }
        return { halvingIndex: idx + 1, lastHalving: idx >= 0 ? HALVINGS[idx] : null, daysSince: since, cycleLen: len, progress: since != null && len ? Math.min(1, since / len) : null, nextHalvingEst: HALVINGS[idx + 1] || NEXT_HALVING_EST, phase, past, medianDaysToTop: medTop };
    }

    function seasonality(daily) {
        const months = Array.from({ length: 12 }, () => []);
        const firstOfMonth = new Map();
        for (const k of daily) { const d = new Date(k.t); const key = d.getUTCFullYear() * 12 + d.getUTCMonth(); if (!firstOfMonth.has(key)) firstOfMonth.set(key, k); }
        const keys = [...firstOfMonth.keys()].sort((a, b) => a - b);
        for (let i = 0; i + 1 < keys.length; i++) months[keys[i] % 12].push(pct(firstOfMonth.get(keys[i + 1]).c, firstOfMonth.get(keys[i]).c));
        return months.map((r, m) => ({ month: m, n: r.length, median: median(r), up: r.length ? r.filter((x) => x > 0).length / r.length : null }));
    }

    // Historical analogues: past windows whose shape (z-scored daily log returns), drawdown from the
    // ATH and distance to the 200-day average resemble today — and what followed them.
    function analogs(daily, { window = 60, horizons = [7, 30, 90], k = 8, minGap = 45 } = {}) {
        const n = daily.length;
        if (n < window + 400) return null;
        const c = daily.map((x) => x.c);
        const lr = c.map((v, i) => (i ? Math.log(v / c[i - 1]) : 0));
        const s200 = sma(c, 200);
        let ath = 0;
        const dd = c.map((v) => { ath = Math.max(ath, v); return v / ath - 1; });
        const feat = (end) => {
            const w = lr.slice(end - window + 1, end + 1);
            const m = w.reduce((a, b) => a + b, 0) / window;
            const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / window) || 1e-9;
            const cum = []; let acc = 0;
            for (const x of w) { acc += (x - m) / sd; cum.push(acc); }
            return { cum, dd: dd[end], mayer: s200[end] ? c[end] / s200[end] : 1, vol: sd };
        };
        const cur = feat(n - 1);
        const maxH = Math.max(...horizons);
        const cand = [];
        for (let end = Math.max(window, 200); end < n - 1 - maxH - window; end++) {
            const f = feat(end);
            let d = 0;
            for (let i = 0; i < window; i++) d += (f.cum[i] - cur.cum[i]) ** 2;
            d = Math.sqrt(d / window) + 4 * Math.abs(f.dd - cur.dd) + 2 * Math.abs(Math.log(f.mayer / cur.mayer)) + 0.5 * Math.abs(Math.log(f.vol / cur.vol));
            cand.push({ end, d });
        }
        cand.sort((a, b) => a.d - b.d);
        const picked = [];
        for (const x of cand) { if (picked.every((p) => Math.abs(p.end - x.end) >= minGap)) picked.push(x); if (picked.length >= k) break; }
        const rows = picked.map((p) => ({ t: daily[p.end].t, distance: p.d, fwd: Object.fromEntries(horizons.map((h) => [h, pct(c[p.end + h], c[p.end])])) }));
        const stats = Object.fromEntries(horizons.map((h) => { const xs = rows.map((r) => r.fwd[h]); return [h, { median: median(xs), up: xs.filter((x) => x > 0).length / (xs.length || 1), min: Math.min(...xs), max: Math.max(...xs) }]; }));
        return { window, rows, stats };
    }

    function analyze(daily, now = Date.now()) {
        if (!Array.isArray(daily) || daily.length < 300) return null;
        const c = daily.map((k) => k.c);
        const last = daily[daily.length - 1];
        const s200 = sma(c, 200), s1400 = sma(c, 1400), s50 = sma(c, 50);
        const athK = daily.reduce((a, b) => (b.c > a.c ? b : a));
        const lr = c.map((v, i) => (i ? Math.log(v / c[i - 1]) : 0));
        const volSeries = lr.map((_, i) => { if (i < 30) return null; const w = lr.slice(i - 29, i + 1); const m = w.reduce((a, b) => a + b, 0) / 30; return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / 30) * Math.sqrt(365) * 100; });
        const volNow = volSeries[volSeries.length - 1];
        const volHist = volSeries.filter((x) => x != null);
        const volPct = volHist.filter((x) => x <= volNow).length / volHist.length;
        const mayer = s200[s200.length - 1] ? last.c / s200[s200.length - 1] : null;
        const mayerHist = c.map((v, i) => (s200[i] ? v / s200[i] : null)).filter((x) => x != null);
        const mayerPct = mayer != null ? mayerHist.filter((x) => x <= mayer).length / mayerHist.length : null;
        const slope200 = s200[s200.length - 1] && s200[s200.length - 31] ? pct(s200[s200.length - 1], s200[s200.length - 31]) : 0;
        const regime = last.c > s200[s200.length - 1] && slope200 > 0 ? "bull" : last.c < s200[s200.length - 1] && slope200 < 0 ? "bear" : "seitwärts";
        const dds = drawdowns(daily, 30);
        const cyc = cycleInfo(daily, now);
        const seas = seasonality(daily);
        const an = analogs(daily);
        const month = new Date(now).getUTCMonth();
        // Context score -1 … +1 (negative = historically unfavourable for longs). Context, not a signal.
        let score = 0;
        score += regime === "bull" ? 0.35 : regime === "bear" ? -0.35 : 0;
        if (an && an.stats[30].median != null) score += Math.max(-0.35, Math.min(0.35, an.stats[30].median / 30));
        if (mayer != null) score += mayer > 2.4 ? -0.3 : mayer < 0.8 ? 0.2 : 0;
        if (cyc.phase.includes("Bärenmarkt")) score -= 0.15; else if (cyc.phase.includes("Aufwärtsphase")) score += 0.1;
        score = Math.max(-1, Math.min(1, score));
        return {
            at: now, from: daily[0].t, to: last.t, days: daily.length,
            price: last.c, ath: athK.c, athT: athK.t, ddFromAth: pct(last.c, athK.c),
            sma50: s50[s50.length - 1], sma200: s200[s200.length - 1], sma200w: s1400[s1400.length - 1], slope200,
            mayer, mayerPct, volNow, volPct, regime,
            ret: { d30: pct(last.c, c[c.length - 31]), d365: c.length > 366 ? pct(last.c, c[c.length - 366]) : null },
            drawdowns: dds, cycle: cyc, seasonality: seas, monthNow: seas[month], analogs: an,
            context: { score, label: score >= 0.25 ? "historisch günstig" : score <= -0.25 ? "historisch ungünstig" : "neutral" },
            // Long trades get less risk in a historically unfavourable BTC context (never more).
            riskMult: { long: score <= -0.25 ? Math.max(0.5, 1 + score) : 1, short: score >= 0.25 ? Math.max(0.5, 1 - score) : 1 },
        };
    }

    // Hourly candles (Binance since 2017): typical move and volatility per UTC hour and weekday.
    function intraday(hourly) {
        if (!Array.isArray(hourly) || hourly.length < 24 * 60) return null;
        const hours = Array.from({ length: 24 }, () => ({ r: [], a: [] }));
        const wd = Array.from({ length: 7 }, () => []);
        let dayOpen = null, dayKey = null;
        for (let i = 1; i < hourly.length; i++) {
            const k = hourly[i], p = hourly[i - 1];
            if (!(k.c > 0 && p.c > 0) || k.t - p.t > 3600e3 * 1.5) continue;
            const r = (k.c / p.c - 1) * 100;
            const d = new Date(k.t);
            hours[d.getUTCHours()].r.push(r);
            hours[d.getUTCHours()].a.push(Math.abs(r));
            const key = Math.floor(k.t / DAY);
            if (key !== dayKey) { if (dayOpen && p.c) wd[new Date(p.t).getUTCDay()].push((p.c / dayOpen - 1) * 100); dayKey = key; dayOpen = k.o || p.c; }
        }
        const byHour = hours.map((h, hour) => ({ hour, n: h.r.length, median: median(h.r), absMove: h.a.reduce((x, y) => x + y, 0) / (h.a.length || 1), up: h.r.filter((x) => x > 0).length / (h.r.length || 1) }));
        const byWeekday = wd.map((r, day) => ({ day, n: r.length, median: median(r), up: r.filter((x) => x > 0).length / (r.length || 1) }));
        const sorted = byHour.slice().sort((a, b) => b.absMove - a.absMove);
        return { from: hourly[0].t, to: hourly[hourly.length - 1].t, candles: hourly.length, byHour, byWeekday, busiest: sorted.slice(0, 3).map((x) => x.hour), calmest: sorted.slice(-3).map((x) => x.hour) };
    }

    const fmtP = (x) => (x == null ? "–" : `${x >= 0 ? "plus" : "minus"} ${Math.abs(x).toFixed(0)} Prozent`);
    const fmtD = (t) => new Date(t).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
    function summary(a) {
        if (!a) return "Das BTC-Gedächtnis hat noch nicht genug Daten.";
        const p = [`Ich kenne Bitcoin seit dem ${fmtD(a.from)}, das sind ${a.days} Handelstage.`];
        p.push(`Bitcoin steht bei ${Math.round(a.price)} Dollar, ${Math.abs(a.ddFromAth).toFixed(0)} Prozent unter dem Allzeithoch vom ${fmtD(a.athT)}.`);
        if (a.cycle.daysSince != null) p.push(`Wir sind am Tag ${a.cycle.daysSince} nach dem ${a.cycle.halvingIndex}. Halving, in der ${a.cycle.phase}.`);
        p.push(`Der Markt ist im ${a.regime === "bull" ? "Aufwärtstrend über dem 200-Tage-Schnitt" : a.regime === "bear" ? "Abwärtstrend unter dem 200-Tage-Schnitt" : "Seitwärtsbereich um den 200-Tage-Schnitt"}.`);
        if (a.analogs && a.analogs.stats[30].median != null) p.push(`In den ${a.analogs.rows.length} historisch ähnlichsten Situationen lag Bitcoin 30 Tage später im Mittel bei ${fmtP(a.analogs.stats[30].median)}, in ${Math.round(a.analogs.stats[30].up * 100)} Prozent der Fälle im Plus.`);
        if (a.monthNow && a.monthNow.n) p.push(`Der ${MONTHS[a.monthNow.month]} war bisher in ${Math.round(a.monthNow.up * 100)} Prozent der Jahre positiv.`);
        p.push(`Mein Gesamtbild: ${a.context.label}. Das ist Kontext aus der Geschichte, keine Garantie.`);
        return p.join(" ");
    }
    // Short answers to typical questions (used by Jarvis without an AI).
    function answer(a, t) {
        if (!a) return null;
        t = String(t || "").toLowerCase();
        if (/halving|zyklus/.test(t)) {
            const c = a.cycle;
            const past = c.past.map((x) => `nach dem ${x.n}. Halving kam das Hoch nach ${x.daysToTop} Tagen`).join(", ");
            return `Tag ${c.daysSince} nach dem ${c.halvingIndex}. Halving, Phase: ${c.phase}. Historisch: ${past}. Das nächste Halving wird um den ${fmtD(c.nextHalvingEst)} erwartet.`;
        }
        if (/crash|absturz|einbruch|drawdown|bär/.test(t)) {
            const big = a.drawdowns.slice().sort((x, y) => x.depth - y.depth).slice(0, 3);
            return `Die größten Einbrüche: ${big.map((d) => `${Math.abs(d.depth).toFixed(0)} Prozent ab ${fmtD(d.peakT)}, ${d.recoveryDays ? `Erholung nach ${d.recoveryDays} Tagen` : "noch nicht erholt"}`).join("; ")}. Insgesamt ${a.drawdowns.length} Einbrüche über 30 Prozent.`;
        }
        if (/ähnlich|muster|analog|früher|geschichte|historisch/.test(t) && a.analogs) {
            const top = a.analogs.rows.slice(0, 3).map((r) => `${fmtD(r.t)}, danach ${fmtP(r.fwd[30])} in 30 Tagen`).join("; ");
            return `Die ähnlichsten Situationen: ${top}. Im Mittel aller ${a.analogs.rows.length} Fälle: 7 Tage ${fmtP(a.analogs.stats[7].median)}, 30 Tage ${fmtP(a.analogs.stats[30].median)}, 90 Tage ${fmtP(a.analogs.stats[90].median)}.`;
        }
        if (/allzeithoch|ath|rekord/.test(t)) return `Das Allzeithoch liegt bei ${Math.round(a.ath)} Dollar vom ${fmtD(a.athT)}. Aktuell ${Math.abs(a.ddFromAth).toFixed(1)} Prozent darunter.`;
        if (/uhrzeit|stunde|tageszeit|wochentag|wochenende/.test(t) && a.intraday) {
            const I = a.intraday, D = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
            const best = I.byWeekday.slice().sort((x, y) => y.median - x.median)[0];
            return `Aus ${Math.round(I.candles / 1000)} tausend Stundenkerzen: Am meisten Bewegung gibt es um ${I.busiest.map((h) => `${h} Uhr`).join(", ")} UTC, am ruhigsten ist es um ${I.calmest.map((h) => `${h} Uhr`).join(", ")} UTC. Stärkster Wochentag im Median: ${D[best.day]}.`;
        }
        if (/saison|monat|jahreszeit/.test(t) && a.monthNow) return `Im ${MONTHS[a.monthNow.month]} lag Bitcoin bisher in ${Math.round(a.monthNow.up * 100)} Prozent der Jahre im Plus, Median ${fmtP(a.monthNow.median)}.`;
        return summary(a);
    }

    // ---- data sources ----------------------------------------------------------------------------
    async function getJson(url, ms = 15000) {
        const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
        const t = setTimeout(() => ctl && ctl.abort(), ms);
        try { const r = await fetch(url, ctl ? { signal: ctl.signal } : undefined); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
        finally { clearTimeout(t); }
    }
    // CryptoCompare: complete daily history since July 2010 in one request.
    async function fetchCryptoCompareDaily() {
        const j = await getJson("https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=USD&allData=true");
        const rows = (j && j.Data && j.Data.Data) || [];
        return rows.filter((r) => r.close > 0).map((r) => ({ t: r.time * 1000, o: r.open, h: r.high, l: r.low, c: r.close, v: r.volumeto || 0 }));
    }
    // Bitstamp: daily since 2011, paginated 1000 days per call (optionally via a CORS proxy).
    async function fetchBitstampDaily(proxy) {
        const out = [];
        let start = Date.parse("2011-08-18T00:00:00Z") / 1000;
        for (let i = 0; i < 8; i++) {
            const url = `https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=86400&limit=1000&start=${start}`;
            const j = await getJson(proxy ? proxy(url) : url);
            const rows = (j && j.data && j.data.ohlc) || [];
            if (!rows.length) break;
            for (const r of rows) out.push({ t: +r.timestamp * 1000, o: +r.open, h: +r.high, l: +r.low, c: +r.close, v: +r.volume });
            start = +rows[rows.length - 1].timestamp + 86400;
            if (start * 1000 > Date.now()) break;
        }
        return out;
    }
    // Binance: klines since Aug 2017 for any interval, paginated 1000 per call.
    async function fetchBinance(interval, fromMs, onPage, maxPages = 200) {
        const step = { "1d": DAY, "1h": 3600e3, "4h": 4 * 3600e3 }[interval];
        const out = [];
        let start = fromMs || Date.parse("2017-08-17T00:00:00Z");
        for (let guard = 0; guard < maxPages && start < Date.now() - step; guard++) {
            const j = await getJson(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&startTime=${start}&limit=1000`);
            if (!Array.isArray(j) || !j.length) break;
            for (const r of j) out.push({ t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[7] });
            start = j[j.length - 1][0] + step;
            onPage && onPage(out.length, start);
            if (j.length < 1000) break;
        }
        return out;
    }

    TB.btcBrain = { HALVINGS, NEXT_HALVING_EST, sma, median, mergeDaily, drawdowns, cycleInfo, seasonality, analogs, intraday, analyze, summary, answer, fetchCryptoCompareDaily, fetchBitstampDaily, fetchBinance };
})(typeof window !== "undefined" ? window : globalThis);
