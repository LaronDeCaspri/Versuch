/*
 * Jarvis neural voice — Piper (VITS) running fully in the browser.
 * Text -> espeak-ng phonemes (piper_phonemize WASM) -> ONNX model (onnxruntime-web) -> PCM.
 * Runs in a worker so synthesis never blocks the trading UI. Every file is fetched once
 * from version-pinned URLs and kept in Cache Storage ("jarvis-voice-v1").
 */
/* global ort, createPiperPhonemize */
"use strict";

const LIBS = {
    ort: "https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/ort.min.js",
    ortWasm: "https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/",
    phonemizeJs: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.js",
    phonemizeWasm: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm",
    phonemizeData: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data",
};
const CACHE = "jarvis-voice-v1";

let session = null, config = null, voiceKey = null, phonWasm = null, phonData = null, libsReady = null;

function post(msg, transfer) { self.postMessage(msg, transfer || []); }

async function cachedFetch(urls, onProgress) {
    const list = Array.isArray(urls) ? urls : [urls];
    let cache = null;
    try { cache = await caches.open(CACHE); } catch (e) { /* no Cache Storage (private mode) */ }
    if (cache) {
        for (const u of list) {
            const hit = await cache.match(u);
            if (hit) return hit.arrayBuffer();
        }
    }
    let lastErr = null;
    for (const u of list) {
        try {
            const res = await fetch(u, { mode: "cors", credentials: "omit" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const total = Number(res.headers.get("Content-Length")) || 0;
            let buf;
            if (res.body && onProgress) {
                const reader = res.body.getReader();
                const chunks = [];
                let loaded = 0;
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    loaded += value.length;
                    onProgress(loaded, total);
                }
                const out = new Uint8Array(loaded);
                let o = 0;
                for (const c of chunks) { out.set(c, o); o += c.length; }
                buf = out.buffer;
            } else {
                buf = await res.arrayBuffer();
            }
            if (cache) { try { await cache.put(list[0], new Response(buf.slice(0))); } catch (e) { /* quota */ } }
            return buf;
        } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("Download fehlgeschlagen");
}

function loadLibs() {
    if (libsReady) return libsReady;
    libsReady = (async () => {
        if (typeof ort === "undefined") importScripts(LIBS.ort);
        if (typeof createPiperPhonemize === "undefined") importScripts(LIBS.phonemizeJs);
        ort.env.wasm.wasmPaths = LIBS.ortWasm;
        // Threads need cross-origin isolation, which a static host cannot provide.
        ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
        [phonWasm, phonData] = await Promise.all([cachedFetch(LIBS.phonemizeWasm), cachedFetch(LIBS.phonemizeData)]);
    })();
    libsReady.catch(() => { libsReady = null; });
    return libsReady;
}

async function init(voice) {
    if (session && voiceKey === voice.key) return;
    await loadLibs();
    const cfgBuf = await cachedFetch(voice.urls.map((u) => u + ".json"));
    config = JSON.parse(new TextDecoder().decode(cfgBuf));
    const model = await cachedFetch(voice.urls, (loaded, total) => post({ type: "progress", loaded, total: total || voice.bytes || 0 }));
    session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
    voiceKey = voice.key;
}

// One phonemizer instance per call: piper_phonemize runs `main` and exits.
function phonemize(text) {
    return new Promise((resolve, reject) => {
        let done = false;
        createPiperPhonemize({
            wasmBinary: phonWasm,
            getPreloadedPackage: () => phonData,
            print: (line) => {
                if (done) return;
                try { done = true; resolve(JSON.parse(line).phoneme_ids); } catch (e) { reject(e); }
            },
            printErr: () => { /* espeak warnings */ },
            locateFile: (f) => (f.endsWith(".wasm") ? LIBS.phonemizeWasm : f.endsWith(".data") ? LIBS.phonemizeData : f),
        }).then((mod) => {
            mod.callMain(["-l", config.espeak.voice, "--input", JSON.stringify([{ text }]), "--espeak_data", "/espeak-ng-data"]);
            if (!done) setTimeout(() => { if (!done) reject(new Error("Phonemisierung ohne Ergebnis")); }, 3000);
        }, reject);
    });
}

async function synth(text, rate) {
    const ids = await phonemize(text);
    if (!ids || !ids.length) return new Float32Array(0);
    const inf = config.inference || {};
    const feeds = {
        input: new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
        input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
        // length_scale > 1 = slower. rate 1.0 keeps the model's natural tempo.
        scales: new ort.Tensor("float32", Float32Array.from([inf.noise_scale ?? 0.667, (inf.length_scale ?? 1) / (rate || 1), inf.noise_w ?? 0.8]), [3]),
    };
    if (config.speaker_id_map && Object.keys(config.speaker_id_map).length) feeds.sid = new ort.Tensor("int64", BigInt64Array.from([0n]), [1]);
    const out = await session.run(feeds);
    return Float32Array.from(out.output.data);
}

// ONNX sessions must not run concurrently: handle messages strictly one after another.
let chain = Promise.resolve();
self.onmessage = (e) => { chain = chain.then(() => handle(e.data || {})); };
async function handle(m) {
    try {
        if (m.type === "init") {
            await init(m.voice);
            post({ type: "ready", key: voiceKey, sampleRate: config.audio.sample_rate });
        } else if (m.type === "speak") {
            if (!session) throw new Error("Stimme nicht geladen");
            const t0 = performance.now();
            const pcm = await synth(m.text, m.rate);
            post({ type: "audio", id: m.id, pcm, sampleRate: config.audio.sample_rate, ms: Math.round(performance.now() - t0) }, [pcm.buffer]);
        } else if (m.type === "purge") {
            session = null; voiceKey = null;
            try { await caches.delete(CACHE); } catch (err) { /* ignore */ }
            post({ type: "purged" });
        }
    } catch (err) {
        post({ type: "error", id: m.id, stage: m.type, message: String((err && err.message) || err) });
    }
}
