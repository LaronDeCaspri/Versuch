const CACHE = "trading-bot-standalone-v2";
const ASSETS = ["./", "./app.css", "./app.js", "./lib.js", "./jarvis.js", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
    self.skipWaiting();
});

self.addEventListener("activate", (e) => {
    e.waitUntil(caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ));
    self.clients.claim();
});

self.addEventListener("fetch", (e) => {
    const url = new URL(e.request.url);
    // Never cache API calls (Binance, F&G, etc.)
    if (/binance\.com|alternative\.me|tradingview\.com/.test(url.hostname)) return;
    e.respondWith(
        caches.match(e.request).then((r) => r || fetch(e.request).catch(() => caches.match("./")))
    );
});
