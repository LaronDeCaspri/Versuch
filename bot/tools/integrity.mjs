// Writes bot/mobile/standalone/integrity.json: SHA-256 of every app file, checked by the app at
// runtime (v55 self-check). Run after every change: node bot/tools/integrity.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "mobile", "standalone");
export const FILES = ["index.html", "app.css", "boot.js", "app.js", "lib.js", "pro.js", "radar.js", "btc-brain.js", "jarvis.js", "jarvis-local.js",
    "jarvis-ai.js", "jarvis-llm-worker.js", "jarvis-tts-worker.js", "jarvis-stt-worker.js", "pro-worker.js", "sw.js", "manifest.json"];

export function buildManifest() {
    const app = fs.readFileSync(path.join(APP_DIR, "app.js"), "utf8");
    const version = (/const APP_VERSION = "([^"]+)"/.exec(app) || [])[1] || "?";
    const files = {};
    for (const f of FILES) files[f] = crypto.createHash("sha256").update(fs.readFileSync(path.join(APP_DIR, f))).digest("hex");
    return { version, algorithm: "SHA-256", files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const m = buildManifest();
    fs.writeFileSync(path.join(APP_DIR, "integrity.json"), JSON.stringify(m, null, 2) + "\n");
    console.log(`integrity.json: ${Object.keys(m.files).length} Dateien, Version ${m.version}`);
}
