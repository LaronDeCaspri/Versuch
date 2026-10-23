/*
 * Jarvis v41 — German voice assistant for the trading bot.
 *  - Neural voice: Piper "Thorsten" running locally in a worker (jarvis-tts-worker.js),
 *    downloaded once on request and cached on the device. Falls back to the best system voice.
 *  - Listens on `window.dispatchEvent(new CustomEvent('jarvis', {detail:{text, level, kind}}))`.
 *  - Voice commands via the Web Speech API (push-to-talk or wake word "Jarvis"); the answers
 *    come from window.TBJarvisBrain (app.js). Jarvis can pause the bot, never place an order.
 */
(function () {
    "use strict";

    const HF = "https://huggingface.co";
    const VOICES = {
        "thorsten-medium": {
            key: "thorsten-medium", label: "Thorsten · neural", bytes: 63e6,
            urls: [`${HF}/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx`,
                   `${HF}/diffusionstudio/piper-voices/resolve/main/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx`],
        },
        "thorsten-high": {
            key: "thorsten-high", label: "Thorsten Studio · neural HD", bytes: 114e6,
            urls: [`${HF}/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx`,
                   `${HF}/diffusionstudio/piper-voices/resolve/main/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx`],
        },
    };

    // ------------------------------------------------------------------ settings
    const KEY = "tb_jarvis";
    const DEFAULTS = {
        enabled: localStorage.getItem("jarvis_on") === "1",
        engine: "neural",                 // "neural" | "system"
        neuralVoice: "thorsten-medium",
        neuralReady: false,               // model fully downloaded once
        systemVoice: localStorage.getItem("jarvis_voice") || "",
        rate: 1.0, volume: 0.9,
        wake: false, briefing: true,
        speak: { trades: true, alerts: true, news: true, radar: true, info: false },
    };
    const S = (() => {
        try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); return s ? { ...DEFAULTS, ...s, speak: { ...DEFAULTS.speak, ...(s.speak || {}) } } : { ...DEFAULTS }; }
        catch (e) { return { ...DEFAULTS }; }
    })();
    function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage full */ } }

    const R = {
        queue: [], busy: false, phase: "idle",          // idle | loading | speaking | listening | thinking
        ctx: null, analyser: null, gain: null, current: null,
        worker: null, workerReady: false, pending: new Map(), seq: 0,
        recent: new Map(), rec: null, recActive: false, wakeArmed: false,
        level: 0,
    };

    // ------------------------------------------------------------------ helpers
    const $ = (id) => document.getElementById(id);
    const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    const COIN_WORDS = {
        BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana", BNB: "Binance Coin", XRP: "Ripple", ADA: "Cardano",
        AVAX: "Avalanche", LINK: "Chainlink", DOGE: "Dogecoin", DOT: "Polkadot", MATIC: "Polygon", PEPE: "Pepe",
        TRX: "Tron", LTC: "Litecoin", SHIB: "Shiba Inu", TON: "Toncoin", SUI: "Sui", WIF: "dogwifhat",
    };
    function fmtNumDe(raw) {
        const n = Number(raw);
        if (!Number.isFinite(n)) return raw;
        const a = Math.abs(n);
        const d = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
        let s = n.toFixed(d);
        if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
        return s.replace(".", ",");
    }
    // Turns bot messages into something a German voice reads naturally.
    function sayable(text) {
        let t = String(text || "");
        t = t.replace(/https?:\/\/\S+/g, "");
        t = t.replace(/\p{Extended_Pictographic}|️|‍/gu, "");
        t = t.replace(/\b([A-Z]{2,6})\s*(?:\/|gegen)\s*USDT\b/g, (_, s) => COIN_WORDS[s] || s);
        t = t.replace(/\bUSDT\b/g, "Dollar");
        t = t.replace(/\b(BTC|ETH|SOL|BNB|XRP|ADA|AVAX|LINK|DOGE|DOT|MATIC|PEPE|TRX|LTC|SHIB|TON|SUI|WIF)\b/g, (s) => COIN_WORDS[s]);
        t = t.replace(/\bTP\s?(\d)\b/g, "Gewinnziel $1").replace(/\bSL\b/g, "Stop-Loss").replace(/\bPnL\b/gi, "Ergebnis");
        t = t.replace(/\bRSI\b/g, "R S I").replace(/\bDCA\b/g, "D C A").replace(/\bATR\b/g, "A T R").replace(/\bEUR\b/g, "Euro");
        t = t.replace(/\bz\s?=\s?/g, "Z-Wert ").replace(/σ/g, " Sigma").replace(/≤/g, " höchstens ").replace(/≥/g, " mindestens ").replace(/→/g, " auf ").replace(/·/g, ", ");
        t = t.replace(/(^|[\s(:])([+\-−])\s?(?=\d)/g, (m, pre, s) => `${pre}${s === "+" ? "plus " : "minus "}`);
        // German-formatted numbers from the UI ("10.000,50") → plain digits first.
        t = t.replace(/\b\d{1,3}(?:\.\d{3})+,\d+\b|\b\d{1,3}(?:\.\d{3}){2,}\b/g, (m) => m.replace(/\./g, "").replace(",", "."));
        t = t.replace(/(\d+(?:\.\d+)?)\s?%/g, (_, n) => `${fmtNumDe(n)} Prozent`);
        t = t.replace(/\b\d{1,3}(?:[   ]\d{3})+\b/g, (m) => m.replace(/[   ]/g, ""));
        t = t.replace(/\b\d+\.\d+\b/g, (m) => fmtNumDe(m));
        t = t.replace(/\s{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim();
        return t;
    }
    function sentences(t) {
        const parts = t.match(/[^.!?]+[.!?]*/g) || [t];
        const out = [];
        for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
            if (out.length && (out[out.length - 1].length < 28)) out[out.length - 1] += " " + p;
            else out.push(p);
        }
        return out;
    }

    // ------------------------------------------------------------------ audio
    function audio() {
        if (R.ctx) { if (R.ctx.state === "suspended") R.ctx.resume().catch(() => {}); return R.ctx; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        R.ctx = new AC();
        R.gain = R.ctx.createGain();
        R.gain.gain.value = S.volume;
        // Gentle broadcast chain: presence lift + light compression for a clear, even voice.
        const hp = R.ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 70;
        const pres = R.ctx.createBiquadFilter(); pres.type = "peaking"; pres.frequency.value = 3200; pres.Q.value = 0.9; pres.gain.value = 2.5;
        const comp = R.ctx.createDynamicsCompressor();
        comp.threshold.value = -20; comp.knee.value = 18; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.2;
        R.analyser = R.ctx.createAnalyser(); R.analyser.fftSize = 512; R.analyser.smoothingTimeConstant = 0.75;
        R.gain.connect(hp); hp.connect(pres); pres.connect(comp); comp.connect(R.analyser); R.analyser.connect(R.ctx.destination);
        return R.ctx;
    }
    function chime(kind) {
        const ctx = audio();
        if (!ctx) return Promise.resolve();
        const now = ctx.currentTime;
        const notes = kind === "alert" ? [880, 660] : [660, 990];
        notes.forEach((f, i) => {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = "sine"; o.frequency.value = f;
            g.gain.setValueAtTime(0, now + i * 0.12);
            g.gain.linearRampToValueAtTime(0.16, now + i * 0.12 + 0.015);
            g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.22);
            o.connect(g); g.connect(R.gain); o.start(now + i * 0.12); o.stop(now + i * 0.12 + 0.25);
        });
        return new Promise((r) => setTimeout(r, 330));
    }
    function playPcm(pcm, sampleRate) {
        return new Promise((resolve) => {
            const ctx = audio();
            if (!ctx || !pcm.length) return resolve();
            const buf = ctx.createBuffer(1, pcm.length, sampleRate);
            buf.copyToChannel(pcm, 0);
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.connect(R.gain);
            src.onended = () => { if (R.current === src) R.current = null; R.played = (R.played || 0) + 1; resolve(); };
            R.current = src;
            src.start();
        });
    }

    // ------------------------------------------------------------------ neural engine (Piper)
    function worker() {
        if (R.worker) return R.worker;
        R.worker = new Worker("jarvis-tts-worker.js");
        R.worker.onmessage = (e) => {
            const m = e.data || {};
            if (m.type === "progress") onProgress(m.loaded, m.total);
            else if (m.type === "ready") {
                R.workerReady = true; S.neuralReady = true; save();
                setVoiceStatus("ready");
                const p = R.pending.get("init"); if (p) { R.pending.delete("init"); p.resolve(); }
            } else if (m.type === "audio") {
                R.lastSynth = { ms: m.ms, samples: m.pcm.length, sampleRate: m.sampleRate };
                const p = R.pending.get(m.id); if (p) { R.pending.delete(m.id); p.resolve(m); }
            } else if (m.type === "error") {
                const id = m.stage === "init" ? "init" : m.id;
                const p = R.pending.get(id); if (p) { R.pending.delete(id); p.reject(new Error(m.message)); }
                if (m.stage === "init") { R.workerReady = false; setVoiceStatus("error", m.message); }
            } else if (m.type === "purged") {
                R.workerReady = false; S.neuralReady = false; save(); setVoiceStatus("none");
            }
        };
        R.worker.onerror = (e) => { setVoiceStatus("error", e.message || "Worker-Fehler"); };
        return R.worker;
    }
    function loadNeural() {
        if (R.workerReady) return Promise.resolve();
        if (R.pending.has("init")) return R.pending.get("init").promise;
        setVoiceStatus("loading");
        let resolve, reject;
        const promise = new Promise((a, b) => { resolve = a; reject = b; });
        R.pending.set("init", { resolve, reject, promise });
        worker().postMessage({ type: "init", voice: VOICES[S.neuralVoice] || VOICES["thorsten-medium"] });
        return promise;
    }
    function synthNeural(text) {
        const id = ++R.seq;
        return new Promise((resolve, reject) => {
            R.pending.set(id, { resolve, reject });
            worker().postMessage({ type: "speak", id, text, rate: S.rate });
        });
    }
    async function speakNeural(text) {
        const parts = sentences(text);
        // Pipeline: the worker renders sentence n+1 while sentence n plays.
        const jobs = parts.map((p) => synthNeural(p));
        for (const job of jobs) {
            const m = await job;
            if (R.cancelled) return;
            await playPcm(m.pcm, m.sampleRate);
        }
    }

    // ------------------------------------------------------------------ system engine (fallback)
    function systemVoices() { return window.speechSynthesis ? window.speechSynthesis.getVoices() : []; }
    function rankVoice(v) {
        const n = `${v.name} ${v.voiceURI}`.toLowerCase();
        let s = 0;
        if (/^de/i.test(v.lang)) s += 100;
        if (/natural|neural|online|premium|enhanced|wavenet|studio/.test(n)) s += 40;
        if (/google deutsch|conrad|katja|florian|seraphina|killian|amala|anna|petra|markus|yannick|helena/.test(n)) s += 15;
        if (/compact|espeak|robot/.test(n)) s -= 30;
        if (v.localService === false) s += 5;
        return s;
    }
    function bestSystemVoice() {
        const vs = systemVoices();
        if (S.systemVoice) { const v = vs.find((x) => x.name === S.systemVoice); if (v) return v; }
        return vs.slice().sort((a, b) => rankVoice(b) - rankVoice(a))[0] || null;
    }
    function speakSystem(text, level) {
        return new Promise((resolve) => {
            if (!("speechSynthesis" in window)) return resolve();
            const u = new SpeechSynthesisUtterance(text);
            const v = bestSystemVoice();
            if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "de-DE";
            u.rate = S.rate; u.pitch = level === "alert" ? 1.05 : 0.95; u.volume = S.volume;
            const fake = setInterval(() => { R.level = 0.35 + Math.random() * 0.4; }, 90);
            let finished = false;
            // Some engines never fire onend (no voices installed, tab in background) — never block the queue.
            const guard = setTimeout(() => done(), 3000 + text.length * 110 / S.rate);
            function done() { if (finished) return; finished = true; clearTimeout(guard); clearInterval(fake); R.level = 0; resolve(); }
            u.onend = done; u.onerror = done;
            window.speechSynthesis.speak(u);
        });
    }

    // ------------------------------------------------------------------ queue
    const PRIORITY = { alert: 3, warn: 2, success: 2, news: 1, info: 0 };
    function categorize(text, level, kind) {
        if (kind) return kind;
        if (level === "alert") return "alerts";
        if (/Trade|Position|Stop|gekauft|verkauft|Gewinn|Verlust|Order|Kauf|Rebalance/i.test(text)) return "trades";
        if (/Radar/i.test(text)) return "radar";
        return "info";
    }
    function speak(text, level = "info", opts = {}) {
        if (!text) return;
        const kind = categorize(text, level, opts.kind);
        writeLog(text, level);
        if (!S.enabled) return;
        if (!opts.force && S.speak[kind] === false) return;
        const say = sayable(text);
        const last = R.recent.get(say);
        if (!opts.force && last && Date.now() - last < 90e3) return;
        R.recent.set(say, Date.now());
        if (R.recent.size > 60) R.recent.delete(R.recent.keys().next().value);
        const item = { say, level, kind, prio: PRIORITY[level] ?? 0, chime: opts.chime ?? (level === "alert" || kind === "news") };
        // Keep it calm: low-priority chatter is dropped when Jarvis is already busy.
        if (item.prio === 0 && R.queue.length >= 2 && !opts.force) return;
        const i = R.queue.findIndex((q) => q.prio < item.prio);
        if (i === -1) R.queue.push(item); else R.queue.splice(i, 0, item);
        if (R.queue.length > 6) R.queue.length = 6;
        if (!R.busy) drain();
    }
    async function drain() {
        const item = R.queue.shift();
        if (!item) { R.busy = false; setPhase(R.recActive ? "listening" : "idle"); resumeWake(); return; }
        R.busy = true; R.cancelled = false;
        pauseWake();
        setPhase("speaking", item.say);
        try {
            if (item.chime) await chime(item.level);
            if (S.engine === "neural" && S.neuralReady) {
                try { await loadNeural(); await speakNeural(item.say); }
                catch (e) { await speakSystem(item.say, item.level); }
            } else {
                await speakSystem(item.say, item.level);
            }
        } catch (e) { /* keep the queue alive */ }
        setTimeout(drain, 220);
    }
    function stopSpeaking() {
        R.queue = []; R.cancelled = true;
        try { if (R.current) R.current.stop(); } catch (e) { /* already stopped */ }
        try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    }

    // ------------------------------------------------------------------ listening (Web Speech API)
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    function recognizer() {
        if (!SR) return null;
        if (R.rec) return R.rec;
        const rec = new SR();
        rec.lang = "de-DE"; rec.interimResults = true; rec.maxAlternatives = 1;
        rec.onresult = (e) => {
            let interim = "", final = "";
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const r = e.results[i];
                if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
            }
            showTranscript(final || interim, !final);
            if (final) onHeard(final.trim());
        };
        rec.onerror = (e) => {
            if (e.error === "not-allowed" || e.error === "service-not-allowed") {
                S.wake = false; save(); syncSettings();
                setSub("Mikrofon blockiert — bitte im Browser erlauben.");
            }
        };
        rec.onend = () => {
            R.recActive = false;
            if (S.enabled && S.wake && R.wakeArmed && !R.busy) setTimeout(() => startListening(true), 400);
            else if (!R.busy) setPhase("idle");
        };
        R.rec = rec;
        return rec;
    }
    function startListening(wakeMode = false) {
        const rec = recognizer();
        if (!rec) { setSub("Spracheingabe wird von diesem Browser nicht unterstützt (Chrome, Edge oder Safari nutzen)."); return; }
        if (R.recActive) return;
        audio();
        R.wakeMode = wakeMode;
        rec.continuous = wakeMode;
        try { rec.start(); R.recActive = true; setPhase("listening"); } catch (e) { /* already running */ }
    }
    function stopListening() { R.wakeArmed = false; try { R.rec && R.rec.stop(); } catch (e) { /* ignore */ } }
    function pauseWake() { if (R.recActive) { try { R.rec.abort(); } catch (e) { /* ignore */ } R.recActive = false; } }
    function resumeWake() { if (S.enabled && S.wake && R.wakeArmed && !R.recActive) setTimeout(() => startListening(true), 500); }

    function onHeard(text) {
        let cmd = text;
        if (R.wakeMode) {
            const m = /\b(jarvis|jervis|dschawis|tschawis|javis)\b[,.!]?\s*(.*)$/i.exec(text);
            if (!m) return;                          // ignore everything without the wake word
            cmd = m[2].trim();
            if (!cmd) { speak("Ja?", "info", { force: true, chime: false }); return; }
        }
        handleCommand(cmd);
    }
    function handleCommand(text) {
        const t = text.toLowerCase();
        writeLog(`Du: ${text}`, "user");
        if (/^(stopp?|ruhe|halt)\b|sei still|still sein/.test(t) && !/bot|automatik|handel/.test(t)) { stopSpeaking(); return; }
        if (/leiser/.test(t)) { setVolume(S.volume - 0.15); speak("Etwas leiser.", "info", { force: true }); return; }
        if (/lauter/.test(t)) { setVolume(S.volume + 0.15); speak("Etwas lauter.", "info", { force: true }); return; }
        if (/schneller/.test(t)) { setRate(S.rate + 0.1); speak("Ich spreche etwas schneller.", "info", { force: true }); return; }
        if (/langsamer/.test(t)) { setRate(S.rate - 0.1); speak("Ich spreche etwas langsamer.", "info", { force: true }); return; }
        setPhase("thinking");
        let reply = null;
        try { reply = window.TBJarvisBrain ? window.TBJarvisBrain.answer(text) : null; } catch (e) { reply = null; }
        speak(reply || "Das habe ich nicht verstanden. Sag zum Beispiel: Lagebericht, Positionen oder Bitcoin-Kurs.", "info", { force: true, chime: false });
    }

    // ------------------------------------------------------------------ UI
    function setPhase(p, text) {
        R.phase = p;
        const titles = { idle: S.enabled ? "Bereit" : "Ausgeschaltet", speaking: "Spricht …", listening: "Hört zu …", thinking: "Denkt nach …", loading: "Lädt Stimme …" };
        const el = $("jv2-title"); if (el) el.textContent = titles[p] || "Bereit";
        const card = $("jarvis-card"); if (card) card.dataset.phase = p;
        syncFab();
        if (p === "speaking" && text) setSub(text);
        else if (p === "idle") setSub(engineLabel());
    }
    function fab() {
        let b = $("jv2-fab");
        if (!b) {
            b = document.createElement("button");
            b.id = "jv2-fab"; b.className = "jv2-fab"; b.type = "button";
            b.innerHTML = `<span class="jv2-fab-core"></span><span class="jv2-fab-ring"></span>`;
            b.addEventListener("click", () => {
                if (!S.enabled) { const c = $("jarvis-card"); if (c) c.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
                if (R.phase === "speaking") { stopSpeaking(); return; }
                if (R.recActive && !R.wakeMode) stopListening(); else startListening(false);
            });
            document.body.appendChild(b);
        }
        return b;
    }
    function syncFab() {
        const b = fab();
        b.dataset.phase = R.phase;
        b.classList.toggle("on", S.enabled);
        const label = !S.enabled ? "Jarvis öffnen" : R.phase === "speaking" ? "Jarvis unterbrechen" : R.phase === "listening" ? "Zuhören beenden" : "Mit Jarvis sprechen";
        b.setAttribute("aria-label", label); b.title = label;
    }
    function setSub(t) { const el = $("jv2-sub"); if (el) el.textContent = t; }
    function engineLabel() {
        if (!S.enabled) return "Aktivieren, damit Jarvis spricht und zuhört.";
        if (S.engine === "neural" && S.neuralReady) return `Stimme: ${VOICES[S.neuralVoice].label} · lokal auf diesem Gerät`;
        const v = bestSystemVoice();
        return v ? `Stimme: ${v.name} (Systemstimme)` : "Systemstimme";
    }
    function showTranscript(text, interim) {
        const el = $("jv2-transcript");
        if (!el) return;
        el.hidden = !text;
        el.classList.toggle("interim", !!interim);
        el.textContent = text ? `„${text}"` : "";
        clearTimeout(R.trT);
        if (!interim) R.trT = setTimeout(() => { el.hidden = true; }, 6000);
    }
    function writeLog(text, level) {
        const log = $("jarvis-log");
        if (!log) return;
        const div = document.createElement("div");
        div.className = `jv-line jv-${level}`;
        const t = new Date().toLocaleTimeString("de-DE", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
        div.innerHTML = `<span class="jv-time">${esc(t)}</span><span class="jv-text">${esc(text)}</span>`;
        log.prepend(div);
        while (log.children.length > 30) log.removeChild(log.lastChild);
    }
    function onProgress(loaded, total) {
        const pct = total ? Math.min(100, Math.round(loaded / total * 100)) : 0;
        const bar = $("jv2-bar"); if (bar) bar.style.width = `${pct}%`;
        const txt = $("jv2-progress-txt");
        if (txt) txt.textContent = `${(loaded / 1e6).toFixed(0)} von ${(total / 1e6 || VOICES[S.neuralVoice].bytes / 1e6).toFixed(0)} MB`;
    }
    function setVoiceStatus(state, msg) {
        const box = $("jv2-voice");
        if (!box) return;
        const v = VOICES[S.neuralVoice];
        box.dataset.state = state;
        if (state === "loading") {
            box.innerHTML = `<div class="jv2-vrow"><strong>Neurale Stimme wird geladen</strong><span id="jv2-progress-txt">startet …</span></div>
                <div class="jv2-track"><div id="jv2-bar" class="jv2-bar"></div></div>
                <small>Einmaliger Download, danach offline auf diesem Gerät gespeichert.</small>`;
            setPhase("loading");
        } else if (state === "ready") {
            box.innerHTML = `<div class="jv2-vrow"><strong>✓ ${esc(v.label)}</strong><span>lokal · kein Server</span></div>`;
            if (R.phase === "loading") setPhase("idle");
        } else if (state === "error") {
            box.innerHTML = `<div class="jv2-vrow"><strong>Neurale Stimme nicht verfügbar</strong><button class="ghost" data-jv="load">Erneut versuchen</button></div>
                <small>${esc(msg || "Download fehlgeschlagen")} — bis dahin spricht die beste Systemstimme.</small>`;
            if (R.phase === "loading") setPhase("idle");
        } else {
            box.innerHTML = `<div class="jv2-vrow"><strong>Neurale Jarvis-Stimme</strong><button class="primary" data-jv="load">Laden · ${Math.round(v.bytes / 1e6)} MB</button></div>
                <small>Natürliche deutsche Männerstimme (Piper „Thorsten“). Läuft komplett im Browser, einmal laden, dann offline. Im WLAN empfohlen.</small>`;
        }
    }
    function syncSettings() {
        const set = (id, v) => { const el = $(id); if (el) { if (el.type === "checkbox") el.checked = !!v; else el.value = v; } };
        set("jv2-rate", S.rate); set("jv2-vol", S.volume);
        set("jv2-wake", S.wake); set("jv2-brief-auto", S.briefing);
        for (const k of Object.keys(S.speak)) set(`jv2-say-${k}`, S.speak[k]);
        const sel = $("jarvis-voice-picker");
        if (sel) {
            const sys = systemVoices().slice().sort((a, b) => rankVoice(b) - rankVoice(a));
            sel.innerHTML = Object.values(VOICES).map((v) => `<option value="neural:${v.key}">${esc(v.label)}</option>`).join("")
                + (sys.length ? `<optgroup label="Systemstimmen">${sys.map((v) => `<option value="system:${esc(v.name)}">${esc(v.name)} (${esc(v.lang)})</option>`).join("")}</optgroup>` : "");
            sel.value = S.engine === "neural" ? `neural:${S.neuralVoice}` : `system:${S.systemVoice || (bestSystemVoice() || {}).name || ""}`;
        }
        const btn = $("jarvis-toggle");
        if (btn) { btn.textContent = S.enabled ? "Jarvis aus" : "Jarvis aktivieren"; btn.classList.toggle("primary", !S.enabled); }
        const badge = $("jarvis-badge");
        if (badge) { badge.textContent = S.enabled ? (S.engine === "neural" && S.neuralReady ? "neural" : "aktiv") : "aus"; badge.classList.toggle("on", S.enabled); }
        const mic = $("jv2-mic"); if (mic) mic.disabled = !S.enabled || !SR;
        const card = $("jarvis-card"); if (card) card.classList.toggle("on", S.enabled);
        if (R.phase === "idle") setPhase("idle");
        syncFab();
    }
    function setVolume(v) { S.volume = Math.max(0.1, Math.min(1, v)); if (R.gain) R.gain.gain.value = S.volume; save(); syncSettings(); }
    function setRate(v) { S.rate = Math.max(0.7, Math.min(1.4, Math.round(v * 100) / 100)); save(); syncSettings(); }

    // Arc-reactor orb: rings react to the actual output level of the voice.
    function startOrb() {
        const cv = $("jv2-orb");
        if (!cv || !cv.getContext) return;
        const g = cv.getContext("2d");
        const data = new Uint8Array(256);
        let t = 0, lvl = 0;
        const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        function frame() {
            const dpr = window.devicePixelRatio || 1;
            const size = cv.clientWidth || 160;
            if (cv.width !== Math.round(size * dpr)) { cv.width = Math.round(size * dpr); cv.height = Math.round(size * dpr); }
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            g.clearRect(0, 0, size, size);
            let target = 0;
            if (R.phase === "speaking" && R.analyser && R.current) {
                R.analyser.getByteTimeDomainData(data);
                let sum = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
                target = Math.min(1, Math.sqrt(sum / data.length) * 4.5);
            } else if (R.phase === "speaking") target = R.level;
            else if (R.phase === "listening") target = 0.25 + 0.15 * Math.sin(t * 4);
            else if (R.phase === "thinking" || R.phase === "loading") target = 0.2;
            lvl += (target - lvl) * 0.25;
            const c = size / 2, base = size * 0.2;
            const on = S.enabled;
            const hue = R.phase === "listening" ? 160 : R.phase === "thinking" || R.phase === "loading" ? 40 : 265;
            const glow = g.createRadialGradient(c, c, base * 0.2, c, c, size * 0.5);
            glow.addColorStop(0, `hsla(${hue}, 90%, 70%, ${on ? 0.55 + lvl * 0.4 : 0.15})`);
            glow.addColorStop(0.45, `hsla(${hue}, 85%, 55%, ${on ? 0.16 + lvl * 0.2 : 0.05})`);
            glow.addColorStop(1, "hsla(0,0%,0%,0)");
            g.fillStyle = glow; g.beginPath(); g.arc(c, c, size * 0.5, 0, Math.PI * 2); g.fill();
            for (let k = 0; k < 3; k++) {
                const r = base * (1.25 + k * 0.42) + lvl * size * 0.05 * (k + 1);
                g.strokeStyle = `hsla(${hue}, 90%, ${72 - k * 8}%, ${on ? 0.65 - k * 0.17 : 0.18})`;
                g.lineWidth = 1.6 - k * 0.3;
                g.setLineDash(k === 1 ? [4, 6] : k === 2 ? [1, 7] : []);
                g.beginPath();
                const rot = reduce ? 0 : t * (k % 2 ? -0.6 : 0.4) * (1 + lvl);
                g.arc(c, c, r, rot, rot + Math.PI * (k === 0 ? 2 : 1.6));
                g.stroke();
            }
            g.setLineDash([]);
            if (R.phase === "speaking" && R.analyser && R.current) {
                R.analyser.getByteFrequencyData(data);
                const bars = 48;
                for (let i = 0; i < bars; i++) {
                    const v = data[2 + i * 2] / 255;
                    const a = (i / bars) * Math.PI * 2 - Math.PI / 2;
                    const r1 = base * 1.05, r2 = r1 + 4 + v * size * 0.13;
                    g.strokeStyle = `hsla(${hue + v * 40}, 95%, 72%, ${0.35 + v * 0.6})`;
                    g.lineWidth = 2; g.beginPath();
                    g.moveTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.lineTo(c + Math.cos(a) * r2, c + Math.sin(a) * r2); g.stroke();
                }
            }
            const core = g.createRadialGradient(c, c, 0, c, c, base);
            core.addColorStop(0, on ? "#ffffff" : "#71717a");
            core.addColorStop(0.35, `hsla(${hue}, 95%, ${on ? 78 : 40}%, 1)`);
            core.addColorStop(1, `hsla(${hue}, 80%, ${on ? 45 : 22}%, 0.95)`);
            g.fillStyle = core; g.beginPath(); g.arc(c, c, base * (0.92 + lvl * 0.12), 0, Math.PI * 2); g.fill();
            t += 1 / 60;
            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    // ------------------------------------------------------------------ lifecycle
    function enable() {
        S.enabled = true; save();
        audio();
        // Unlock speechSynthesis on iOS within the user gesture.
        try { if (window.speechSynthesis) window.speechSynthesis.speak(new SpeechSynthesisUtterance("")); } catch (e) { /* ignore */ }
        syncSettings();
        if (S.engine === "neural" && S.neuralReady) loadNeural().catch(() => {});
        if (S.wake) { R.wakeArmed = true; startListening(true); }
        const brief = window.TBJarvisBrain && window.TBJarvisBrain.answer("lagebericht");
        speak(brief ? `Jarvis online. ${brief}` : "Jarvis online. Ich melde mich bei Trades, Alarmen und wichtigen Nachrichten.", "info", { force: true });
    }
    function disable() {
        stopSpeaking(); stopListening();
        S.enabled = false; save();
        setPhase("idle"); syncSettings();
    }

    function bind() {
        const card = $("jarvis-card");
        if (!card) return;
        card.addEventListener("click", (e) => {
            const b = e.target.closest("button, [data-jv]");
            if (!b) return;
            if (b.id === "jarvis-toggle") { S.enabled ? disable() : enable(); }
            else if (b.id === "jv2-mic") { if (R.recActive && !R.wakeMode) stopListening(); else { stopSpeaking(); startListening(false); } }
            else if (b.id === "jv2-brief") { if (!S.enabled) enable(); else handleCommand("Lagebericht"); }
            else if (b.dataset.jv === "load") { audio(); S.engine = "neural"; save(); loadNeural().then(() => { syncSettings(); speak("Neurale Stimme bereit. So klinge ich ab jetzt.", "info", { force: true }); }).catch(() => {}); }
            else if (b.dataset.jv === "test") { if (!S.enabled) enable(); else speak("Guten Tag. Bitcoin steht bei achtundsechzigtausend Dollar, plus eins Komma zwei Prozent. Alle Positionen sind abgesichert.", "info", { force: true }); }
            else if (b.dataset.jv === "purge") { if (R.worker) R.worker.postMessage({ type: "purge" }); else { try { caches.delete("jarvis-voice-v1"); } catch (err) { /* ignore */ } S.neuralReady = false; save(); setVoiceStatus("none"); } S.engine = "system"; save(); syncSettings(); }
        });
        card.addEventListener("change", (e) => {
            const el = e.target;
            if (el.id === "jarvis-voice-picker") {
                const [eng, name] = el.value.split(/:(.*)/s);
                if (eng === "neural") {
                    const changed = S.neuralVoice !== name;
                    S.engine = "neural"; S.neuralVoice = name;
                    if (changed) { S.neuralReady = false; R.workerReady = false; }
                    save(); setVoiceStatus(S.neuralReady ? "ready" : "none");
                } else { S.engine = "system"; S.systemVoice = name; save(); }
                syncSettings();
                if (S.enabled) speak("Stimme geändert.", "info", { force: true });
            } else if (el.id === "jv2-rate") setRate(Number(el.value));
            else if (el.id === "jv2-vol") setVolume(Number(el.value));
            else if (el.id === "jv2-wake") {
                S.wake = el.checked; save();
                if (S.wake && S.enabled) { R.wakeArmed = true; startListening(true); } else stopListening();
            } else if (el.id === "jv2-brief-auto") { S.briefing = el.checked; save(); }
            else if (el.id && el.id.startsWith("jv2-say-")) { S.speak[el.id.slice(8)] = el.checked; save(); }
        });
    }

    window.jarvis = {
        speak, enable, disable, stop: stopSpeaking, listen: () => startListening(false), command: handleCommand, sayable, settings: S,
        status: () => ({ phase: R.phase, busy: R.busy, queue: R.queue.length, neural: R.workerReady, engine: S.engine, lastSynth: R.lastSynth || null, played: R.played || 0 }),
    };
    window.addEventListener("jarvis", (ev) => {
        const d = ev.detail || {};
        speak(d.text || "", d.level || "info", { kind: d.kind });
    });

    function boot() {
        bind();
        setVoiceStatus(S.neuralReady ? "ready" : "none");
        syncSettings();
        setPhase("idle");
        startOrb();
        if ("speechSynthesis" in window) window.speechSynthesis.onvoiceschanged = syncSettings;
        if (!SR) { const mic = $("jv2-mic"); if (mic) mic.title = "Spracheingabe: Chrome, Edge oder Safari"; }
        // Browsers only allow audio after a tap: if Jarvis was on, arm it with the first interaction.
        if (S.enabled) {
            const arm = () => {
                document.removeEventListener("pointerdown", arm, true);
                audio();
                if (S.engine === "neural" && S.neuralReady) loadNeural().catch(() => {});
                if (S.wake) { R.wakeArmed = true; startListening(true); }
                maybeBriefing();
            };
            document.addEventListener("pointerdown", arm, true);
        }
    }
    // Once per day: short morning briefing on the first tap.
    function maybeBriefing() {
        if (!S.briefing || !window.TBJarvisBrain) return;
        const today = new Date().toDateString();
        if (localStorage.getItem("tb_jarvis_brief_day") === today) return;
        localStorage.setItem("tb_jarvis_brief_day", today);
        setTimeout(() => speak(window.TBJarvisBrain.answer("lagebericht"), "info", { force: true }), 600);
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
