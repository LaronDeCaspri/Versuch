const CACHE = "trading-bot-standalone-v10";
const ASSETS = ["./", "./app.css", "./app.js", "./lib.js", "./pro.js", "./radar.js", "./pro-worker.js", "./jarvis-ai.js", "./jarvis.js", "./jarvis-tts-worker.js", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
    self.skipWaiting();
});

self.addEventListener("activate", (e) => {
    e.waitUntil(caches.keys().then((keys) =>
        // Only old app caches — the downloaded Jarvis voice ("jarvis-voice-*") must survive updates.
        Promise.all(keys.filter((k) => k !== CACHE && k.startsWith("trading-bot-standalone")).map((k) => caches.delete(k)))
    ));
    self.clients.claim();
});

self.addEventListener("fetch", (e) => {
    const url = new URL(e.request.url);
    // Live server status must never come from the cache
    if (url.pathname.includes("/api/")) return;
    // Never cache API calls (Binance, F&G, etc.)
    if (/binance\.com|alternative\.me|tradingview\.com|yahoo\.com|stooq\.com|allorigins\.win|frankfurter\.app|huggingface\.co|anthropic\.com|elevenlabs\.io|exchangerate\.host|open\.er-api\.com|financialmodelingprep\.com/.test(url.hostname)) return;
    if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
    // Network first: every app update arrives immediately; the cache is only the offline fallback.
    e.respondWith(
        fetch(e.request).then((res) => {
            if (res && res.ok) {
                const copy = res.clone();
                caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
            }
            return res;
        }).catch(() => caches.match(e.request).then((r) => r || caches.match("./")))
    );
});

// v30: Periodic Background Sync — Browser gibt uns typisch ~30s pro Aktivierung
// alle 15 min. Das ist kein echtes 24/7, aber hilft wenn Tab im Hintergrund läuft.
self.addEventListener("periodicsync", (event) => {
    if (event.tag === "tb-scan") {
        event.waitUntil((async () => {
            try {
                // Wecke alle offenen Clients auf damit sie scannen
                const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
                for (const client of clients) {
                    client.postMessage({ type: "v30-background-tick", at: Date.now() });
                }
            } catch (e) { /* ignore */ }
        })());
    }
});

// Message vom Client für Debug/Trigger
self.addEventListener("message", (event) => {
    if (event.data && event.data.type === "ping") {
        event.source && event.source.postMessage({ type: "pong", at: Date.now() });
    }
});
