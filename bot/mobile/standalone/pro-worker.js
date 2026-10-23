// Walk-forward research off the UI thread. Same lib.js + pro.js as the app.
self.window = self;
importScripts("lib.js", "pro.js");

self.onmessage = async (ev) => {
    const { cmd, symbols, opts } = ev.data || {};
    if (cmd !== "research") return;
    try {
        const result = await self.TB.pro.runResearchMulti(symbols, opts, (p) => self.postMessage({ type: "progress", p }));
        self.postMessage({ type: "done", result });
    } catch (e) {
        self.postMessage({ type: "error", message: (e && e.message) || String(e) });
    }
};
