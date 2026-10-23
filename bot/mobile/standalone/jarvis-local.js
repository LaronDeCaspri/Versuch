/*
 * Jarvis — kostenloses KI-Gehirn direkt auf dem Gerät.
 * Ein offenes Sprachmodell (Qwen 3.5) läuft per WebGPU im Browser (WebLLM): kein Konto, kein
 * Schlüssel, keine Kosten, nach dem einmaligen Download offline. Dazu eine freie Websuche über
 * Wikipedia und den GDELT-Nachrichtenindex (beide ohne Schlüssel).
 */
(function () {
    "use strict";

    const WEBLLM = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm";
    // CPU fallback when the browser offers no WebGPU (llama.cpp compiled to WebAssembly).
    const WLLAMA = "https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/esm/index.js";
    const WLLAMA_WASM = "https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/esm/wasm/wllama.wasm";
    const CPU_MODELS = {
        fast: { url: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf", label: "CPU schnell — Qwen 2.5 0,5B", mem: "ca. 0,5 GB" },
        better: { url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf", label: "CPU besser — Qwen 2.5 1,5B (langsamer)", mem: "ca. 1,1 GB" },
    };
    const MODELS = {
        small: { id: "Qwen3.5-0.8B-q4f16_1-MLC", label: "Klein — fürs Handy", mem: "ca. 1,6 GB" },
        medium: { id: "Qwen3.5-2B-q4f16_1-MLC", label: "Mittel — empfohlen", mem: "ca. 2,2 GB" },
        large: { id: "Qwen3.5-4B-q4f16_1-MLC", label: "Groß — klügste, starker PC", mem: "ca. 3,9 GB" },
    };
    const KEY = "tb_jarvis_local";
    const C = (() => { try { return { size: "", downloaded: false, ...(JSON.parse(localStorage.getItem(KEY) || "{}")) }; } catch (e) { return { size: "", downloaded: false }; } })();
    function save() { try { localStorage.setItem(KEY, JSON.stringify(C)); } catch (e) { /* storage full */ } }

    const S = { engine: null, loading: null, progress: 0, text: "", error: null, history: [], lastTurn: 0, gpu: null };

    const GPU_FAILED = { webgpu: false, reason: "Chrome meldet zwar WebGPU, die KI findet aber keine passende Grafikkarte.",
        steps: ["chrome://gpu öffnen: Bei „WebGPU“ sollte „Hardware accelerated“ stehen.", "Grafiktreiber aktualisieren, Chrome neu starten, dann „Erneut prüfen“."] };
    async function supported() {
        if (S.gpu !== null) return S.gpu;
        if (C.gpuFailed && !S.recheck) {
            S.diag = GPU_FAILED; S.gpu = false;
            return false;
        }
        S.recheck = false;
        S.diag = await diagnose();
        if (S.diag.webgpu) { C.gpuFailed = 0; save(); }
        S.gpu = S.diag.webgpu;
        return S.gpu;
    }
    // Why there is no WebGPU, and what the user can do about it (Chrome/Edge).
    async function diagnose() {
        if (!window.isSecureContext) return { webgpu: false, reason: "Die Seite läuft nicht über https.", steps: ["Die App über den https-Link öffnen, nicht als Datei."] };
        if (!navigator.gpu) return { webgpu: false, reason: "Dieser Browser stellt kein WebGPU bereit.", steps: ["Chrome bzw. Edge aktualisieren (Menü → Hilfe → Über Google Chrome).", "chrome://flags öffnen, nach „WebGPU“ suchen und „Unsafe WebGPU Support“ aktivieren, dann neu starten."] };
        for (const opt of [{ powerPreference: "high-performance" }, {}, { powerPreference: "low-power" }]) {
            let ad = null;
            try { ad = await navigator.gpu.requestAdapter(opt); } catch (e) { /* try the next option */ }
            if (!ad) continue;
            // The models are stored as 16-bit floats; without shader-f16 WebLLM refuses the GPU.
            if (/f16/.test(MODELS[size()].id) && ad.features && !ad.features.has("shader-f16")) {
                return { webgpu: false, reason: "Die Grafikkarte unterstützt kein 16-Bit-Rechnen (shader-f16), das die KI-Modelle brauchen.",
                    steps: ["Grafiktreiber aktualisieren und Chrome neu starten.", "Ohne shader-f16 nutzt Jarvis automatisch den CPU-Modus."] };
            }
            // WebLLM asks for a device of its own; if Chrome refuses here, it would refuse there too.
            try {
                const dev = await ad.requestDevice(ad.features && ad.features.has("shader-f16") ? { requiredFeatures: ["shader-f16"] } : {});
                if (dev && dev.destroy) dev.destroy();
            } catch (e) { continue; }
            return { webgpu: true };
        }
        return { webgpu: false, reason: "Chrome hat WebGPU, bekommt aber keinen Zugriff auf die Grafikkarte.",
            steps: ["chrome://settings/system öffnen → „Grafikbeschleunigung verwenden, wenn verfügbar“ einschalten → Chrome neu starten.",
                "chrome://gpu öffnen: Bei „WebGPU“ sollte „Hardware accelerated“ stehen.",
                "Grafiktreiber aktualisieren (Intel, AMD oder NVIDIA).",
                "Steht die Grafikkarte auf Chromes Sperrliste: chrome://flags → „Unsafe WebGPU Support“ und „Override software rendering list“ aktivieren, neu starten."] };
    }
    // Phones and small machines get the small model; desktops with plenty of memory the large one.
    function autoSize() {
        const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
        const mem = navigator.deviceMemory || 4;
        return mobile || mem <= 4 ? "small" : "medium";
    }
    function size() { return MODELS[C.size] ? C.size : autoSize(); }

    // ---- robust download -------------------------------------------------------------------
    // WebLLM downloads with Cache.add(), which fails the whole load on a single dropped connection
    // ("Cache.add() encountered a network error"). We fetch every file ourselves with retries,
    // optionally keep a copy in a folder the user picks (e.g. D:\Downloads\Jarvis), and put each
    // file into exactly the cache slot WebLLM checks first — so WebLLM never downloads anything.
    const IDB = "tb_jarvis_fs";
    function idb(mode, fn) {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(IDB, 1);
            req.onupgradeneeded = () => req.result.createObjectStore("kv");
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
                try {
                    const tx = req.result.transaction("kv", mode), st = tx.objectStore("kv");
                    const r = fn(st);
                    tx.oncomplete = () => resolve(r && r.result);
                    tx.onerror = () => reject(tx.error);
                    tx.onabort = () => reject(tx.error);
                } catch (e) { reject(e); }
            };
        });
    }
    const fsSupported = () => typeof window.showDirectoryPicker === "function";
    async function savedDir() { try { return await idb("readonly", (st) => st.get("dir")); } catch (e) { return null; } }
    async function pickDir() {
        const dir = await window.showDirectoryPicker({ id: "jarvis-model", mode: "readwrite", startIn: "downloads" });
        try { await idb("readwrite", (st) => st.put(dir, "dir")); } catch (e) { /* remember only for this session */ }
        S.dir = dir; S.dirName = dir.name;
        return dir;
    }
    async function ensureDirPermission(dir) {
        if (!dir) return null;
        try {
            if ((await dir.queryPermission({ mode: "readwrite" })) === "granted") return dir;
            if ((await dir.requestPermission({ mode: "readwrite" })) === "granted") return dir;
        } catch (e) { /* folder moved or deleted */ }
        return null;
    }
    async function readFromDir(dir, name) {
        try { const f = await (await dir.getFileHandle(name)).getFile(); return f.size > 0 ? await f.arrayBuffer() : null; } catch (e) { return null; }
    }
    async function writeToDir(dir, name, buf) {
        try { const h = await dir.getFileHandle(name, { create: true }); const w = await h.createWritable(); await w.write(buf); await w.close(); } catch (e) { /* folder copy is optional */ }
    }
    async function fetchRetry(url, onBytes, tries = 5) {
        let last = null;
        for (let i = 0; i < tries; i++) {
            try {
                const res = await fetch(url, { cache: "no-store" });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                if (!res.body) return await res.arrayBuffer();
                const reader = res.body.getReader(), chunks = [];
                let n = 0;
                for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; onBytes && onBytes(value.length); }
                const out = new Uint8Array(n); let o = 0;
                for (const c of chunks) { out.set(c, o); o += c.length; }
                return out.buffer;
            } catch (e) {
                last = e;
                await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
            }
        }
        throw new Error(`Download fehlgeschlagen nach ${tries} Versuchen: ${url.split("/").pop()} (${(last && last.message) || last})`);
    }
    async function downloadModel(onProgress, { askFolder = false } = {}) {
        const mod = await import(WEBLLM);
        const id = MODELS[size()].id;
        const rec = mod.prebuiltAppConfig.model_list.find((r) => r.model_id === id);
        if (!rec) throw new Error(`Modell ${id} unbekannt`);
        const base = `${rec.model.replace(/\/$/, "")}/resolve/main/`;
        let dir = null, root = null;
        if (fsSupported()) {
            dir = await ensureDirPermission(S.dir || await savedDir());
            if (!dir && askFolder) dir = await pickDir();
            if (dir) { S.dirName = dir.name; root = dir; try { dir = await dir.getDirectoryHandle(id, { create: true }); } catch (e) { dir = null; } }
        }
        let done = 0, total = 0;
        const report = (text) => onProgress && onProgress(total ? Math.min(0.99, done / total) : 0, text);
        const get = async (url, scope, fileName) => {
            const cache = await caches.open(scope);
            const hit = await cache.match(url);
            if (hit) { const b = await hit.arrayBuffer(); if (dir && !(await readFromDir(dir, fileName))) await writeToDir(dir, fileName, b); return b; }
            // Manually downloaded files may sit in the model subfolder or directly in the picked folder.
            let buf = dir ? (await readFromDir(dir, fileName)) || (root ? await readFromDir(root, fileName) : null) : null;
            if (buf) report(`Aus Ordner geladen: ${fileName}`);
            else {
                buf = await fetchRetry(url, (n) => { done += n; report(`Lade ${fileName} … ${(done / 1e6).toFixed(0)} von ${(total / 1e6).toFixed(0)} MB`); });
                if (dir) await writeToDir(dir, fileName, buf);
            }
            await cache.put(url, new Response(buf));
            return buf;
        };
        const td = new TextDecoder();
        const cfg = JSON.parse(td.decode(await get(new URL("mlc-chat-config.json", base).href, "webllm/config", "mlc-chat-config.json")));
        const tc = JSON.parse(td.decode(await get(new URL("tensor-cache.json", base).href, "webllm/model", "tensor-cache.json")));
        const shards = [...new Map((tc.records || []).map((r) => [r.dataPath, r.nbytes || 0])).entries()];
        total = shards.reduce((a, [, n]) => a + n, 0) + 30e6;
        const tok = (cfg.tokenizer_files || []).includes("tokenizer.json") ? "tokenizer.json" : "tokenizer.model";
        await get(new URL(tok, base).href, "webllm/model", tok);
        await get(rec.model_lib, "webllm/wasm", rec.model_lib.split("/").pop());
        // Three shards at a time: fast, but gentle enough not to trip rate limits.
        let i = 0;
        const workers = Array.from({ length: 3 }, async () => {
            while (i < shards.length) { const [path] = shards[i++]; await get(new URL(path, base).href, "webllm/model", path); }
        });
        await Promise.all(workers);
        report(dir ? `Fertig — Kopie in Ordner „${S.dirName}/${id}“` : "Download fertig");
        return { dir: !!dir };
    }

    function cpuSize() { return CPU_MODELS[C.cpuSize] ? C.cpuSize : "fast"; }
    // Big single file (GGUF): streamed straight to disk — into the picked folder (resumable via
    // Range requests) or into Cache Storage — never held completely in memory.
    async function getGguf(url, onProgress, askFolder) {
        const name = url.split("/").pop();
        const cache = await caches.open("jarvis-cpu-model");
        const hit = await cache.match(url);
        let dir = null;
        if (fsSupported()) {
            dir = await ensureDirPermission(S.dir || await savedDir());
            if (!dir && askFolder) { try { dir = await pickDir(); } catch (e) { dir = null; } }
            if (dir) S.dirName = dir.name;
        }
        if (dir) {
            // 64-MB Range segments, each committed to disk right away: an interruption (or a page
            // reload) only loses the current segment, and the next attempt resumes where it stopped.
            const fh = await dir.getFileHandle(name, { create: true });
            const SEG = S.segBytes || 64 * 1024 * 1024;   // tests use smaller segments
            let total = 0;
            for (let i = 0; i < 5 && !total; i++) {
                try {
                    const r = await fetch(url, { headers: { Range: "bytes=0-0" }, cache: "no-store" });
                    const cr = r.headers.get("Content-Range");
                    total = cr ? Number(cr.split("/")[1]) : Number(r.headers.get("Content-Length")) || 0;
                    try { await r.body.cancel(); } catch (e) { /* ignore */ }
                } catch (e) { await new Promise((res) => setTimeout(res, 1500 * 2 ** i)); }
            }
            if (!total) throw new Error(`Größe von ${name} nicht ermittelbar (keine Verbindung)`);
            let have = (await fh.getFile()).size;
            if (have > total) { const w0 = await fh.createWritable(); await w0.close(); have = 0; }
            let fails = 0;
            while (have < total) {
                const end = Math.min(have + SEG, total) - 1;
                try {
                    const res = await fetch(url, { headers: { Range: `bytes=${have}-${end}` }, cache: "no-store" });
                    if (res.status !== 206) throw new Error(res.ok ? "Server unterstützt kein Fortsetzen" : `HTTP ${res.status}`);
                    const buf = await res.arrayBuffer();
                    const w = await fh.createWritable({ keepExistingData: true });
                    await w.seek(have); await w.write(buf); await w.close();
                    have += buf.byteLength; fails = 0;
                    onProgress(have / total, `Lade ${name} … ${(have / 1e6).toFixed(0)} von ${(total / 1e6).toFixed(0)} MB — gespeichert in „${S.dirName}“`);
                } catch (e) {
                    if (++fails > 6) throw new Error(`Download von ${name} abgebrochen (${(e && e.message) || e}) — beim nächsten Versuch geht es bei ${(have / 1e6).toFixed(0)} MB weiter`);
                    onProgress(have / total, `Verbindung unterbrochen — setze bei ${(have / 1e6).toFixed(0)} MB fort (${fails}/6) …`);
                    await new Promise((r) => setTimeout(r, 1500 * 2 ** (fails - 1)));
                }
            }
            return await fh.getFile();
        }
        if (hit) return await hit.blob();
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                const res = await fetch(url, { cache: "no-store" });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const total = Number(res.headers.get("Content-Length")) || 0;
                let done = 0;
                const body = res.body.pipeThrough(new TransformStream({ transform(chunk, ctl) { done += chunk.length; onProgress(total ? done / total : 0, `Lade ${name} … ${(done / 1e6).toFixed(0)} von ${(total / 1e6).toFixed(0)} MB`); ctl.enqueue(chunk); } }));
                await cache.put(url, new Response(body, { headers: { "Content-Type": "application/octet-stream" } }));
                return await (await cache.match(url)).blob();
            } catch (e) {
                onProgress(0, `Verbindung unterbrochen — neuer Versuch (${attempt + 1}/5) …`);
                await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
            }
        }
        throw new Error(`Download von ${name} nach 5 Versuchen abgebrochen`);
    }
    async function loadCpu(onProgress, opts) {
        const m = CPU_MODELS[cpuSize()];
        const report = (p, t) => { S.progress = p; S.text = t; onProgress && onProgress(p, t); };
        const blob = await getGguf(m.url, (p, t) => report(p * 0.9, t), opts.askFolder);
        report(0.92, "Starte KI-Gehirn im CPU-Modus …");
        const { Wllama } = await import(WLLAMA);
        const w = new Wllama({ default: WLLAMA_WASM }, { suppressNativeLog: true });
        await w.loadModel([blob], { n_ctx: 2048 });
        report(1, "KI-Gehirn bereit (CPU-Modus)");
        // Same surface as WebLLM, so the conversation code does not care which engine runs.
        return {
            kind: "cpu",
            chat: { completions: { create: (req) => w.createChatCompletion({ messages: req.messages, stream: !!req.stream, temperature: req.temperature, max_tokens: req.max_tokens }) } },
        };
    }

    function load(onProgress, opts = {}) {
        if (S.engine) return Promise.resolve(S.engine);
        if (S.loading) return S.loading;
        S.error = null;
        S.loading = (async () => {
            if (!(await supported())) {
                S.engine = await loadCpu(onProgress, opts);
                S.engineKind = "cpu";
                C.downloaded = true; C.loadedSize = "cpu:" + cpuSize(); save();
                return S.engine;
            }
            try {
                return await loadGpu(onProgress, opts);
            } catch (e) {
                // Chrome offered an adapter but WebLLM cannot use it ("Unable to find a compatible GPU"):
                // remember that and continue on the CPU instead of failing.
                if (!/compatible GPU|WebGPU|adapter|shader-f16|GPUDevice|device lost/i.test(String((e && e.message) || e))) throw e;
                S.gpu = false; S.diag = GPU_FAILED;
                C.gpuFailed = Date.now(); save();
                S.engine = await loadCpu(onProgress, opts);
                S.engineKind = "cpu";
                C.downloaded = true; C.loadedSize = "cpu:" + cpuSize(); save();
                return S.engine;
            }
        })();
        S.loading.catch((e) => { S.error = String((e && e.message) || e); S.loading = null; });
        return S.loading;
    }

    async function loadGpu(onProgress, opts) {
        S.engineKind = "webgpu";
        await downloadModel((p, t) => { S.progress = p * 0.9; S.text = t; onProgress && onProgress(S.progress, S.text); }, opts);
        const { CreateWebWorkerMLCEngine } = await import(WEBLLM);
        const worker = new Worker("jarvis-llm-worker.js", { type: "module" });
        try {
            const engine = await CreateWebWorkerMLCEngine(worker, MODELS[size()].id, {
                initProgressCallback: (r) => { S.progress = 0.9 + 0.1 * (r.progress || 0); S.text = /Fetching|Loading model from cache/i.test(r.text || "") ? "Starte KI-Gehirn …" : (r.text || ""); onProgress && onProgress(S.progress, S.text); },
            });
            S.engine = engine;
            C.downloaded = true; C.loadedSize = size(); save();
            return engine;
        } catch (e) { worker.terminate(); throw e; }
    }

    function systemPrompt(ctx) {
        return `Du bist J.A.R.V.I.S., der persönliche Sprachassistent eines Krypto-Trading-Bots. Der Bot handelt nur im Demo-Modus mit Spielgeld; echte Orders sind gesperrt.
Deine Antworten werden vorgelesen: Sprich natürliches, freundliches Deutsch wie ein Mensch im Gespräch, meist ein bis drei kurze Sätze, ohne Listen, Markdown, Emojis oder Links. Runde Zahlen sinnvoll. Ton: ruhig, souverän, ein Hauch trockener britischer Humor. Sprich den Nutzer gelegentlich mit „Sir“ an.
Die Eingaben kommen aus einer Spracherkennung und können Wörter verwechseln — deute wohlwollend, was gemeint ist. Geh auf das Gesagte ein und plaudere auch über anderes, wenn der Nutzer das möchte.
Nutze für Fragen zum Bot, zu Kursen, News oder dem Radar ausschließlich die Daten unten; erfinde keine Zahlen. Englische Schlagzeilen gibst du sinngemäß auf Deutsch wieder. Wenn du etwas nicht weißt, sag es ehrlich. Du kannst keine Orders auslösen.

AKTUELLE DATEN (${new Date().toLocaleString("de-DE")}):
${ctx}`;
    }

    function context(extra) {
        const A = window.TBJarvisActions;
        if (!A) return extra || "";
        const st = A.status();
        // CPU mode: compact context, every prompt token costs time without a graphics card.
        if (S.engineKind === "cpu") {
            const L = window.TBNewsAI && window.TBNewsAI.last;
            const nw = L && L.count ? `News: Stimmung ${L.label}; ${L.top.slice(0, 3).map((n) => `${n.trusted || n.source}: ${n.title}`).join(" | ")}` : "Keine News.";
            const bb = A.btcContextLine ? A.btcContextLine() : "";
            return `Depot ${st.equity_usdt} USDT, heute ${st.today_usdt}, Positionen ${st.positions.length}, Automatik ${st.auto_mode ? "an" : "aus"}, BTC ${st.btc_usdt}.\n${nw}${bb ? `\n${bb}` : ""}${extra ? `\n${extra}` : ""}`;
        }
        const news = window.TBNewsAI && window.TBNewsAI.contextText ? window.TBNewsAI.contextText()
            : A.news(5, false).map((n, i) => `${i + 1}. ${n.source}, vor ${n.minutes_ago} Min.: ${n.title}`).join("\n");
        const bb = A.btcContextLine ? A.btcContextLine() : "";
        return `Bot-Status: ${JSON.stringify(st)}\n${news || "Keine Meldungen."}${bb ? `\n${bb}` : ""}${extra ? `\n\nZUSATZINFOS ZUR FRAGE:\n${extra}` : ""}`;
    }

    async function ask(text, { onSentence, extra } = {}) {
        const engine = await load();
        if (Date.now() - S.lastTurn > 15 * 60e3) S.history = [];
        S.lastTurn = Date.now();
        // Small context window: keep the last few exchanges only (this model has no thinking blocks).
        const messages = [{ role: "system", content: systemPrompt(context(extra)) }, ...S.history.slice(-6), { role: "user", content: text }];
        const stream = await engine.chat.completions.create({
            messages, stream: true, temperature: 0.6, top_p: 0.9, max_tokens: 320,
            extra_body: { enable_thinking: false },
        });
        let buf = "", full = "", spoken = false;
        const flush = (final) => {
            const re = final ? /[\s\S]+/ : !spoken ? /^(?:[\s\S]{24,}?[,;:–](?=\s)|[\s\S]{8,}?[.!?…](?=\s|$))/ : /^[\s\S]{12,}?[.!?…](?=\s|$)/;
            for (;;) {
                const m = re.exec(buf);
                if (!m || !m[0].trim()) break;
                buf = buf.slice(m[0].length);
                const sentence = m[0].replace(/<\/?think>/g, "").trim();
                if (sentence) { spoken = true; onSentence && onSentence(sentence); }
                if (final) break;
            }
        };
        for await (const chunk of stream) {
            const d = chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
            if (!d) continue;
            buf += d; full += d;
            flush(false);
        }
        flush(true);
        S.history.push({ role: "user", content: text }, { role: "assistant", content: full.trim() });
        return full.trim();
    }

    // ---- free web search: Wikipedia (facts) + GDELT (current news), both keyless and CORS-enabled
    async function getJson(url, ms = 8000) {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), ms);
        try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
        finally { clearTimeout(t); }
    }
    async function webSearch(q) {
        const out = [];
        const [wiki, news] = await Promise.allSettled([
            (async () => {
                const s = await getJson(`https://de.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=2&format=json&origin=*`);
                const titles = ((s.query && s.query.search) || []).map((x) => x.title);
                if (!titles.length) return [];
                const e = await getJson(`https://de.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&exsentences=4&titles=${encodeURIComponent(titles.join("|"))}&format=json&origin=*`);
                return Object.values((e.query && e.query.pages) || {}).map((p) => `Wikipedia „${p.title}“: ${String(p.extract || "").slice(0, 700)}`);
            })(),
            (async () => {
                const g = await getJson(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=5&sort=datedesc&timespan=7d`);
                return ((g && g.articles) || []).slice(0, 5).map((a) => `News (${a.domain}): ${a.title}`);
            })(),
        ]);
        if (wiki.status === "fulfilled") out.push(...wiki.value);
        if (news.status === "fulfilled") out.push(...news.value);
        return out;
    }

    // One-off text job (e.g. summarising fresh headlines) — does not touch the conversation.
    async function summarize(prompt) {
        const engine = await load();
        const r = await engine.chat.completions.create({
            messages: [{ role: "system", content: "Du bist J.A.R.V.I.S. Antworte auf Deutsch in ein bis zwei kurzen, gesprochenen Sätzen, ohne Listen, Markdown oder Links." }, { role: "user", content: prompt }],
            stream: false, temperature: 0.4, max_tokens: 160, extra_body: { enable_thinking: false },
        });
        return String((r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) || "").replace(/<\/?think>/g, "").trim();
    }
    function reset() { S.history = []; }
    async function remove() {
        try {
            const mod = await import(WEBLLM);
            for (const m of Object.values(MODELS)) { try { await mod.deleteModelAllInfoInCache(m.id); } catch (e) { /* not cached */ } }
        } catch (e) { /* offline */ }
        S.engine = null; S.loading = null; C.downloaded = false; save();
    }

    window.JarvisLocal = {
        MODELS, CPU_MODELS, cpuSize, diagnose, config: C, save, state: S, supported, load, ask, summarize, reset, remove, webSearch, size,
        fsSupported, pickDir, savedDir,
        ready: () => !!S.engine, loading: () => !!S.loading && !S.engine,
    };
})();
