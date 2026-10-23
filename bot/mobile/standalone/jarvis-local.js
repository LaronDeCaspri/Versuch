/*
 * Jarvis — kostenloses KI-Gehirn direkt auf dem Gerät.
 * Ein offenes Sprachmodell (Qwen 3.5) läuft per WebGPU im Browser (WebLLM): kein Konto, kein
 * Schlüssel, keine Kosten, nach dem einmaligen Download offline. Dazu eine freie Websuche über
 * Wikipedia und den GDELT-Nachrichtenindex (beide ohne Schlüssel).
 */
(function () {
    "use strict";

    const WEBLLM = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm";
    const MODELS = {
        small: { id: "Qwen3.5-0.8B-q4f16_1-MLC", label: "Klein — fürs Handy", mem: "ca. 1,6 GB" },
        medium: { id: "Qwen3.5-2B-q4f16_1-MLC", label: "Mittel — empfohlen", mem: "ca. 2,2 GB" },
        large: { id: "Qwen3.5-4B-q4f16_1-MLC", label: "Groß — klügste, starker PC", mem: "ca. 3,9 GB" },
    };
    const KEY = "tb_jarvis_local";
    const C = (() => { try { return { size: "", downloaded: false, ...(JSON.parse(localStorage.getItem(KEY) || "{}")) }; } catch (e) { return { size: "", downloaded: false }; } })();
    function save() { try { localStorage.setItem(KEY, JSON.stringify(C)); } catch (e) { /* storage full */ } }

    const S = { engine: null, loading: null, progress: 0, text: "", error: null, history: [], lastTurn: 0, gpu: null };

    async function supported() {
        if (S.gpu !== null) return S.gpu;
        try { S.gpu = !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch (e) { S.gpu = false; }
        return S.gpu;
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

    function load(onProgress, opts = {}) {
        if (S.engine) return Promise.resolve(S.engine);
        if (S.loading) return S.loading;
        S.error = null;
        S.loading = (async () => {
            if (!(await supported())) throw new Error("Dieser Browser hat kein WebGPU — bitte Chrome oder Edge nutzen.");
            await downloadModel((p, t) => { S.progress = p * 0.9; S.text = t; onProgress && onProgress(S.progress, S.text); }, opts);
            const { CreateWebWorkerMLCEngine } = await import(WEBLLM);
            const worker = new Worker("jarvis-llm-worker.js", { type: "module" });
            const engine = await CreateWebWorkerMLCEngine(worker, MODELS[size()].id, {
                initProgressCallback: (r) => { S.progress = 0.9 + 0.1 * (r.progress || 0); S.text = /Fetching|Loading model from cache/i.test(r.text || "") ? "Starte KI-Gehirn …" : (r.text || ""); onProgress && onProgress(S.progress, S.text); },
            });
            S.engine = engine;
            C.downloaded = true; C.loadedSize = size(); save();
            return engine;
        })();
        S.loading.catch((e) => { S.error = String((e && e.message) || e); S.loading = null; });
        return S.loading;
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
        const news = A.news(5, false).map((n, i) => `${i + 1}. ${n.source}, vor ${n.minutes_ago} Min.: ${n.title}`).join("\n");
        return `Bot-Status: ${JSON.stringify(st)}\nNeueste Meldungen:\n${news || "keine"}${extra ? `\n\nZUSATZINFOS ZUR FRAGE:\n${extra}` : ""}`;
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

    function reset() { S.history = []; }
    async function remove() {
        try {
            const mod = await import(WEBLLM);
            for (const m of Object.values(MODELS)) { try { await mod.deleteModelAllInfoInCache(m.id); } catch (e) { /* not cached */ } }
        } catch (e) { /* offline */ }
        S.engine = null; S.loading = null; C.downloaded = false; save();
    }

    window.JarvisLocal = {
        MODELS, config: C, save, state: S, supported, load, ask, reset, remove, webSearch, size,
        fsSupported, pickDir, savedDir,
        ready: () => !!S.engine, loading: () => !!S.loading && !S.engine,
    };
})();
