// Jarvis' own speech recognition (Whisper, transformers.js) — used where the browser's speech
// recognition is missing or broken (many Android phones). Runs off the UI thread; the model is
// fetched once (~80 MB) and then served from the browser cache.
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5";

env.allowLocalModels = false;
const MODELS = ["onnx-community/whisper-base", "Xenova/whisper-base"];
let asr = null, loading = null;
const files = {};

function progress(p) {
    if (p.status !== "progress" || !p.file) return;
    files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
    const all = Object.values(files);
    const total = all.reduce((a, f) => a + f.total, 0), loaded = all.reduce((a, f) => a + f.loaded, 0);
    self.postMessage({ type: "progress", loaded, total });
}
function load() {
    if (asr) return Promise.resolve(asr);
    if (!loading) {
        loading = (async () => {
            let last = null;
            for (const id of MODELS) {
                try { asr = await pipeline("automatic-speech-recognition", id, { dtype: "q8", device: "wasm", progress_callback: progress }); return asr; }
                catch (e) { last = e; }
            }
            throw last || new Error("Spracherkennung konnte nicht geladen werden");
        })();
        loading.catch(() => { loading = null; });
    }
    return loading;
}

self.onmessage = async (e) => {
    const m = e.data || {};
    try {
        if (m.type === "load") { await load(); self.postMessage({ type: "ready" }); }
        else if (m.type === "transcribe") {
            const t0 = performance.now();
            const model = await load();
            const out = await model(m.audio, { language: "german", task: "transcribe", chunk_length_s: 30 });
            self.postMessage({ type: "text", id: m.id, text: String((out && out.text) || "").trim(), ms: Math.round(performance.now() - t0) });
        }
    } catch (err) {
        self.postMessage({ type: "error", id: m.id, message: String((err && err.message) || err) });
    }
};
