/*
 * Jarvis KI-Modus — natürliche Gespräche über die Claude API, direkt aus dem Browser mit dem
 * eigenen API-Schlüssel des Nutzers (bleibt lokal auf dem Gerät, geht nur an api.anthropic.com).
 * Tools: News lesen, Status, Kurs, Markt scannen, Automatik an/aus (nur Papierhandel), Websuche.
 * Jarvis kann keine Orders auslösen — dafür gibt es schlicht kein Tool.
 */
(function () {
    "use strict";

    const SDK_URL = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm";
    const MODELS = {
        "claude-opus-5-5": "Opus 5.5 — klügste Antworten",
        "claude-sonnet-5-5": "Sonnet 5.5 — sehr gut und schneller",
        "claude-haiku-5-5": "Haiku 5.5 — am schnellsten, sehr günstig",
    };
    const KEY = "tb_jarvis_ai";
    const DEF = { apiKey: "", model: "claude-opus-5-5", address: "Sir", web: true };
    const C = (() => { try { return { ...DEF, ...(JSON.parse(localStorage.getItem(KEY) || "{}")) }; } catch (e) { return { ...DEF }; } })();
    function save() { try { localStorage.setItem(KEY, JSON.stringify(C)); } catch (e) { /* storage full */ } }

    let client = null, clientKey = null, history = [], lastTurn = 0;

    function systemPrompt() {
        return `Du bist J.A.R.V.I.S., der persönliche Sprachassistent eines Krypto-Trading-Bots. Der Bot handelt ausschließlich im Demo-Modus mit 10 000 USDT Spielgeld; echte Orders sind technisch gesperrt.

Deine Antworten werden vorgelesen. Sprich deshalb natürliches, flüssiges Deutsch wie ein Mensch im Gespräch: meist ein bis drei kurze Sätze, keine Listen, kein Markdown, keine Emojis, keine Links. Runde Zahlen sinnvoll (Kurse ohne Nachkommastellen ab 100 Dollar, Prozente mit einer Nachkommastelle). Sprich den Nutzer gelegentlich mit „${C.address || "Sir"}“ an, nicht in jedem Satz. Ton: ruhig, souverän, präzise, mit einem Hauch trockenem britischem Humor — nie albern.

Führe ein echtes Gespräch: geh auf das Gesagte ein, beziehe dich auf vorher Gesagtes, stell eine kurze Rückfrage, wenn etwas wirklich unklar ist, und plaudere auch über Dinge außerhalb des Tradings, wenn der Nutzer das möchte. Die Eingaben kommen aus einer Spracherkennung: Wörter können verwechselt, Satzzeichen fehlen oder Sätze abgebrochen sein — interpretiere wohlwollend, was gemeint ist, statt auf Formulierungen herumzureiten. Antworte zügig und ohne Einleitungsfloskeln.

Jede Nachricht des Nutzers enthält einen aktuellen <bot_status>-Block mit Depot, Positionen, Modus, validierten Edges und Radar. Nutze ihn für Fragen zum Bot, ohne ihn vorzulesen.

Bei Fragen zu News oder „was gibt es Neues“: nutze get_news_analysis, fasse die Lage in zwei bis drei Sätzen zusammen (Stimmung, Themen, betroffene Coins), schlage die beste Idee vor und frage, ob du sie im Demo-Konto umsetzen sollst. Erst nach einem klaren Ja rufst du execute_idea auf.
Werkzeuge: Nutze get_news, um Meldungen vorzulesen — übersetze englische Schlagzeilen sinngemäß ins Deutsche und nenne die Quelle. Nutze scan_for_entries, wenn nach Einstiegen oder Gelegenheiten gefragt wird, und erkläre das Ergebnis knapp. Nutze set_auto_mode, wenn der Nutzer den Bot pausieren, stoppen oder starten will, und bestätige danach. Nutze get_price für Kurse. Nutze die Websuche nur, wenn die Frage aktuelle Informationen außerhalb des Bots braucht, und nenne die Quelle kurz.

Grenzen: Trades eröffnest du nur als Demo-Trade aus einer Bot-Idee über execute_idea und nur nach Zustimmung; sonst änderst du nichts außer der Automatik und bewegst nie echtes Geld. Gib keine Gewinnversprechen; bei Einschätzungen zu Kursen weise kurz auf die Unsicherheit hin. Wenn ein Werkzeug fehlschlägt, sag ehrlich, was du nicht weißt.`;
    }

    const TOOLS = [
        { name: "get_news", description: "Liefert die neuesten Krypto-Meldungen (Titel, Quelle, Minuten seit Veröffentlichung, betroffene Coins).", strict: true, eager_input_streaming: true,
          input_schema: { type: "object", properties: { count: { type: "integer", description: "Anzahl 1-10" }, trusted_only: { type: "boolean", description: "nur geprüfte Redaktionen" } }, required: ["count", "trusted_only"], additionalProperties: false } },
        { name: "scan_for_entries", description: "Startet sofort einen Scan aller Märkte und liefert mögliche Einstiege, ob die Edge per Walk-Forward bestätigt ist, und die Märkte, die am nächsten an einem Signal sind.", strict: true, eager_input_streaming: true,
          input_schema: { type: "object", properties: {}, required: [], additionalProperties: false } },
        { name: "set_auto_mode", description: "Schaltet die Vollautomatik des Demo-Bots an (enabled=true) oder pausiert sie (enabled=false). Offene Positionen behalten ihre Stops.", strict: true, eager_input_streaming: true,
          input_schema: { type: "object", properties: { enabled: { type: "boolean" } }, required: ["enabled"], additionalProperties: false } },
        { name: "get_news_analysis", description: "Analysiert die Meldungen der letzten 12 Stunden: Stimmung, Themen, betroffene Coins, wichtigste Schlagzeilen und konkrete Ideen des Bots (mit id).", strict: true, eager_input_streaming: true,
          input_schema: { type: "object", properties: {}, required: [], additionalProperties: false } },
        { name: "execute_idea", description: "Setzt eine Idee aus get_news_analysis im DEMO-Konto um (Demo-Trade eröffnen oder Stop absichern). Nur aufrufen, nachdem der Nutzer ausdrücklich zugestimmt hat.", strict: true, eager_input_streaming: true,
          input_schema: { type: "object", properties: { idea_id: { type: "string" } }, required: ["idea_id"], additionalProperties: false } },
        { name: "get_price", description: "Aktueller Kurs in USDT und 24-Stunden-Veränderung eines Coins, z. B. BTC, ETH, SOL.", strict: true, eager_input_streaming: true,
          input_schema: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"], additionalProperties: false } },
    ];

    function runTool(name, input) {
        const A = window.TBJarvisActions;
        if (!A) return { error: "Bot noch nicht bereit" };
        const inp = input && typeof input === "object" ? input : {};
        switch (name) {
            case "get_news": return { items: A.news(Number.isInteger(inp.count) ? inp.count : 2, inp.trusted_only === true) };
            case "scan_for_entries": return A.scan();
            case "set_auto_mode": return typeof inp.enabled === "boolean" ? A.setAuto(inp.enabled) : { error: "enabled fehlt" };
            case "get_news_analysis": return A.newsAnalysis();
            case "execute_idea": return typeof inp.idea_id === "string" ? A.executeIdea(inp.idea_id) : { error: "idea_id fehlt" };
            case "get_price": return typeof inp.symbol === "string" ? A.price(inp.symbol) : { error: "symbol fehlt" };
            default: return { error: `unbekanntes Werkzeug ${name}` };
        }
    }

    async function getClient() {
        if (client && clientKey === C.apiKey) return client;
        const mod = await import(SDK_URL);
        const Anthropic = mod.default || mod.Anthropic;
        // The key belongs to the user and stays on their device; it is sent only to api.anthropic.com.
        client = new Anthropic({ apiKey: C.apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 60000 });
        clientKey = C.apiKey;
        return client;
    }

    function serverTools() {
        if (!C.web) return [];
        // Dynamic-filtering web search runs on Opus/Sonnet 5.5; Haiku gets the basic variant.
        return [C.model === "claude-haiku-5-5"
            ? { type: "web_search_20250305", name: "web_search", max_uses: 3 }
            : { type: "web_search_20260209", name: "web_search", max_uses: 3 }];
    }

    // Streams one turn; complete sentences are handed to onSentence as they arrive so Jarvis
    // can start speaking before the answer is finished.
    async function ask(text, { onSentence, onStatus } = {}) {
        if (!C.apiKey) throw new Error("Kein API-Schlüssel");
        const api = await getClient();
        const status = window.TBJarvisActions ? window.TBJarvisActions.status() : {};
        // History is append-only (current models reject edited history); a long pause or a very
        // long chat simply starts a fresh conversation.
        if (Date.now() - lastTurn > 15 * 60e3 || history.length > 60) history = [];
        lastTurn = Date.now();
        history.push({ role: "user", content: `<bot_status>${JSON.stringify(status)}</bot_status>\n\n${text}` });
        let spokenAny = false;
        for (let round = 0; round < 6; round++) {
            let buf = "";
            const flush = (final) => {
                // The very first chunk may end at a clause (comma, colon, dash) so the voice starts
                // as early as possible; after that whole sentences sound more natural.
                const re = final ? /[\s\S]+/ : !spokenAny ? /^(?:[\s\S]{24,}?[,;:–](?=\s)|[\s\S]{8,}?[.!?…](?=\s|$))/ : /^[\s\S]{12,}?[.!?…](?=\s|$)/;
                for (;;) {
                    const m = re.exec(buf);
                    if (!m || !m[0].trim()) break;
                    const sentence = m[0].trim();
                    buf = buf.slice(m[0].length);
                    spokenAny = true;
                    onSentence && onSentence(sentence);
                    if (final) break;
                }
            };
            const params = {
                model: C.model,
                max_tokens: 2000,
                system: [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }],
                tools: [...TOOLS, ...serverTools()],
                output_config: { effort: "low" },
                messages: history,
            };
            const betas = [];
            if (C.model !== "claude-haiku-5-5") { betas.push("server-side-fallback-2026-07-01"); params.fallbacks = "default"; }
            const stream = betas.length ? api.beta.messages.stream({ ...params, betas }) : api.messages.stream(params);
            stream.on("text", (d) => { buf += d; flush(false); });
            const msg = await stream.finalMessage();
            flush(true);
            history.push({ role: "assistant", content: msg.content });
            if (msg.stop_reason === "refusal") {
                if (!spokenAny) onSentence && onSentence("Dazu kann ich leider nichts sagen.");
                return;
            }
            if (msg.stop_reason === "pause_turn") { onStatus && onStatus("sucht weiter …"); continue; }
            if (msg.stop_reason !== "tool_use") return;
            const uses = msg.content.filter((b) => b.type === "tool_use");
            if (!uses.length) return;
            onStatus && onStatus(uses.map((u) => ({ get_news: "liest News", scan_for_entries: "scannt die Märkte", set_auto_mode: "schaltet Automatik", get_price: "holt Kurs" }[u.name] || u.name)).join(", ") + " …");
            const results = [];
            for (const u of uses) {
                let out;
                try { out = await runTool(u.name, u.input); } catch (e) { out = { error: String(e && e.message || e) }; }
                results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out), is_error: !!(out && out.error) });
            }
            history.push({ role: "user", content: results });
        }
    }

    async function summarize(prompt) {
        const api = await getClient();
        const msg = await api.messages.create({ model: C.model, max_tokens: 300, output_config: { effort: "low" },
            system: "Du bist J.A.R.V.I.S. Antworte auf Deutsch in ein bis zwei kurzen, gesprochenen Sätzen, ohne Listen, Markdown oder Links.",
            messages: [{ role: "user", content: prompt }] });
        if (msg.stop_reason === "refusal") return "";
        return msg.content.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    }
    function reset() { history = []; }
    // Checks a key without a billed request (model lookup).
    async function verify(key) {
        const mod = await import(SDK_URL);
        const Anthropic = mod.default || mod.Anthropic;
        const api = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 0, timeout: 15000 });
        await api.models.retrieve(C.model);
        return true;
    }
    // Loads the SDK ahead of the first question so the first answer isn't slower than the rest.
    function warm() { getClient().catch(() => {}); }
    window.JarvisAI = { config: C, save, models: MODELS, ask, summarize, reset, verify, warm, available: () => !!C.apiKey };
})();
