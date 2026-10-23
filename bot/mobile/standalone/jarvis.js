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
        engine: "neural",                 // "neural" | "premium" | "system"
        neuralVoice: "thorsten-medium",
        neuralReady: false,               // model fully downloaded once
        systemVoice: localStorage.getItem("jarvis_voice") || "",
        rate: 1.0, volume: 0.9,
        wake: false, briefing: true,
        fx: true,                         // Jarvis-Klang: tiefer, klarer, leicht digitaler Raum
        convo: true,                      // Gesprächsmodus: nach jeder Antwort automatisch weiter zuhören
        premiumKey: "", premiumVoice: "onwK4e9ZLuTAKqWW03F9",   // ElevenLabs (optional, eigener Schlüssel)
        speak: { trades: true, alerts: true, news: true, radar: true, info: false },
    };
    const S = (() => {
        try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); return s ? { ...DEFAULTS, ...s, speak: { ...DEFAULTS.speak, ...(s.speak || {}) } } : { ...DEFAULTS }; }
        catch (e) { return { ...DEFAULTS }; }
    })();
    function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage full */ } }
    // Three ways to get Jarvis listening: "button" (tap), "wake" ("Jarvis, …" in one sentence),
    // "okjarvis" (hotword opens a conversation that ends on silence).
    if (!["button", "wake", "okjarvis"].includes(S.listen)) S.listen = S.wake ? "wake" : "button";
    const wakeOn = () => S.listen === "wake" || S.listen === "okjarvis";
    const HOT = /\b(?:o\.?\s?k\.?|okay|okey|hey)\s*[,.!]?\s*(?:jarvis|jervis|javis|jarwis|dschawis|tschawis|charvis)\b/i;

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
        const ctx = R.ctx = new AC();
        R.gain = ctx.createGain();
        R.gain.gain.value = S.volume;
        const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 70;
        // Jarvis voicing: warm low end, forward presence, a little air on top.
        const warm = ctx.createBiquadFilter(); warm.type = "lowshelf"; warm.frequency.value = 180;
        const pres = ctx.createBiquadFilter(); pres.type = "peaking"; pres.frequency.value = 3200; pres.Q.value = 0.9; pres.gain.value = 2.5;
        const air = ctx.createBiquadFilter(); air.type = "highshelf"; air.frequency.value = 9000;
        const dry = ctx.createGain();
        // Subtle digital "presence": two short modulated delays (chorus) + a small synthetic room.
        const chorusIn = ctx.createGain();
        const wet = ctx.createGain();
        [0.011, 0.017].forEach((base, i) => {
            const d = ctx.createDelay(0.05); d.delayTime.value = base;
            const lfo = ctx.createOscillator(); lfo.frequency.value = 0.25 + i * 0.17;
            const depth = ctx.createGain(); depth.gain.value = 0.0012;
            lfo.connect(depth); depth.connect(d.delayTime); lfo.start();
            chorusIn.connect(d); d.connect(wet);
        });
        const room = ctx.createConvolver();
        const len = Math.round(ctx.sampleRate * 0.55), ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
        room.buffer = ir;
        const roomGain = ctx.createGain();
        chorusIn.connect(room); room.connect(roomGain);
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -20; comp.knee.value = 18; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.2;
        R.analyser = ctx.createAnalyser(); R.analyser.fftSize = 512; R.analyser.smoothingTimeConstant = 0.75;
        R.gain.connect(hp); hp.connect(warm); warm.connect(pres); pres.connect(air);
        air.connect(dry); air.connect(chorusIn);
        dry.connect(comp); wet.connect(comp); roomGain.connect(comp);
        comp.connect(R.analyser); R.analyser.connect(ctx.destination);
        R.fxNodes = { warm, air, wet, roomGain };
        applyFx();
        return ctx;
    }
    function applyFx() {
        const n = R.fxNodes;
        if (!n) return;
        n.warm.gain.value = S.fx ? 2.5 : 0;
        n.air.gain.value = S.fx ? 2 : 0;
        n.wet.gain.value = S.fx ? 0.16 : 0;
        n.roomGain.gain.value = S.fx ? 0.07 : 0;
    }
    // Jarvis-Klang lowers the pitch a touch; synthesis runs faster by the same factor so the tempo stays.
    const fxPitch = () => (S.fx ? 0.93 : 1);
    function chime(kind) {
        const ctx = audio();
        if (!ctx) return Promise.resolve();
        const now = ctx.currentTime;
        const notes = kind === "alert" ? [880, 660] : kind === "listen" ? [587, 880] : kind === "end" ? [740, 494] : [660, 990];
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
            src.playbackRate.value = fxPitch();
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
            worker().postMessage({ type: "speak", id, text, rate: S.rate / fxPitch() });
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

    // ------------------------------------------------------------------ premium engine (ElevenLabs, optional)
    async function synthPremium(text) {
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(S.premiumVoice || "onwK4e9ZLuTAKqWW03F9")}?output_format=mp3_44100_128`, {
            method: "POST",
            headers: { "xi-api-key": S.premiumKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
            body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true } }),
        });
        if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}`);
        const ctx = audio();
        return ctx.decodeAudioData(await res.arrayBuffer());
    }
    function playBuffer(buf) {
        return new Promise((resolve) => {
            const ctx = audio();
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.connect(R.gain);
            src.onended = () => { if (R.current === src) R.current = null; R.played = (R.played || 0) + 1; resolve(); };
            R.current = src;
            src.start();
        });
    }
    async function speakPremium(text) {
        const jobs = sentences(text).map((p) => synthPremium(p));
        for (const job of jobs) {
            const buf = await job;
            if (R.cancelled) return;
            await playBuffer(buf);
        }
    }

    // ------------------------------------------------------------------ system engine (fallback)
    function systemVoices() { return window.speechSynthesis ? window.speechSynthesis.getVoices() : []; }
    function rankVoice(v) {
        const n = `${v.name} ${v.voiceURI}`.toLowerCase();
        let s = 0;
        if (/^de/i.test(v.lang)) s += 100;
        if (/natural|neural|online|premium|enhanced|wavenet|studio/.test(n)) s += 40;
        // Jarvis is a male voice: prefer male German voices, push female ones down.
        if (/conrad|killian|florian|markus|yannick|stefan|viktor|martin|bernd|male|männlich|-deg|-deb/.test(n)) s += 35;
        if (/google deutsch|katja|seraphina|amala|anna|petra|helena|hedda|marlene|vicki|female|weiblich/.test(n)) s -= 25;
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
        prepare(item);
        const i = R.queue.findIndex((q) => q.prio < item.prio);
        if (i === -1) R.queue.push(item); else R.queue.splice(i, 0, item);
        if (R.queue.length > 6) R.queue.length = 6;
        if (!R.busy) drain();
    }
    async function drain() {
        const item = R.queue.shift();
        if (!item) {
            R.busy = false;
            if (R.convoOn && S.enabled && !R.recActive) { setTimeout(() => { if (!R.busy && R.convoOn) startListening(false, true); }, 350); return; }
            setPhase(R.recActive ? "listening" : "idle"); resumeWake(); return;
        }
        R.busy = true; R.cancelled = false;
        pauseWake();
        setPhase("speaking", item.say);
        try {
            if (item.chime) await chime(item.level);
            if (item.audio) {
                try { await playPrepared(item); }
                catch (e) { voiceFailed(S.engine === "premium" ? "Premium-Stimme" : "Neurale Stimme", e); if (!R.cancelled) await speakSystem(item.say, item.level); }
            } else if (S.engine === "premium" && S.premiumKey) {
                try { await speakPremium(item.say); }
                catch (e) { voiceFailed("Premium-Stimme", e); await speakLocal(item); }
            } else {
                await speakLocal(item);
            }
        } catch (e) { /* keep the queue alive */ }
        setTimeout(drain, item.kind === "dialog" ? 30 : 200);
    }
    // Audio is rendered the moment a sentence is queued, so the next sentence is ready when the
    // current one ends — no pause between sentences of an answer.
    function prepare(item) {
        try {
            if (S.engine === "premium" && S.premiumKey && audio()) {
                item.audio = sentences(item.say).map((p) => synthPremium(p).then((buf) => ({ buf }), (err) => ({ err })));
            } else if (S.engine !== "system" && S.neuralReady && R.workerReady) {
                item.audio = sentences(item.say).map((p) => synthNeural(p).then((m) => ({ pcm: m.pcm, sr: m.sampleRate }), (err) => ({ err })));
            }
        } catch (e) { item.audio = null; }
    }
    async function playPrepared(item) {
        for (const job of item.audio) {
            const r = await job;
            if (R.cancelled) return;
            if (r.err) throw r.err;
            if (r.pcm) await playPcm(r.pcm, r.sr); else await playBuffer(r.buf);
        }
    }
    async function speakLocal(item) {
        if (S.engine !== "system" && S.neuralReady) {
            try { await loadNeural(); await speakNeural(item.say); return; }
            catch (e) { voiceFailed("Neurale Stimme", e); }
        }
        await speakSystem(item.say, item.level);
    }
    // A failing engine is never silent: show why, once per minute, and keep talking with the fallback.
    function voiceFailed(what, e) {
        if (Date.now() - (R.lastVoiceErr || 0) < 60e3) return;
        R.lastVoiceErr = Date.now();
        const msg = `${what} gerade nicht verfügbar (${(e && e.message) || "Fehler"}) — spreche mit Systemstimme.`;
        writeLog(msg, "warn");
        setSub(msg);
    }
    function stopSpeaking() {
        R.queue = []; R.cancelled = true;
        if (R.worker) R.worker.postMessage({ type: "cancel", seq: R.seq });
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
            if (R.wakeMode && S.listen === "okjarvis") { onHotword(rec, final || interim, !!final); return; }
            showTranscript(final || interim, !final);
            if (R.consumed) return;
            clearTimeout(R.endT);
            if (final) { R.heard = true; if (!R.wakeMode) R.consumed = true; onHeard(final.trim()); return; }
            // Browsers wait ~1 s of silence before "final"; a transcript that hasn't changed for
            // 700 ms is the end of the sentence in a conversation.
            if (!R.wakeMode && interim.trim()) R.endT = setTimeout(() => {
                if (R.consumed) return;
                R.heard = true; R.consumed = true;
                try { rec.abort(); } catch (e) { /* ignore */ }
                showTranscript(interim, false);
                onHeard(interim.trim());
            }, 700);
        };
        rec.onerror = (e) => {
            if (e.error === "not-allowed" || e.error === "service-not-allowed") {
                S.listen = "button"; save(); syncSettings();
                setSub("Mikrofon blockiert — bitte im Browser erlauben.");
            }
        };
        rec.onend = () => {
            R.recActive = false;
            // Hotword heard with nothing after it: open the conversation now that the mic is free.
            if (R.pendingFollow) { R.pendingFollow = false; startListening(false, true); return; }
            if (R.suppressRestart) { R.suppressRestart = false; return; }
            // Follow-up listening that heard nothing ends the conversation quietly.
            if (R.followUp && !R.heard) { R.convoOn = false; if (S.listen === "okjarvis" && S.enabled) chime("end"); }
            if (S.enabled && wakeOn() && R.wakeArmed && !R.busy) setTimeout(() => { if (!R.recActive && !R.busy) startListening(true); }, 400);
            else if (!R.busy) setPhase("idle");
        };
        R.rec = rec;
        return rec;
    }
    function startListening(wakeMode = false, followUp = false) {
        const rec = recognizer();
        if (!rec) { setSub("Spracheingabe wird von diesem Browser nicht unterstützt (Chrome, Edge oder Safari nutzen)."); return; }
        if (R.recActive) return;
        audio();
        R.wakeMode = wakeMode;
        R.heard = false; R.consumed = false; R.followUp = followUp; clearTimeout(R.endT);
        rec.continuous = wakeMode;
        R.hotAt = 0; clearTimeout(R.hotT);
        try { rec.start(); R.recActive = true; setPhase(wakeMode ? "standby" : "listening"); } catch (e) { /* already running */ }
    }
    // "OK Jarvis": tone + listening state the moment the hotword appears (interim results are
    // enough). Words right after it are the first question; otherwise a fresh listening turn opens.
    function onHotword(rec, text, isFinal) {
        if (R.consumed) return;
        const m = HOT.exec(text || "");
        if (!m) return;
        const rest = text.slice(m.index + m[0].length).replace(/^[\s,.!?]+/, "").trim();
        if (!R.hotAt) { R.hotAt = Date.now(); stopSpeaking(); chime("listen"); setPhase("listening"); }
        showTranscript(rest || "…", !isFinal);
        clearTimeout(R.hotT);
        const fire = () => {
            if (R.consumed) return;
            R.consumed = true; R.hotAt = 0; R.heard = true;
            if (rest) { R.suppressRestart = true; R.convoOn = true; try { rec.abort(); } catch (e) { /* ignore */ } showTranscript(rest, false); handleCommand(rest); }
            else { R.convoOn = true; R.pendingFollow = true; try { rec.abort(); } catch (e) { R.pendingFollow = false; startListening(false, true); } }
        };
        if (isFinal) fire(); else R.hotT = setTimeout(fire, rest ? 800 : 1200);
    }
    // Tap to talk — also while the background hotword listener holds the microphone.
    function listenNow() {
        if (R.recActive && !R.wakeMode) { R.suppressRestart = !wakeOn(); try { R.rec.stop(); } catch (e) { /* ignore */ } return; }
        stopSpeaking();
        R.convoOn = S.convo;
        if (R.recActive && R.wakeMode) { R.pendingFollow = true; try { R.rec.abort(); } catch (e) { R.pendingFollow = false; } return; }
        startListening(false);
    }
    function stopListening() { R.wakeArmed = false; try { R.rec && R.rec.stop(); } catch (e) { /* ignore */ } }
    function pauseWake() { if (R.recActive) { R.suppressRestart = true; try { R.rec.abort(); } catch (e) { R.suppressRestart = false; } R.recActive = false; } }
    function resumeWake() { if (S.enabled && wakeOn() && R.wakeArmed && !R.recActive) setTimeout(() => { if (!R.recActive && !R.busy) startListening(true); }, 500); }

    function onHeard(text) {
        let cmd = text;
        if (R.wakeMode) {
            const m = /\b(jarvis|jervis|dschawis|tschawis|javis)\b[,.!]?\s*(.*)$/i.exec(text);
            if (!m) return;                          // ignore everything without the wake word
            cmd = m[2].trim();
            if (!cmd) { R.convoOn = true; R.pendingFollow = true; chime("listen"); try { R.rec.abort(); } catch (e) { R.pendingFollow = false; startListening(false, true); } return; }
        }
        handleCommand(cmd);
    }
    async function handleCommand(text) {
        const t = text.toLowerCase().trim();
        writeLog(`Du: ${text}`, "user");
        if (/^(stopp?|ruhe|halt)\b|sei still|still sein/.test(t) && !/bot|automatik|handel/.test(t)) { R.convoOn = false; stopSpeaking(); return; }
        if (/^(danke|vielen dank|das wars?|das wäre alles|tschüss|ende|fertig)\b/.test(t)) {
            R.convoOn = false;
            if (window.JarvisAI && window.JarvisAI.available()) window.JarvisAI.reset();
            if (window.JarvisLocal) window.JarvisLocal.reset();
            speak(/danke/.test(t) ? "Sehr gern." : "Ich bin hier, wenn Sie mich brauchen.", "info", { force: true, chime: false, kind: "dialog" });
            return;
        }
        if (/leiser/.test(t)) { setVolume(S.volume - 0.15); speak("Etwas leiser.", "info", { force: true }); return; }
        if (/lauter/.test(t)) { setVolume(S.volume + 0.15); speak("Etwas lauter.", "info", { force: true }); return; }
        if (/schneller/.test(t)) { setRate(S.rate + 0.1); speak("Ich spreche etwas schneller.", "info", { force: true }); return; }
        if (/langsamer/.test(t)) { setRate(S.rate - 0.1); speak("Ich spreche etwas langsamer.", "info", { force: true }); return; }
        R.convoOn = S.convo;
        R.ackSaid = false;
        setPhase("thinking");
        const say = (x) => speak(x, "info", { force: true, chime: false, kind: "dialog" });
        // KI-Modus: echte Unterhaltung mit Werkzeugen; Sätze werden gesprochen, sobald sie fertig sind.
        if (window.JarvisAI && window.JarvisAI.available()) {
            let spoke = false;
            try {
                await window.JarvisAI.ask(text, {
                    onSentence: (x) => { spoke = true; say(x); },
                    onStatus: (x) => { setSub(`Jarvis ${x}`); if (!spoke && !R.ackSaid) { R.ackSaid = true; say("Einen Moment."); } },
                });
                if (!spoke) say("Erledigt.");
                return;
            } catch (e) {
                const m = String((e && e.message) || e);
                writeLog(`KI-Modus: ${m}`, "warn");
                if (/401|authentication|invalid x-api-key/i.test(m)) { say("Der Claude-Schlüssel wird nicht akzeptiert. Bitte in den Jarvis-Einstellungen prüfen."); return; }
                // fall through to the built-in commands
            }
        }
        const B = window.TBJarvisBrain, L = window.JarvisLocal;
        // 1) Commands with side effects run directly (pause, start, scan, web search).
        let act = null;
        try { act = B && B.act ? B.act(text) : null; } catch (e) { act = null; }
        if (act && act.say) { say(await act.say); return; }
        let extra = "";
        if (act && act.search) {
            setSub(`Jarvis sucht im Web nach „${act.search}“ …`);
            say("Einen Moment, ich schaue nach.");
            let hits = [];
            try { hits = L ? await L.webSearch(act.search) : []; } catch (e) { hits = []; }
            if (!hits.length) { say(`Zu „${act.search}“ habe ich gerade nichts gefunden.`); return; }
            if (!(L && (L.ready() || L.loading()))) { say(hits[0].replace(/^Wikipedia „[^“]*“: /, "").split(/(?<=[.!?])\s/).slice(0, 2).join(" ")); return; }
            extra = `Websuche nach „${act.search}“:\n${hits.join("\n")}\nBeantworte die Frage anhand dieser Ergebnisse und nenne kurz die Quelle.`;
        }
        // 2) Free on-device AI: real conversation, no key, no costs.
        if (L && (L.ready() || L.loading())) {
            let spoke = false;
            try {
                if (!L.ready()) { setSub("KI-Gehirn startet …"); await L.load(onBrainProgress); }
                await L.ask(text, { extra, onSentence: (x) => { spoke = true; say(x); } });
                if (!spoke) say("Dazu fällt mir gerade nichts ein.");
                return;
            } catch (e) { writeLog(`KI-Gehirn: ${(e && e.message) || e}`, "warn"); }
        }
        // 3) Built-in answers.
        let reply = null;
        try { reply = B ? await B.answer(text) : null; } catch (e) { reply = null; }
        if (reply) { say(reply); return; }
        showAiSetup(true);
        say("Für ein freies Gespräch brauche ich mein KI-Gehirn. Tipp in der Jarvis-Karte einmal auf „Kostenlos laden“ — es läuft danach komplett auf deinem Gerät, ohne Kosten. Befehle wie Lagebericht, News vorlesen, Einstiege suchen oder Bot pausieren gehen schon jetzt.");
    }

    // ------------------------------------------------------------------ UI
    function setPhase(p, text) {
        R.phase = p;
        const titles = { idle: S.enabled ? "Bereit" : "Ausgeschaltet", standby: "Bereit", speaking: "Spricht …", listening: "Hört zu …", thinking: "Denkt nach …", loading: "Lädt Stimme …" };
        const el = $("jv2-title"); if (el) el.textContent = titles[p] || "Bereit";
        const card = $("jarvis-card"); if (card) card.dataset.phase = p;
        syncFab();
        if (p === "speaking" && text) setSub(text);
        else if (p === "standby") setSub(S.listen === "okjarvis" ? "Sag „OK Jarvis“ — dann höre ich zu, bis du nichts mehr sagst." : "Sag „Jarvis“ und gleich deine Frage, z. B. „Jarvis, Lagebericht“.");
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
                listenNow();
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
    // Setup panel: free on-device brain first, Claude key only as an optional extra.
    function showAiSetup(highlight) {
        const box = $("jv2-ai-setup");
        if (!box) return;
        const L = window.JarvisLocal;
        const has = !!(window.JarvisAI && window.JarvisAI.available()) || !!(L && L.ready());
        box.hidden = has && !(L && L.loading());
        renderBrain();
        if (highlight && !has) { box.classList.add("pulse"); box.scrollIntoView({ behavior: "smooth", block: "center" }); setTimeout(() => box.classList.remove("pulse"), 2400); }
    }
    function renderBrain() {
        const L = window.JarvisLocal, el = $("jv2-brain");
        if (!L || !el) return;
        const sel = $("jv2-brain-size");
        if (sel && !sel.options.length) sel.innerHTML = Object.entries(L.MODELS).map(([k, m]) => `<option value="${k}">${esc(m.label)} · Speicher ${esc(m.mem)}</option>`).join("");
        if (sel) sel.value = L.size();
        const st = L.state;
        el.dataset.state = L.ready() ? "ready" : L.loading() ? "loading" : st.error ? "error" : "idle";
        const bar = $("jv2-brain-bar"); if (bar) bar.style.width = `${Math.round((st.progress || 0) * 100)}%`;
        const txt = $("jv2-brain-txt");
        if (txt) txt.textContent = L.ready() ? "KI-Gehirn bereit — sprich einfach los." : L.loading() ? (st.text || "lädt …").slice(0, 120) : st.error ? st.error : (L.config.downloaded ? "Bereits auf dem Gerät — startet beim Aktivieren automatisch." : "Einmaliger Download, danach offline. Im WLAN empfohlen.");
        const btn = $("jv2-brain-load"); if (btn) { btn.disabled = L.loading() || L.ready(); btn.textContent = L.ready() ? "Bereit" : L.loading() ? "Lädt …" : "Kostenlos laden"; }
    }
    function onBrainProgress() { renderBrain(); }
    // The folder dialog must open straight from the tap; then the download starts.
    async function pickFolderThenLoad() {
        const L = window.JarvisLocal;
        if (!L) return;
        if (L.fsSupported()) {
            try { await L.pickDir(); writeLog(`Speicherort für das KI-Gehirn: Ordner „${L.state.dirName}“`, "info"); }
            catch (e) { if (e && e.name !== "AbortError") writeLog(`Ordner nicht verfügbar: ${e.message}`, "warn"); }
        }
        if (!S.enabled) enable();
        loadBrain(true);
    }
    function loadBrain(announceReady) {
        const L = window.JarvisLocal;
        if (!L || L.ready()) return;
        audio();
        const p = L.load(onBrainProgress);
        renderBrain();
        p.then(() => {
            renderBrain(); showAiSetup(false); syncSettings();
            if (announceReady && S.enabled) speak("Mein KI-Gehirn ist geladen. Jetzt können wir ganz normal miteinander reden.", "info", { force: true, kind: "dialog" });
        }).catch(() => renderBrain());
    }
    async function connectAi() {
        const inp = $("jv2-ai-setup-key"), msg = $("jv2-ai-setup-msg"), AI = window.JarvisAI;
        if (!inp || !AI) return;
        const key = inp.value.trim();
        if (!/^sk-ant-/.test(key)) { msg.textContent = "Das sieht nicht wie ein Claude-Schlüssel aus (beginnt mit sk-ant-)."; return; }
        msg.textContent = "Prüfe Schlüssel …";
        try {
            await AI.verify(key);
            AI.config.apiKey = key; AI.save(); AI.reset();
            inp.value = ""; msg.textContent = "";
            syncSettings(); showAiSetup(false);
            if (!S.enabled) enable(); else speak("Verbunden. Ab jetzt können wir ganz normal miteinander reden. Was kann ich für Sie tun?", "info", { force: true, kind: "dialog" });
            R.convoOn = S.convo;
        } catch (e) {
            const m = String((e && e.message) || e);
            msg.textContent = /401|auth|invalid/i.test(m) ? "Schlüssel wird nicht akzeptiert." : `Verbindung fehlgeschlagen: ${m.slice(0, 120)}`;
        }
    }
    function setSub(t) { const el = $("jv2-sub"); if (el) el.textContent = t; }
    function engineLabel() {
        if (!S.enabled) return "Aktivieren, damit Jarvis spricht und zuhört.";
        const ai = window.JarvisAI && window.JarvisAI.available() ? " · KI-Gespräch (Claude)" : window.JarvisLocal && window.JarvisLocal.ready() ? " · KI-Gehirn lokal" : "";
        if (S.engine === "premium" && S.premiumKey) return `Stimme: Premium (ElevenLabs)${ai}`;
        if (S.engine === "neural" && S.neuralReady) return `Stimme: ${VOICES[S.neuralVoice].label}${S.fx ? " · Jarvis-Klang" : ""}${ai}`;
        if (S.engine === "neural" && R.pending.has("init")) return "Jarvis-Stimme wird geladen — bis dahin Systemstimme.";
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
        document.querySelectorAll('input[name="jv2-listen"]').forEach((r) => { r.checked = r.value === S.listen; });
        set("jv2-brief-auto", S.briefing); set("jv2-fx", S.fx); set("jv2-convo", S.convo);
        set("jv2-el-key", S.premiumKey); set("jv2-el-voice", S.premiumVoice);
        const AI = window.JarvisAI;
        if (AI) {
            set("jv2-ai-key", AI.config.apiKey); set("jv2-ai-address", AI.config.address); set("jv2-ai-web", AI.config.web);
            const ms = $("jv2-ai-model");
            if (ms && !ms.options.length) ms.innerHTML = Object.entries(AI.models).map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join("");
            if (ms) ms.value = AI.config.model;
            const st = $("jv2-ai-state");
            if (st) { st.textContent = AI.available() ? "KI-Gespräch aktiv" : "aus — nur feste Sprachbefehle"; st.classList.toggle("on", AI.available()); }
        }
        for (const k of Object.keys(S.speak)) set(`jv2-say-${k}`, S.speak[k]);
        const sel = $("jarvis-voice-picker");
        if (sel) {
            const sys = systemVoices().slice().sort((a, b) => rankVoice(b) - rankVoice(a));
            sel.innerHTML = Object.values(VOICES).map((v) => `<option value="neural:${v.key}">${esc(v.label)} · Jarvis</option>`).join("")
                + `<option value="premium:eleven">Premium · ElevenLabs (eigener Schlüssel)</option>`
                + (sys.length ? `<optgroup label="Systemstimmen">${sys.map((v) => `<option value="system:${esc(v.name)}">${esc(v.name)} (${esc(v.lang)})</option>`).join("")}</optgroup>` : "");
            sel.value = S.engine === "neural" ? `neural:${S.neuralVoice}` : S.engine === "premium" ? "premium:eleven" : `system:${S.systemVoice || (bestSystemVoice() || {}).name || ""}`;
        }
        const btn = $("jarvis-toggle");
        if (btn) { btn.textContent = S.enabled ? "Jarvis aus" : "Jarvis aktivieren"; btn.classList.toggle("primary", !S.enabled); }
        const badge = $("jarvis-badge");
        if (badge) { badge.textContent = S.enabled ? (S.engine === "neural" && S.neuralReady ? "neural" : "aktiv") : "aus"; badge.classList.toggle("on", S.enabled); }
        const mic = $("jv2-mic"); if (mic) mic.disabled = !S.enabled || !SR;
        const card = $("jarvis-card"); if (card) card.classList.toggle("on", S.enabled);
        if (R.phase === "idle") setPhase("idle");
        showAiSetup(false);
        syncFab();
    }
    function setListen(mode) {
        if (!["button", "wake", "okjarvis"].includes(mode)) return;
        S.listen = mode; save();
        if (wakeOn() && S.enabled) { R.wakeArmed = true; pauseWake(); setTimeout(() => startListening(true), 300); }
        else { stopListening(); setPhase("idle"); }
        syncSettings();
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
            else if (R.phase === "standby") target = 0.08 + 0.06 * Math.sin(t * 1.6);
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
        if (S.engine === "neural") ensureNeural();
        if (window.JarvisAI && window.JarvisAI.available()) window.JarvisAI.warm();
        else if (window.JarvisLocal && window.JarvisLocal.config.downloaded) loadBrain(false);
        if (wakeOn()) { R.wakeArmed = true; startListening(true); }
        const brief = window.TBJarvisBrain && window.TBJarvisBrain.briefing();
        speak(brief ? `Jarvis online. ${brief}` : "Jarvis online. Ich melde mich bei Trades, Alarmen und wichtigen Nachrichten.", "info", { force: true });
    }
    // The Jarvis voice is what the user asked for: load it right away (once), announce when ready.
    function ensureNeural() {
        if (R.workerReady) return;
        const first = !S.neuralReady;
        loadNeural().then(() => {
            syncSettings();
            if (first && S.enabled) speak("Meine Stimme ist jetzt geladen. So klinge ich ab sofort.", "info", { force: true, kind: "dialog" });
        }).catch(() => {});
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
            else if (b.id === "jv2-mic") listenNow();
            else if (b.id === "jv2-brief") { if (!S.enabled) enable(); else handleCommand("Lagebericht"); }
            else if (b.dataset.jv === "load") { audio(); S.engine = "neural"; save(); loadNeural().then(() => { syncSettings(); speak("Neurale Stimme bereit. So klinge ich ab jetzt.", "info", { force: true }); }).catch(() => {}); }
            else if (b.dataset.jv === "ai-connect") connectAi();
            else if (b.id === "jv2-brain-load") pickFolderThenLoad();
            else if (b.dataset.jv === "send") { const i = $("jv2-text"); const v = i && i.value.trim(); if (v) { i.value = ""; if (!S.enabled) enable(); stopSpeaking(); handleCommand(v); } }
            else if (b.dataset.jv === "test") { if (!S.enabled) enable(); else speak("Guten Tag. Bitcoin steht bei achtundsechzigtausend Dollar, plus eins Komma zwei Prozent. Alle Positionen sind abgesichert.", "info", { force: true }); }
            else if (b.dataset.jv === "purge") { if (R.worker) R.worker.postMessage({ type: "purge" }); else { try { caches.delete("jarvis-voice-v1"); } catch (err) { /* ignore */ } S.neuralReady = false; save(); setVoiceStatus("none"); } S.engine = "system"; save(); syncSettings(); }
        });
        card.addEventListener("keydown", (e) => {
            if (e.key !== "Enter") return;
            if (e.target.id === "jv2-text") { e.preventDefault(); card.querySelector('[data-jv="send"]').click(); }
            if (e.target.id === "jv2-ai-setup-key") { e.preventDefault(); connectAi(); }
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
                    audio(); ensureNeural();
                } else if (eng === "premium") {
                    S.engine = "premium"; save();
                    if (!S.premiumKey) setSub("Für die Premium-Stimme bitte unten den ElevenLabs-Schlüssel eintragen.");
                } else { S.engine = "system"; S.systemVoice = name; save(); }
                syncSettings();
                if (S.enabled) speak("Stimme geändert.", "info", { force: true });
            } else if (el.id === "jv2-rate") setRate(Number(el.value));
            else if (el.id === "jv2-vol") setVolume(Number(el.value));
            else if (el.name === "jv2-listen") setListen(el.value); else if (el.id === "jv2-brief-auto") { S.briefing = el.checked; save(); }
            else if (el.id === "jv2-fx") { S.fx = el.checked; save(); applyFx(); syncSettings(); if (S.enabled) speak(S.fx ? "Jarvis-Klang aktiv." : "Natürlicher Klang.", "info", { force: true }); }
            else if (el.id === "jv2-convo") { S.convo = el.checked; save(); }
            else if (el.id === "jv2-brain-size" && window.JarvisLocal) { window.JarvisLocal.config.size = el.value; window.JarvisLocal.save(); renderBrain(); }
            else if (el.id === "jv2-el-key") { S.premiumKey = el.value.trim(); if (S.premiumKey) S.engine = "premium"; save(); syncSettings(); }
            else if (el.id === "jv2-el-voice") { S.premiumVoice = el.value.trim() || DEFAULTS.premiumVoice; save(); }
            else if (el.id && el.id.startsWith("jv2-ai-") && window.JarvisAI) {
                const AI = window.JarvisAI, k = el.id.slice(7);
                if (k === "key") AI.config.apiKey = el.value.trim();
                else if (k === "model") AI.config.model = el.value;
                else if (k === "address") AI.config.address = el.value.trim() || "Sir";
                else if (k === "web") AI.config.web = el.checked;
                AI.save(); AI.reset(); syncSettings();
            }
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
                if (S.engine === "neural") ensureNeural();
                if (wakeOn()) { R.wakeArmed = true; startListening(true); }
                if (window.JarvisLocal && window.JarvisLocal.config.downloaded && !(window.JarvisAI && window.JarvisAI.available())) loadBrain(false);
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
