/*
 * Jarvis — in-browser German voice assistant using the Web Speech API.
 * Polls /api/announcements and speaks each new item. Fully offline once
 * the page is loaded; no server-side TTS, no API cost.
 */
(function () {
    const state = {
        enabled: localStorage.getItem("jarvis_on") === "1",
        rate: parseFloat(localStorage.getItem("jarvis_rate") || "1.0"),
        pitch: parseFloat(localStorage.getItem("jarvis_pitch") || "1.0"),
        lang: localStorage.getItem("jarvis_lang") || "de-DE",
        voiceName: localStorage.getItem("jarvis_voice") || "",
        queue: [],
        speaking: false,
    };

    function getVoices() {
        return window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    }

    function pickVoice() {
        const voices = getVoices();
        if (!voices.length) return null;
        if (state.voiceName) {
            const v = voices.find((v) => v.name === state.voiceName);
            if (v) return v;
        }
        const german = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith(state.lang.slice(0, 2)));
        return german[0] || voices[0];
    }

    function speak(text, level = "info") {
        if (!state.enabled || !("speechSynthesis" in window)) return;
        state.queue.push({ text, level });
        if (!state.speaking) drain();
    }

    function drain() {
        const item = state.queue.shift();
        if (!item) { state.speaking = false; setPulse(false); return; }
        state.speaking = true;
        setPulse(true);
        const u = new SpeechSynthesisUtterance(item.text);
        u.lang = state.lang;
        u.rate = state.rate;
        u.pitch = state.pitch + (item.level === "alert" ? 0.1 : 0);
        u.volume = 1.0;
        const v = pickVoice();
        if (v) u.voice = v;
        u.onend = () => setTimeout(drain, 150);
        u.onerror = () => setTimeout(drain, 150);
        window.speechSynthesis.speak(u);
    }

    function setPulse(on) {
        const el = document.getElementById("jarvis-orb");
        if (el) el.classList.toggle("speaking", !!on);
    }

    async function poll() {
        try {
            const items = await fetch("/api/announcements").then((r) => r.json());
            if (!items || items.length === 0) return;
            const ids = items.map((i) => i.id);
            for (const i of items) {
                speak(i.text, i.level);
                writeToLog(i);
            }
            await fetch("/api/announcements/ack", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(ids),
            });
        } catch (e) { /* ignore */ }
    }

    function writeToLog(item) {
        const log = document.getElementById("jarvis-log");
        if (!log) return;
        const div = document.createElement("div");
        div.className = `jv-line jv-${item.level}`;
        const t = new Date(item.ts).toLocaleTimeString("de-DE", { hour12: false });
        div.innerHTML = `<span class="jv-time">${t}</span><span class="jv-text">${item.text}</span>`;
        log.prepend(div);
        while (log.children.length > 20) log.removeChild(log.lastChild);
    }

    function enable() {
        state.enabled = true;
        localStorage.setItem("jarvis_on", "1");
        speak("Jarvis aktiv. Bereit für Handelssignale.");
        updateUI();
    }
    function disable() {
        state.enabled = false;
        localStorage.setItem("jarvis_on", "0");
        window.speechSynthesis.cancel();
        state.queue = [];
        state.speaking = false;
        setPulse(false);
        updateUI();
    }

    function updateUI() {
        const btn = document.getElementById("jarvis-toggle");
        if (!btn) return;
        btn.textContent = state.enabled ? "Jarvis aktiv" : "Jarvis aktivieren";
        btn.classList.toggle("primary", state.enabled);
        document.getElementById("jarvis-panel")?.classList.toggle("on", state.enabled);
    }

    function populateVoicePicker() {
        const sel = document.getElementById("jarvis-voice-picker");
        if (!sel) return;
        const voices = getVoices();
        sel.innerHTML = "";
        for (const v of voices) {
            const o = document.createElement("option");
            o.value = v.name;
            o.textContent = `${v.name} (${v.lang})`;
            if (v.name === state.voiceName) o.selected = true;
            sel.appendChild(o);
        }
        sel.onchange = () => {
            state.voiceName = sel.value;
            localStorage.setItem("jarvis_voice", state.voiceName);
            speak("Stimme geändert.");
        };
    }

    window.jarvis = {
        speak,
        enable,
        disable,
        setRate(v) { state.rate = v; localStorage.setItem("jarvis_rate", String(v)); },
    };

    document.addEventListener("DOMContentLoaded", () => {
        updateUI();
        populateVoicePicker();
        if ("speechSynthesis" in window) {
            window.speechSynthesis.onvoiceschanged = populateVoicePicker;
        }
        document.getElementById("jarvis-toggle")?.addEventListener("click", () => {
            state.enabled ? disable() : enable();
        });
    });

    setInterval(poll, 3000);
})();
