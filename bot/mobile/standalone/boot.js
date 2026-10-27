// Boot screen + first line of defence. Runs before anything else renders.
// Anti-clickjacking: the app never runs inside a foreign frame (CSP frame-ancestors cannot be
// set from a <meta> tag on a static host, so this is done here).
(function () {
    if (window.top === window.self) return;
    // Browsers usually refuse to let a frame navigate the top window — so the app never starts
    // inside the frame; the user gets a link to open it on its own.
    document.documentElement.innerHTML = '<body style="background:#0b0b10;color:#f5f5f7;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0;text-align:center"><div><b>Eingebettet in eine fremde Seite</b><p>Aus Sicherheitsgründen läuft der Trading-Bot nur im eigenen Fenster.</p><a style="color:#a78bfa" target="_top" rel="noopener" href="' + location.href.replace(/"/g, "%22") + '">Im eigenen Fenster öffnen</a></div></body>';
    throw new Error("framed");
})();
(function () {
    // Real milestones from app.js ("tb-boot" events); the screen leaves once market data is in,
    // after at least 1.4 s (so it never flashes) and at the latest after 7 s (slow network).
    var t0 = Date.now(), done = false, pct = 6;
    var steps = { engine: [30, "Engine geladen"], ui: [55, "Oberfläche bereit"], data: [90, "Live-Marktdaten verbunden"], ready: [100, "Bereit"] };
    function set(p, text) { pct = Math.max(pct, p); var b = document.getElementById("bt-bar"), s = document.getElementById("bt-step"); if (b) b.style.width = pct + "%"; if (s && text) s.innerHTML = "<b>✓</b> " + text; }
    function hide() {
        if (done) return; done = true;
        set(100, "Bereit");
        setTimeout(function () {
            var el = document.getElementById("boot"); if (!el) return;
            el.classList.add("out");
            document.documentElement.classList.remove("booting");
            setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 800);
        }, Math.max(0, 1400 - (Date.now() - t0)));
    }
    window.addEventListener("tb-boot", function (e) {
        var k = e.detail && e.detail.step, st = steps[k];
        if (st) set(st[0], st[1]);
        if (k === "data" || k === "ready") setTimeout(hide, 350);
    });
    var creep = setInterval(function () { if (done) return clearInterval(creep); if (pct < 85) set(pct + 1.5); }, 220);
    setTimeout(function () { set(pct, "Fast fertig …"); hide(); }, 7000);
})();
