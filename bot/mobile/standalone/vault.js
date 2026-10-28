/*
 * Tresor für API-Schlüssel: Geheimnisse (Claude, Groq, ElevenLabs, Telegram, E-Mail) liegen nicht
 * mehr im Klartext im Browser-Speicher, sondern AES-256-GCM-verschlüsselt. Der Schlüssel ist ein
 * vom Browser erzeugter, nicht exportierbarer CryptoKey in IndexedDB.
 * Die übrigen Module merken davon nichts: localStorage.getItem/setItem werden für die betroffenen
 * Einträge transparent umgeleitet (Geheimnis raus beim Schreiben, wieder rein beim Lesen).
 * Grenze: schützt vor dem einfachen Auslesen des Speichers (DevTools, Kopien, Backups), nicht vor
 * Schadsoftware, die im Browser dieser Seite selbst läuft.
 */
(function () {
    "use strict";
    // localStorage entry → secret JSON fields (true = the whole value is secret)
    const SECRETS = { tb_jarvis_ai: ["apiKey"], tb_jarvis_local: ["groqKey"], tb_jarvis: ["premiumKey"], tb_tg_token: true, tb_email_key: true };
    const VAULT = "tb_vault";
    const proto = Storage.prototype, rawGet = proto.getItem, rawSet = proto.setItem;
    const ls = (() => { try { return window.localStorage; } catch (e) { return null; } })();
    const V = (window.TBVault = { ready: false, active: false, mem: {}, error: null });
    if (!ls || !(window.crypto && crypto.subtle) || !window.indexedDB) { V.error = "nicht verfügbar"; return; }

    const id = (k, f) => (f === true ? k : `${k}.${f}`);
    const fields = (k) => (SECRETS[k] === true ? [true] : SECRETS[k]);
    let key = null, persistT = null, disabled = false;

    function strip(k, value) {
        if (SECRETS[k] === true) {
            if (value || V.ready) V.mem[k] = value || "";
            return "";
        }
        let o;
        try { o = JSON.parse(value); } catch (e) { return value; }
        if (!o || typeof o !== "object") return value;
        for (const f of fields(k)) {
            const v = o[f];
            // Before unlocking, an empty field only means "not loaded yet" — never delete a secret then.
            if (typeof v === "string" && (v || V.ready)) V.mem[id(k, f)] = v;
            if (f in o) o[f] = "";
        }
        return JSON.stringify(o);
    }
    function inject(k, raw) {
        if (SECRETS[k] === true) return V.mem[k] || raw;
        if (raw == null) return raw;
        let o;
        try { o = JSON.parse(raw); } catch (e) { return raw; }
        if (!o || typeof o !== "object") return raw;
        for (const f of fields(k)) if (V.mem[id(k, f)]) o[f] = V.mem[id(k, f)];
        return JSON.stringify(o);
    }
    proto.setItem = function (k, v) {
        if (this !== ls || disabled || !(k in SECRETS)) return rawSet.call(this, k, v);
        rawSet.call(this, k, strip(k, String(v)));
        schedule();
    };
    proto.getItem = function (k) {
        const raw = rawGet.call(this, k);
        if (this !== ls || disabled || !(k in SECRETS)) return raw;
        return inject(k, raw);
    };

    const b64 = (u8) => btoa(String.fromCharCode(...u8));
    const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    function idb(mode, fn) {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open("tb_vault", 1);
            req.onupgradeneeded = () => req.result.createObjectStore("k");
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
                try {
                    const tx = req.result.transaction("k", mode), r = fn(tx.objectStore("k"));
                    tx.oncomplete = () => { req.result.close(); resolve(r && r.result); };
                    tx.onerror = () => { req.result.close(); reject(tx.error); };
                } catch (e) { req.result.close(); reject(e); }
            };
        });
    }
    async function cryptoKey() {
        let k = await idb("readonly", (st) => st.get("aes"));
        if (!k) {
            k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
            await idb("readwrite", (st) => st.put(k, "aes"));
        }
        return k;
    }
    function schedule() { if (!V.ready) return; clearTimeout(persistT); persistT = setTimeout(persist, 50); }
    async function persist() {
        if (!key) return;
        const clean = Object.fromEntries(Object.entries(V.mem).filter(([, v]) => v));
        if (!Object.keys(clean).length) { try { ls.removeItem(VAULT); } catch (e) { /* ignore */ } return; }
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(clean))));
        rawSet.call(ls, VAULT, JSON.stringify({ v: 1, iv: b64(iv), ct: b64(ct) }));
    }

    V.unlock = (async () => {
        try {
            key = await cryptoKey();
            const box = rawGet.call(ls, VAULT);
            if (box) {
                const { iv, ct } = JSON.parse(box);
                const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, unb64(ct));
                // Values written since page load are newer than the stored ones.
                V.mem = { ...JSON.parse(new TextDecoder().decode(plain)), ...V.mem };
            }
            // Migration: secrets still lying around in plain text move into the vault.
            for (const k of Object.keys(SECRETS)) {
                const raw = rawGet.call(ls, k);
                if (raw) rawSet.call(ls, k, strip(k, raw));
            }
            V.ready = true; V.active = true;
            await persist();
        } catch (e) {
            // No vault possible (e.g. private mode or a lost key): put the secrets back in place.
            V.error = String((e && e.message) || e);
            disabled = true;
            for (const [mk, v] of Object.entries(V.mem)) {
                if (!v) continue;
                const [k, f] = mk.includes(".") ? mk.split(/\.(.+)/) : [mk, true];
                if (f === true) rawSet.call(ls, k, v);
                else { try { const o = JSON.parse(rawGet.call(ls, k) || "{}"); o[f] = v; rawSet.call(ls, k, JSON.stringify(o)); } catch (err) { /* ignore */ } }
            }
            V.ready = true;
        }
        window.dispatchEvent(new CustomEvent("tb-vault-ready", { detail: { active: V.active } }));
        return V.active;
    })();
    // The Jarvis modules read their settings before the vault is open: hand them their keys now.
    window.addEventListener("tb-vault-ready", () => {
        const m = V.mem;
        if (window.JarvisAI && m["tb_jarvis_ai.apiKey"] && !window.JarvisAI.config.apiKey) window.JarvisAI.config.apiKey = m["tb_jarvis_ai.apiKey"];
        if (window.JarvisLocal && m["tb_jarvis_local.groqKey"] && !window.JarvisLocal.config.groqKey) window.JarvisLocal.config.groqKey = m["tb_jarvis_local.groqKey"];
        if (window.jarvis && window.jarvis.settings && m["tb_jarvis.premiumKey"] && !window.jarvis.settings.premiumKey) window.jarvis.settings.premiumKey = m["tb_jarvis.premiumKey"];
    });
})();
