import { Worker } from "worker_threads";
import * as path from "path";
import * as fs from "fs";
import * as http from "http";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let ttsWorker = null;
let httpServer = null;
const EXTENSION_API_PORT = 51730;
// Keep track of pending TTS requests
const pendingRequests = new Map();
// SharedArrayBuffer epoch used to interrupt the worker mid-job. The main process
// bumps the epoch when a newer request arrives or a client disconnects; the worker
// reads it synchronously between chunks (a postMessage can't land while ONNX
// inference is blocking the worker thread) and bails when its epoch is stale.
const epochBuffer = new SharedArrayBuffer(4);
const epochView = new Int32Array(epochBuffer);
let epochCounter = 0;
// Serialize worker jobs so only one runs at a time. Concurrent jobs contend on
// CPU + the single ONNX session and blow up latency (observed 2.5s -> 15s under
// load). Newest request wins; older ones are superseded via the epoch above.
let workerBusy = Promise.resolve();
function createTTSWorker() {
    // In compiled output, server.js lives at server root (outDir = ..),
    // and tts-worker.js is also at server root alongside it.
    const workerPath = path.join(__dirname, "tts-worker.js");
    console.log("[Worker] Starting from:", workerPath);
    ttsWorker = new Worker(workerPath, { workerData: { epochBuffer } });
    ttsWorker.on("message", (message) => {
        const { requestId, type, data, error } = message;
        console.log("[Worker] Message:", type, requestId ? `(${requestId.slice(0, 8)})` : "");
        if (type === "progress") {
            const pending = pendingRequests.get(requestId);
            if (pending?.onChunk) {
                pending.onChunk({ type: "progress", data });
            }
            return;
        }
        if (type === "chunk") {
            const pending = pendingRequests.get(requestId);
            if (pending?.onChunk) {
                pending.onChunk({ type: "chunk", data });
            }
            return;
        }
        if (type === "result") {
            const pending = pendingRequests.get(requestId);
            if (pending) {
                pending.resolve(data);
                pendingRequests.delete(requestId);
            }
        }
        // Worker confirms it stopped a superseded/cancelled job and is now free.
        if (type === "cancelled") {
            const pending = pendingRequests.get(requestId);
            if (pending) {
                pending.resolve(null);
                pendingRequests.delete(requestId);
            }
        }
        if (type === "error") {
            const { stack, platform, arch } = message;
            console.error("[Worker] TTS error:", error, stack ? `\n  stack: ${stack}` : "", platform ? `\n  platform: ${platform}/${arch}` : "");
            const pending = pendingRequests.get(requestId);
            if (pending) {
                const richError = new Error(error);
                richError.stack = stack || richError.stack;
                richError.workerPlatform = platform;
                richError.workerArch = arch;
                pending.reject(richError);
                pendingRequests.delete(requestId);
            }
        }
    });
    ttsWorker.on("error", (error) => {
        console.error("[Worker] ERROR:", error);
    });
    ttsWorker.on("exit", (code) => {
        console.error("[Worker] Exited with code:", code);
    });
}
async function preloadModel() {
    if (ttsWorker) {
        console.log("[Main] Requesting model preload...");
        ttsWorker.postMessage({
            type: "preload",
            data: { model: "model_q8f16" },
        });
    }
}
function generateTTS(params, onChunk, onRequestId) {
    return new Promise((resolve, reject) => {
        if (!ttsWorker) {
            reject(new Error("TTS Worker not initialized"));
            return;
        }
        const requestId = crypto.randomUUID();
        pendingRequests.set(requestId, { resolve, reject, onChunk });
        if (onRequestId)
            onRequestId(requestId);
        console.log(`[HTTP] generate ${requestId.slice(0, 8)} queued (in-flight=${pendingRequests.size})`);
        ttsWorker.postMessage({
            type: "generate",
            requestId,
            data: params,
        });
    });
}
// Cancel an in-flight request (client disconnected). Tells the worker to stop
// scheduling chunks and settles the pending promise so the HTTP handler unwinds.
function cancelTTS(requestId) {
    if (!pendingRequests.has(requestId))
        return;
    // Bump the epoch so the running job sees a stale epoch and bails at the next
    // chunk boundary; the cancel message is a pre-inference fallback. We do NOT
    // resolve the pending here — the worker posts a terminal "cancelled" message
    // when it actually stops, which resolves it. That keeps workerBusy held until
    // the worker is truly free, so the next job doesn't overlap (active stays 1).
    Atomics.store(epochView, 0, ++epochCounter);
    ttsWorker?.postMessage({ type: "cancel", requestId });
    console.log(`[HTTP] cancel ${requestId.slice(0, 8)} (in-flight=${pendingRequests.size})`);
}
// Run a TTS job exclusively: claim a new epoch (superseding older jobs), wait for
// the previous job to finish/yield, then generate. The worker reads the epoch via
// SharedArrayBuffer and abandons stale jobs at the next chunk boundary.
function generateExclusive(params, onChunk, onRequestId) {
    const myEpoch = ++epochCounter;
    Atomics.store(epochView, 0, myEpoch); // supersede any older / running job
    const prev = workerBusy;
    let release = () => { };
    workerBusy = new Promise((r) => (release = r));
    const run = (async () => {
        await prev.catch(() => { });
        // A newer request arrived while we waited — skip ours entirely.
        if (Atomics.load(epochView, 0) !== myEpoch)
            return null;
        return await generateTTS({ ...params, epoch: myEpoch }, onChunk, onRequestId);
    })();
    run.then(() => release(), () => release());
    return run;
}
function getVoiceLang(voiceId) {
    const prefix = voiceId.substring(0, 2);
    const langMap = {
        af: "en-us",
        am: "en-us",
        bf: "en-gb",
        bm: "en-gb",
        jf: "ja",
        jm: "ja",
        zf: "cmn",
        zm: "cmn",
        ef: "es-419",
        em: "es-419",
        hf: "hi",
        hm: "hi",
        if: "it",
        im: "it",
        pf: "pt-br",
        pm: "pt-br",
    };
    return langMap[prefix] || "en-us";
}
function getVoicesList() {
    return [
        { id: "af_heart", name: "Heart", lang: "en-us", engine: "kokoro" },
        { id: "af_bella", name: "Bella", lang: "en-us", engine: "kokoro" },
        { id: "am_michael", name: "Michael", lang: "en-us", engine: "kokoro" },
        { id: "am_adam", name: "Adam", lang: "en-us", engine: "kokoro" },
        { id: "bf_emma", name: "Emma", lang: "en-gb", engine: "kokoro" },
        { id: "bm_george", name: "George", lang: "en-gb", engine: "kokoro" },
        { id: "jf_alpha", name: "Alpha", lang: "ja", engine: "kokoro" },
        { id: "jm_kumo", name: "Kumo", lang: "ja", engine: "kokoro" },
        { id: "zf_xiaobei", name: "Xiaobei", lang: "cmn", engine: "kokoro" },
        { id: "zm_yunjian", name: "Yunjian", lang: "cmn", engine: "kokoro" },
    ];
}
// ============ HTTP Server ============
function createExtensionServer() {
    httpServer = http.createServer(async (req, res) => {
        // Security: Only accept localhost connections
        const remoteAddr = req.socket.remoteAddress;
        const isLocalhost = remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "::ffff:127.0.0.1";
        if (!isLocalhost) {
            console.log(`[HTTP] Rejected non-localhost request from ${remoteAddr}`);
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Forbidden: localhost only" }));
            return;
        }
        // CORS headers for extension access
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        // Handle preflight
        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }
        const url = new URL(req.url || "/", `http://localhost:${EXTENSION_API_PORT}`);
        // GET /api/v1/openapi.yaml - OpenAPI 3.1 spec
        if (req.method === "GET" && url.pathname === "/api/v1/openapi.yaml") {
            try {
                const specPath = path.join(__dirname, "..", "..", "docs", "app", "openapi.yaml");
                const spec = fs.readFileSync(specPath, "utf-8");
                res.writeHead(200, { "Content-Type": "application/yaml" });
                res.end(spec);
            }
            catch (err) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "openapi.yaml not found", detail: err.message }));
            }
            return;
        }
        // GET /api/v1/audio/voices
        if (req.method === "GET" && url.pathname === "/api/v1/audio/voices") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ voices: getVoicesList() }));
            return;
        }
        // POST /api/v1/audio/speech/stream - Streaming TTS
        if (req.method === "POST" && url.pathname === "/api/v1/audio/speech/stream") {
            let body = "";
            req.on("data", (chunk) => (body += chunk));
            req.on("end", async () => {
                const startedAt = Date.now();
                let requestId = null;
                let finished = false;
                let firstChunkAt = 0;
                let chunksSent = 0;
                // If the client disconnects before we finish, cancel the worker job so
                // abandoned clicks don't pile up and starve the next request.
                const onClose = () => {
                    if (!finished && requestId) {
                        console.log(`[HTTP] client disconnected after ${chunksSent} chunks, ${Date.now() - startedAt}ms`);
                        cancelTTS(requestId);
                    }
                };
                res.on("close", onClose);
                try {
                    const params = JSON.parse(body);
                    const { voice, input, speed } = params;
                    const lang = getVoiceLang(voice);
                    console.log("[HTTP] Streaming request:", { voice, lang, textLength: input?.length });
                    res.writeHead(200, {
                        "Content-Type": "application/octet-stream",
                        "Transfer-Encoding": "chunked",
                    });
                    await generateExclusive({
                        text: input,
                        lang,
                        voiceFormula: voice,
                        model: "model_q8f16",
                        speed: speed || 1,
                        format: "wav",
                        acceleration: "cpu",
                        streaming: true,
                    }, (msg) => {
                        if (msg.type === "chunk") {
                            if (res.writableEnded || res.destroyed)
                                return;
                            const { chunkIndex, totalChunks, base64 } = msg.data;
                            const wavBuffer = Buffer.from(base64, "base64");
                            if (!firstChunkAt) {
                                firstChunkAt = Date.now();
                                console.log(`[HTTP] first chunk in ${firstChunkAt - startedAt}ms (${totalChunks} total)`);
                            }
                            // Write chunk header (12 bytes) + WAV data
                            const header = Buffer.alloc(12);
                            header.writeUInt32LE(chunkIndex, 0);
                            header.writeUInt32LE(totalChunks, 4);
                            header.writeUInt32LE(wavBuffer.length, 8);
                            res.write(header);
                            res.write(wavBuffer);
                            chunksSent++;
                        }
                    }, (id) => (requestId = id));
                    finished = true;
                    if (!res.writableEnded)
                        res.end();
                    console.log(`[HTTP] stream done: ${chunksSent} chunks in ${Date.now() - startedAt}ms`);
                }
                catch (error) {
                    finished = true;
                    console.error("[HTTP] Streaming error:", error);
                    if (!res.headersSent) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                    }
                    if (!res.writableEnded)
                        res.end(JSON.stringify({ error: error.message }));
                }
            });
            return;
        }
        // POST /api/v1/audio/speech - Blocking TTS (full audio)
        if (req.method === "POST" && url.pathname === "/api/v1/audio/speech") {
            let body = "";
            req.on("data", (chunk) => (body += chunk));
            req.on("end", async () => {
                try {
                    const params = JSON.parse(body);
                    const { voice, input, speed, response_format } = params;
                    const lang = getVoiceLang(voice);
                    console.log("[HTTP] Blocking request:", { voice, lang, textLength: input?.length });
                    // Collect all chunks
                    const chunks = [];
                    await generateExclusive({
                        text: input,
                        lang,
                        voiceFormula: voice,
                        model: "model_q8f16",
                        speed: speed || 1,
                        format: response_format === "mp3" ? "mp3" : "wav",
                        acceleration: "cpu",
                        streaming: true,
                    }, (msg) => {
                        if (msg.type === "chunk") {
                            const { base64 } = msg.data;
                            chunks.push(Buffer.from(base64, "base64"));
                        }
                    });
                    // Concatenate all audio chunks
                    const fullAudio = Buffer.concat(chunks);
                    const contentType = response_format === "mp3" ? "audio/mpeg" : "audio/wav";
                    res.writeHead(200, { "Content-Type": contentType });
                    res.end(fullAudio);
                }
                catch (error) {
                    console.error("[HTTP] Blocking error:", error);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: error.message }));
                }
            });
            return;
        }
        // 404 for unknown routes
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
    });
    httpServer.listen(EXTENSION_API_PORT, "127.0.0.1", () => {
        console.log(`[HTTP] Extension API server running on http://127.0.0.1:${EXTENSION_API_PORT}`);
    });
    httpServer.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
            console.error(`[HTTP] Port ${EXTENSION_API_PORT} already in use`);
        }
        else {
            console.error("[HTTP] Server error:", err);
        }
    });
}
// ============ Process Lifecycle ============
function shutdown() {
    console.log("[Server] Shutting down...");
    if (httpServer) {
        httpServer.close();
        httpServer = null;
    }
    for (const [, pending] of pendingRequests) {
        pending.reject(new Error("Server is shutting down"));
    }
    pendingRequests.clear();
    if (ttsWorker) {
        const worker = ttsWorker;
        ttsWorker = null;
        worker.terminate().then(() => process.exit(0), () => process.exit(1));
    }
    else {
        process.exit(0);
    }
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
// ============ Start ============
createTTSWorker();
createExtensionServer();
preloadModel();
