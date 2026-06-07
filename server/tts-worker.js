import { parentPort, workerData } from "worker_threads";
// @ts-ignore — onnxruntime-node ships its own .d.ts but NodeNext resolution misses it
import * as ort from "onnxruntime-node";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
// @ts-ignore
import ESpeakNg from "espeak-ng";
import { createWavBuffer, modifyWavSpeed, wavToMp3 } from "./shared-audio.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Resolve a path that may live inside app.asar to its real on-disk location
// under app.asar.unpacked. Always prefer the unpacked variant when it exists,
// because Electron's asar interception lets fs.readFile see asar-internal
// files, but child_process.spawn (used by fluent-ffmpeg) bypasses asar and
// can only execute real files on disk. Returning the unpacked path works
// transparently for both cases.
function resolveUnpacked(p) {
  if (!p) return null;
  if (p.includes("app.asar") && !p.includes("app.asar.unpacked")) {
    const unpacked = p.replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep);
    if (existsSync(unpacked)) return unpacked;
    // Fallback for path separator mismatches across platforms.
    const unpackedAlt = p.replace("app.asar", "app.asar.unpacked");
    if (existsSync(unpackedAlt)) return unpackedAlt;
  }
  if (existsSync(p)) return p;
  return p;
}
// Set ffmpeg path for fluent-ffmpeg
const resolvedFfmpegPath = resolveUnpacked(ffmpegPath);
if (resolvedFfmpegPath) {
  ffmpeg.setFfmpegPath(resolvedFfmpegPath);
  console.log("[TTS Worker] ffmpeg path:", resolvedFfmpegPath);
} else {
  console.warn("[TTS Worker] ffmpeg-static binary not found; speed != 1 and mp3 export will fail");
}
const MODEL_CONTEXT_WINDOW = 512;
const SAMPLE_RATE = 24000;
// Look-ahead sizes per acceleration mode for streaming processing
// Lower look-ahead = fewer chunks pre-committed to inference before the epoch
// check runs between chunks, so a cancelled job bails after ~1 chunk of waste.
const LOOK_AHEAD_SIZES = {
  cpu: 1,
  coreml: 2,
};
// Models directory - embedded in the app, asarUnpack'd by electron-builder.
const MODELS_DIR =
  resolveUnpacked(path.join(__dirname, "models")) ?? path.join(__dirname, "models");
const isPackaged = __dirname.includes("app.asar");
console.log("[TTS Worker] __dirname:", __dirname);
console.log("[TTS Worker] isPackaged:", isPackaged);
console.log("[TTS Worker] MODELS_DIR:", MODELS_DIR);
// Keep ONNX session alive between requests for performance
let cachedSession = null;
let cachedModelId = null;
// Current request ID for progress messages
let currentRequestId = null;
// Requests cancelled by the main process (client disconnected mid-stream). The
// generate loop checks this and stops scheduling new chunks, so abandoned clicks
// don't keep the worker busy.
const cancelledRequests = new Set();
let activeJobs = 0;
// Shared epoch from the main process. When it no longer equals a job's epoch,
// that job has been superseded (newer request) or its client disconnected, and
// it should bail at the next chunk boundary. Read synchronously so it works even
// while ONNX inference is blocking the worker thread (a postMessage can't land).
const epochView = workerData?.epochBuffer ? new Int32Array(workerData.epochBuffer) : null;
function epochStale(myEpoch) {
  return epochView != null && myEpoch !== 0 && Atomics.load(epochView, 0) !== myEpoch;
}
// Shutdown flag to abort ongoing work
let isShuttingDown = false;
// Tokenizer vocab - all keys must be properly quoted strings
const vocab = {
  ";": 1,
  ":": 2,
  ",": 3,
  ".": 4,
  "!": 5,
  "?": 6,
  "\u2014": 9, // —
  "\u2026": 10, // …
  '"': 11,
  "(": 12,
  ")": 13,
  "\u201C": 14, // "
  "\u201D": 15, // "
  " ": 16,
  "\u0303": 17,
  "\u02A3": 18, // ʣ
  "\u02A5": 19, // ʥ
  "\u02A6": 20, // ʦ
  "\u02A8": 21, // ʨ
  "\u1D5D": 22, // ᵝ
  "\uAB67": 23,
  A: 24,
  I: 25,
  O: 31,
  Q: 33,
  S: 35,
  T: 36,
  W: 39,
  Y: 41,
  "\u1D4A": 42, // ᵊ
  a: 43,
  b: 44,
  c: 45,
  d: 46,
  e: 47,
  f: 48,
  h: 50,
  i: 51,
  j: 52,
  k: 53,
  l: 54,
  m: 55,
  n: 56,
  o: 57,
  p: 58,
  q: 59,
  r: 60,
  s: 61,
  t: 62,
  u: 63,
  v: 64,
  w: 65,
  x: 66,
  y: 67,
  z: 68,
  "\u0251": 69, // ɑ
  "\u0250": 70, // ɐ
  "\u0252": 71, // ɒ
  "\u00E6": 72, // æ
  "\u03B2": 75, // β
  "\u0254": 76, // ɔ
  "\u0255": 77, // ɕ
  "\u00E7": 78, // ç
  "\u0256": 80, // ɖ
  "\u00F0": 81, // ð
  "\u02A4": 82, // ʤ
  "\u0259": 83, // ə
  "\u025A": 85, // ɚ
  "\u025B": 86, // ɛ
  "\u025C": 87, // ɜ
  "\u025F": 90, // ɟ
  "\u0261": 92, // ɡ
  "\u0265": 99, // ɥ
  "\u0268": 101, // ɨ
  "\u026A": 102, // ɪ
  "\u029D": 103, // ʝ
  "\u026F": 110, // ɯ
  "\u0270": 111, // ɰ
  "\u014B": 112, // ŋ
  "\u0273": 113, // ɳ
  "\u0272": 114, // ɲ
  "\u0274": 115, // ɴ
  "\u00F8": 116, // ø
  "\u0278": 118, // ɸ
  "\u03B8": 119, // θ
  "\u0153": 120, // œ
  "\u0279": 123, // ɹ
  "\u027E": 125, // ɾ
  "\u027B": 126, // ɻ
  "\u0281": 128, // ʁ
  "\u027D": 129, // ɽ
  "\u0282": 130, // ʂ
  "\u0283": 131, // ʃ
  "\u0288": 132, // ʈ
  "\u02A7": 133, // ʧ
  "\u028A": 135, // ʊ
  "\u028B": 136, // ʋ
  "\u028C": 138, // ʌ
  "\u0263": 139, // ɣ
  "\u0264": 140, // ɤ
  "\u03C7": 142, // χ
  "\u028E": 143, // ʎ
  "\u0292": 147, // ʒ
  "\u0294": 148, // ʔ
  "\u02C8": 156, // ˈ
  "\u02CC": 157, // ˌ
  "\u02D0": 158, // ː
  "\u02B0": 162, // ʰ
  "\u02B2": 164, // ʲ
  "\u2193": 169, // ↓
  "\u2192": 171, // →
  "\u2197": 172, // ↗
  "\u2198": 173, // ↘
  "\u1D7B": 177, // ᵻ
};
// Language mapping for espeak-ng
const langsMap = {
  "en-us": "en-us",
  "en-gb": "en-gb",
  ja: "ja",
  cmn: "cmn",
  "es-419": "es-419",
  hi: "hi",
  it: "it",
  "pt-br": "pt-br",
};
function tokenize(phonemes) {
  const fallback_char = 16;
  return [...phonemes].map((char) => vocab[char] || fallback_char);
}
async function getModel(_id) {
  // Only model_q8f16 is embedded
  const modelPath = path.join(MODELS_DIR, "model_q8f16.onnx");
  const data = await fs.readFile(modelPath);
  console.log("Loaded embedded model:", modelPath);
  return new Uint8Array(data).buffer;
}
async function getVoiceFile(id) {
  const voicePath = path.join(MODELS_DIR, `${id}.bin`);
  const data = await fs.readFile(voicePath);
  console.log("Loaded embedded voice:", voicePath);
  return new Uint8Array(data).buffer;
}
const voiceCache = new Map();
async function getShapedVoiceFile(id) {
  const cached = voiceCache.get(id);
  if (cached) return cached;
  const voice = await getVoiceFile(id);
  const voiceArray = new Float32Array(voice);
  const voiceArrayLen = voiceArray.length;
  const reshaped = [];
  for (let from = 0; from < voiceArray.length; from += 256) {
    const to = Math.min(from + 256, voiceArrayLen);
    const chunk = Array.from(voiceArray.slice(from, to));
    reshaped.push([chunk]);
  }
  voiceCache.set(id, reshaped);
  return reshaped;
}
function parseVoiceFormula(formula) {
  formula = formula.replace(/\s+/g, "");
  if (formula === "") {
    throw new Error("Voice or voice formula cannot be empty");
  }
  const allowedChars = /^[A-Za-z0-9\-_.*+]+$/;
  if (!allowedChars.test(formula)) {
    throw new Error("Invalid formula characters");
  }
  const terms = formula.split("+").filter((term) => term !== "");
  if (terms.length === 1 && !terms[0].includes("*")) {
    return [{ voiceId: terms[0], weight: 1 }];
  }
  const voices = [];
  for (const term of terms) {
    if (!term.includes("*")) {
      throw new Error(`Term "${term}" must contain asterisk`);
    }
    const parts = term.split("*");
    if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
      throw new Error(`Term "${term}" format incorrect`);
    }
    const voiceId = parts[0];
    let weight = parseFloat(parts[1]);
    if (isNaN(weight) || weight < 0 || weight > 1) {
      throw new Error(`Invalid weight for voice "${voiceId}"`);
    }
    weight = Math.round(weight * 10) / 10;
    voices.push({ voiceId, weight });
  }
  const totalWeight = voices.reduce((sum, v) => sum + v.weight, 0);
  if (Math.round(totalWeight * 10) / 10 !== 1) {
    throw new Error(`Weights must sum to 1, got ${totalWeight}`);
  }
  return voices;
}
async function combineVoices(voices) {
  if (voices.length === 0) {
    throw new Error("You must select at least one voice");
  }
  const voiceArrays = await Promise.all(voices.map((v) => getShapedVoiceFile(v.voiceId)));
  const baseChunks = voiceArrays[0].length;
  const baseInner = voiceArrays[0][0].length;
  const baseLength = voiceArrays[0][0][0].length;
  const combinedVoice = [];
  for (let i = 0; i < baseChunks; i++) {
    combinedVoice[i] = [];
    for (let j = 0; j < baseInner; j++) {
      combinedVoice[i][j] = new Array(baseLength).fill(0);
    }
  }
  for (let v = 0; v < voiceArrays.length; v++) {
    const weight = voices[v].weight;
    const voice = voiceArrays[v];
    for (let i = 0; i < baseChunks; i++) {
      for (let j = 0; j < baseInner; j++) {
        for (let k = 0; k < baseLength; k++) {
          combinedVoice[i][j][k] += weight * voice[i][j][k];
        }
      }
    }
  }
  return combinedVoice;
}
function normalizeText(text) {
  return text
    .replaceAll("\u2018", "'") // '
    .replaceAll("\u2019", "'") // '
    .replaceAll("\u00AB", "(") // «
    .replaceAll("\u00BB", ")") // »
    .replaceAll("\u201C", '"') // "
    .replaceAll("\u201D", '"') // "
    .replace(/\u3001/g, ", ") // 、
    .replace(/\u3002/g, ". ") // 。
    .replace(/\uFF01/g, "! ") // ！
    .replace(/\uFF0C/g, ", ") // ，
    .replace(/\uFF1A/g, ": ") // ：
    .replace(/\uFF1B/g, "; ") // ；
    .replace(/\uFF1F/g, "? ") // ？
    .replaceAll("\n", "  ")
    .replaceAll("\t", "  ")
    .trim();
}
async function phonemize(text, langId) {
  const lang = langsMap[langId] || "en-us";
  text = normalizeText(text);
  const espeakArgs = ["--phonout", "generated", "-q", "--ipa", "-v", lang, text];
  const espeak = await ESpeakNg({
    arguments: espeakArgs,
  });
  const generated = espeak.FS.readFile("generated", { encoding: "utf8" });
  return generated.split("\n").join(" ").trim();
}
const BATCH_SEPARATOR = " — ";
const BATCH_SEPARATOR_PHONEME = "—";
async function phonemizeBatch(texts, langId) {
  if (texts.length === 0) return [];
  if (texts.length === 1) return [await phonemize(texts[0], langId)];
  const lang = langsMap[langId] || "en-us";
  const joined = texts.map((t) => normalizeText(t)).join(BATCH_SEPARATOR);
  const espeakArgs = ["--phonout", "generated", "-q", "--ipa", "-v", lang, joined];
  const espeak = await ESpeakNg({ arguments: espeakArgs });
  const generated = espeak.FS.readFile("generated", { encoding: "utf8" });
  const fullPhonemes = generated.split("\n").join(" ").trim();
  const parts = fullPhonemes.split(BATCH_SEPARATOR_PHONEME);
  if (parts.length === texts.length) {
    return parts.map((p) => p.trim());
  }
  // Fallback: if separator didn't split cleanly, phonemize individually
  return Promise.all(texts.map((t) => phonemize(t, langId)));
}
function sanitizeText(rawText) {
  return rawText
    .replace(/\.\s+/g, "[0.4s]")
    .replace(/,\s+/g, "[0.2s]")
    .replace(/;\s+/g, "[0.4s]")
    .replace(/:\s+/g, "[0.3s]")
    .replace(/!\s+/g, "![0.1s]")
    .replace(/\?\s+/g, "?[0.1s]")
    .replace(/\n+/g, "[0.4s]")
    .trim();
}
function segmentText(sanitizedText) {
  const regex = /(\[[0-9]+(?:\.[0-9]+)?s\])/g;
  return sanitizedText
    .split(regex)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}
function isSilenceMarker(segment) {
  return /^\[[0-9]+(?:\.[0-9]+)?s\]$/.test(segment.trim());
}
function extractSilenceDuration(marker) {
  const match = marker.trim().match(/^\[([0-9]+(?:\.[0-9]+)?)s\]$/);
  return match ? parseFloat(match[1]) : 0;
}
function createPhonemeSubChunks(phonemes, tokensPerChunk) {
  if (phonemes.length <= tokensPerChunk) return [phonemes];
  const chunks = [];
  let currentChunk = "";
  for (const phoneme of phonemes) {
    if (currentChunk.length >= tokensPerChunk) {
      chunks.push(currentChunk);
      currentChunk = "";
    }
    currentChunk += phoneme;
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  return chunks;
}
// Target token count for the very first chunk — smaller = faster first audio.
// ~15 tokens infers in ~500ms vs ~1100ms for 54 tokens.
const FIRST_CHUNK_TARGET_TOKENS = 15;
/**
 * Incrementally preprocesses text, yielding chunks as each segment is phonemized.
 * This allows inference to start on the first chunk while later segments are still
 * being phonemized — eliminating the upfront preprocessing wall for long text.
 *
 * Strategy:
 * 1. Phonemize the first text segment alone (fast, single espeak call)
 * 2. Split it into a small initial chunk for minimum time-to-first-audio
 *    (only when there are multiple segments — short text plays without splitting)
 * 3. Batch-phonemize all remaining segments in one espeak call (amortizes WASM startup)
 */
async function* preprocessTextStreaming(text, lang, tokensPerChunk) {
  const sanitized = sanitizeText(text);
  const segments = segmentText(sanitized);
  // Count text segments to decide whether to split the first chunk
  const textSegments = segments.filter((s) => !isSilenceMarker(s));
  const shouldSplitFirst = textSegments.length > 1;
  let isFirst = true;
  let firstTextSegmentDone = false;
  const remainingTextSegments = [];
  for (const segment of segments) {
    if (isSilenceMarker(segment)) {
      if (firstTextSegmentDone) {
        remainingTextSegments.push(`__SILENCE__${extractSilenceDuration(segment)}`);
      } else {
        yield { type: "silence", durationSeconds: extractSilenceDuration(segment) };
      }
      continue;
    }
    if (!firstTextSegmentDone) {
      const phonemized = await phonemize(segment, lang);
      const phonemizedChunks = createPhonemeSubChunks(phonemized, tokensPerChunk);
      for (const phonemeChunk of phonemizedChunks) {
        const tokens = tokenize(phonemeChunk);
        if (isFirst && shouldSplitFirst && tokens.length > FIRST_CHUNK_TARGET_TOKENS) {
          isFirst = false;
          const splitAt = FIRST_CHUNK_TARGET_TOKENS;
          yield {
            type: "text",
            content: phonemeChunk.slice(0, splitAt),
            tokens: tokens.slice(0, splitAt),
          };
          const restTokens = tokens.slice(splitAt);
          if (restTokens.length > 0) {
            yield { type: "text", content: phonemeChunk.slice(splitAt), tokens: restTokens };
          }
        } else {
          isFirst = false;
          yield { type: "text", content: phonemeChunk, tokens };
        }
      }
      firstTextSegmentDone = true;
    } else {
      remainingTextSegments.push(segment);
    }
  }
  // Batch-phonemize all remaining text segments in a single espeak call
  if (remainingTextSegments.length > 0) {
    const textOnly = remainingTextSegments.filter((s) => !s.startsWith("__SILENCE__"));
    const phonemizedBatch = textOnly.length > 0 ? await phonemizeBatch(textOnly, lang) : [];
    let phonemeIdx = 0;
    for (const segment of remainingTextSegments) {
      if (segment.startsWith("__SILENCE__")) {
        const dur = parseFloat(segment.slice("__SILENCE__".length));
        yield { type: "silence", durationSeconds: dur };
        continue;
      }
      const phonemized = phonemizedBatch[phonemeIdx++];
      const phonemizedChunks = createPhonemeSubChunks(phonemized, tokensPerChunk);
      for (const phonemeChunk of phonemizedChunks) {
        const tokens = tokenize(phonemeChunk);
        yield { type: "text", content: phonemeChunk, tokens };
      }
    }
  }
}
function trimWaveform(waveform) {
  const windowSize = 256;
  const bufferSamples = 256;
  const numWindows = Math.ceil(waveform.length / windowSize);
  const windowAmplitudes = new Float32Array(numWindows);
  let maxWindowAmp = 0;
  for (let i = 0; i < numWindows; i++) {
    const start = i * windowSize;
    const end = Math.min(start + windowSize, waveform.length);
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += Math.abs(waveform[j]);
    }
    const avg = sum / (end - start);
    windowAmplitudes[i] = avg;
    if (avg > maxWindowAmp) maxWindowAmp = avg;
  }
  const threshold = maxWindowAmp * 0.05;
  let startSample = 0;
  for (let i = 0; i < numWindows; i++) {
    if (windowAmplitudes[i] > threshold) {
      const winStart = i * windowSize;
      const winEnd = Math.min(winStart + windowSize, waveform.length);
      for (let j = winStart; j < winEnd; j++) {
        if (Math.abs(waveform[j]) > threshold) {
          startSample = j;
          break;
        }
      }
      break;
    }
  }
  let endSample = waveform.length;
  for (let i = numWindows - 1; i >= 0; i--) {
    if (windowAmplitudes[i] > threshold) {
      const winStart = i * windowSize;
      const winEnd = Math.min(winStart + windowSize, waveform.length);
      for (let j = winEnd - 1; j >= winStart; j--) {
        if (Math.abs(waveform[j]) > threshold) {
          endSample = j + 1;
          break;
        }
      }
      break;
    }
  }
  startSample = Math.max(0, startSample - bufferSamples);
  endSample = Math.min(waveform.length, endSample + bufferSamples);
  return waveform.slice(startSample, endSample);
}
// createWavBuffer, buildAtempoChain, modifyWavSpeed, wavToMp3 are imported from shared-audio.ts
async function generateVoice(params, requestId) {
  if (params.speed < 0.1 || params.speed > 5) {
    throw new Error("Speed must be between 0.1 and 5");
  }
  const myEpoch = params.epoch ?? 0;
  const isCancelled = () => epochStale(myEpoch) || cancelledRequests.has(requestId);
  const tokensPerChunk = MODEL_CONTEXT_WINDOW - 2;
  const genStart = Date.now();
  // Get or create ONNX session (do this first so it's ready when chunks arrive)
  let session;
  if (cachedSession && cachedModelId === params.model) {
    session = cachedSession;
  } else {
    const modelBuffer = await getModel(params.model);
    // Configure execution providers for GPU acceleration
    const executionProviders = [];
    if (params.acceleration === "coreml") {
      executionProviders.push("coreml");
    }
    executionProviders.push("cpu");
    session = await ort.InferenceSession.create(Buffer.from(modelBuffer), {
      executionProviders,
      graphOptimizationLevel: "all",
      enableCpuMemArena: true,
    });
    cachedSession = session;
    cachedModelId = params.model;
  }
  const voices = parseVoiceFormula(params.voiceFormula);
  const combinedVoice = await combineVoices(voices);
  const lookAhead = LOOK_AHEAD_SIZES[params.acceleration] || 3;
  const preparedChunks = [];
  let preprocessDone = false;
  let totalChunks = 0; // updated as we discover chunks
  // Kick off streaming preprocess in the background
  const preprocessPromise = (async () => {
    const stream = preprocessTextStreaming(params.text, params.lang, tokensPerChunk);
    for await (const chunk of stream) {
      if (isCancelled()) break;
      if (chunk.type === "silence") {
        const silenceLength = Math.floor(chunk.durationSeconds * SAMPLE_RATE);
        preparedChunks.push({
          originalIndex: preparedChunks.length,
          type: "silence",
          silenceLength,
        });
      } else if (chunk.type === "text") {
        const tokensLength = chunk.tokens?.length ?? 0;
        if (tokensLength < 1) continue;
        preparedChunks.push({
          originalIndex: preparedChunks.length,
          type: "text",
          tokens: chunk.tokens,
        });
      }
      totalChunks = preparedChunks.length;
      // Wake up the inference loop whenever a new chunk is available
      wakeInference();
    }
    preprocessDone = true;
    console.log(
      `[Worker] preprocess (${requestId.slice(0, 8)}): ${preparedChunks.length} chunks in ${Date.now() - genStart}ms`
    );
    wakeInference();
  })();
  // Signaling mechanism to wake the inference loop when new chunks arrive
  let wakeResolve = null;
  function wakeInference() {
    if (wakeResolve) {
      wakeResolve();
      wakeResolve = null;
    }
  }
  function waitForChunks() {
    return new Promise((resolve) => {
      wakeResolve = resolve;
    });
  }
  // Results array (grows dynamically as totalChunks increases)
  const results = [];
  const completed = [];
  let nextToYield = 0;
  let nextToStart = 0;
  let completedCount = 0;
  // In-flight promises
  const inFlight = new Map();
  // Process a single chunk
  const processChunk = async (chunkIdx) => {
    const prepared = preparedChunks[chunkIdx];
    if (isCancelled()) {
      return { index: chunkIdx, waveform: new Float32Array(0) };
    }
    if (prepared.type === "silence") {
      return { index: chunkIdx, waveform: new Float32Array(prepared.silenceLength) };
    }
    const tokens = prepared.tokens;
    const ref_s = combinedVoice[tokens.length - 1][0];
    const paddedTokens = [0, ...tokens, 0];
    const input_ids = new ort.Tensor("int64", BigInt64Array.from(paddedTokens.map(BigInt)), [
      1,
      paddedTokens.length,
    ]);
    const style = new ort.Tensor("float32", new Float32Array(ref_s), [1, ref_s.length]);
    const speed = new ort.Tensor("float32", [1], [1]);
    const inferStart = Date.now();
    const result = await session.run({ input_ids, style, speed });
    let waveform = result.waveform.data;
    waveform = trimWaveform(waveform);
    console.log(
      `[Worker] chunk ${chunkIdx} infer ${Date.now() - inferStart}ms (t+${Date.now() - genStart}ms since gen start)`
    );
    return { index: chunkIdx, waveform };
  };
  // Yield consecutive completed chunks in order
  const yieldReadyChunks = () => {
    if (isCancelled()) return;
    // Use the current known totalChunks for reporting; final value is set when preprocess finishes
    const reportTotal = preprocessDone ? totalChunks : 0;
    while (nextToYield < totalChunks && completed[nextToYield]) {
      const waveform = results[nextToYield];
      const wavBuffer = createWavBuffer(waveform, SAMPLE_RATE);
      const base64 = Buffer.from(wavBuffer).toString("base64");
      parentPort?.postMessage({
        requestId,
        type: "chunk",
        data: {
          chunkIndex: nextToYield,
          totalChunks: reportTotal || nextToYield + 1,
          base64,
          mimeType: "audio/wav",
        },
      });
      nextToYield++;
    }
  };
  // Fill look-ahead window from available prepared chunks
  const fillLookAhead = () => {
    if (isCancelled()) return;
    while (inFlight.size < lookAhead && nextToStart < preparedChunks.length) {
      const chunkIdx = nextToStart;
      nextToStart++;
      // Ensure results arrays are large enough
      while (results.length <= chunkIdx) {
        results.push(new Float32Array(0));
        completed.push(false);
      }
      const promise = processChunk(chunkIdx);
      inFlight.set(chunkIdx, promise);
      promise.then((result) => {
        results[result.index] = result.waveform;
        completed[result.index] = true;
        completedCount++;
        inFlight.delete(result.index);
        parentPort?.postMessage({
          requestId,
          type: "progress",
          data: {
            stage: "inference",
            completed: completedCount,
            total: totalChunks || completedCount,
            percent: totalChunks ? Math.round((completedCount / totalChunks) * 100) : 0,
          },
        });
        yieldReadyChunks();
        fillLookAhead();
      });
    }
  };
  // Main inference loop: consumes chunks as they're produced by the preprocessor
  fillLookAhead();
  while (true) {
    if (isShuttingDown) {
      throw new Error("Aborted due to shutdown");
    }
    if (isCancelled()) break;
    // Are we done? All chunks preprocessed and all completed
    if (preprocessDone && completedCount >= totalChunks) break;
    // Try to fill look-ahead (new chunks may have arrived from preprocessor)
    fillLookAhead();
    // Wait for either inference completion or new chunks from preprocessor
    if (inFlight.size > 0) {
      await Promise.race([...inFlight.values(), waitForChunks()]);
    } else if (!preprocessDone) {
      await waitForChunks();
    } else {
      break;
    }
  }
  // Wait for preprocess to fully finish (it should be done by now)
  await preprocessPromise;
  if (isCancelled()) {
    return {
      buffer: createWavBuffer(new Float32Array(0), SAMPLE_RATE),
      mimeType: params.format === "mp3" ? "audio/mpeg" : "audio/wav",
    };
  }
  // Final yield
  yieldReadyChunks();
  // Concatenate all waveforms for the final result
  const waveformsLen = results.reduce((sum, w) => sum + w.length, 0);
  const finalWaveform = new Float32Array(waveformsLen);
  let offset = 0;
  for (const waveform of results) {
    finalWaveform.set(waveform, offset);
    offset += waveform.length;
  }
  let wavBuffer = createWavBuffer(finalWaveform, SAMPLE_RATE);
  if (params.speed !== 1) {
    wavBuffer = await modifyWavSpeed(wavBuffer, params.speed);
  }
  if (params.format === "wav") {
    return { buffer: wavBuffer, mimeType: "audio/wav" };
  }
  return { buffer: await wavToMp3(wavBuffer), mimeType: "audio/mpeg" };
}
// Cleanup function for graceful shutdown
async function cleanup() {
  console.log("[Worker] Cleaning up...");
  // Release ONNX session (Kokoro)
  if (cachedSession) {
    try {
      await cachedSession.release();
      console.log("[Worker] ONNX session released");
    } catch (e) {
      // Ignore errors during cleanup
    }
    cachedSession = null;
    cachedModelId = null;
  }
}
// Handle messages from main process
parentPort?.on("message", async (message) => {
  const { type, requestId, data } = message;
  if (type === "shutdown") {
    console.log("[Worker] Shutdown requested");
    isShuttingDown = true;
    await cleanup();
    parentPort?.postMessage({ type: "shutdown_complete" });
    return;
  }
  if (type === "preload") {
    if (isShuttingDown) return;
    try {
      console.log("Preloading model:", data.model);
      const modelBuffer = await getModel(data.model);
      if (!cachedSession || cachedModelId !== data.model) {
        const session = await ort.InferenceSession.create(Buffer.from(modelBuffer), {
          executionProviders: ["cpu"],
          graphOptimizationLevel: "all",
          enableCpuMemArena: true,
        });
        cachedSession = session;
        cachedModelId = data.model;
        // Run a realistic-size dummy inference to warm up ONNX internal allocators.
        // Uses a full-context-window token sequence so that all internal buffers
        // are allocated at their max size — subsequent inferences hit no new allocs.
        const warmupLen = MODEL_CONTEXT_WINDOW;
        const dummyTokens = [0, ...Array(warmupLen - 2).fill(16), 0];
        const input_ids = new ort.Tensor("int64", BigInt64Array.from(dummyTokens.map(BigInt)), [
          1,
          warmupLen,
        ]);
        const voices = await getShapedVoiceFile("af_heart");
        const ref_s = voices[Math.min(warmupLen - 3, voices.length - 1)][0];
        const style = new ort.Tensor("float32", new Float32Array(ref_s), [1, ref_s.length]);
        const speed = new ort.Tensor("float32", [1], [1]);
        await session.run({ input_ids, style, speed });
        console.log("Model session warmed up");
      }
      console.log("Model preloaded successfully");
    } catch (error) {
      console.error("Failed to preload model:", error);
    }
    return;
  }
  if (type === "cancel") {
    if (requestId) {
      cancelledRequests.add(requestId);
      console.log(`[Worker] cancel (${requestId.slice(0, 8)})`);
    }
    return;
  }
  if (type === "generate") {
    if (isShuttingDown) {
      parentPort?.postMessage({
        requestId,
        type: "error",
        error: "Worker is shutting down",
      });
      return;
    }
    // Store requestId for progress messages
    currentRequestId = requestId;
    activeJobs++;
    const startedAt = Date.now();
    console.log(`[Worker] generate start (${requestId.slice(0, 8)}) active=${activeJobs}`);
    try {
      const result = await generateVoice(data, requestId);
      // Check if we were interrupted (shutdown, supersede, or client disconnect).
      const reqEpoch = (data && data.epoch) || 0;
      if (isShuttingDown || cancelledRequests.has(requestId) || epochStale(reqEpoch)) {
        console.log(`[Worker] generate cancelled (${requestId.slice(0, 8)})`);
        // Tell main we actually stopped, so it can release the job slot and
        // resolve the pending request. Without this, workerBusy would hang.
        parentPort?.postMessage({ requestId, type: "cancelled" });
        return;
      }
      // Convert ArrayBuffer to base64 for IPC transfer
      const buffer = Buffer.from(result.buffer);
      const base64 = buffer.toString("base64");
      parentPort?.postMessage({
        requestId,
        type: "result",
        data: {
          base64,
          mimeType: result.mimeType,
        },
      });
      console.log(
        `[Worker] generate done (${requestId.slice(0, 8)}) in ${Date.now() - startedAt}ms`
      );
    } catch (error) {
      // Log full error to the worker's stderr so it surfaces in the Electron
      // main-process console — crucial for diagnosing platform-specific bugs
      // that only repro in packaged builds.
      console.error("[TTS Worker] generate failed:", error);
      if (!isShuttingDown) {
        const message = error?.message || String(error);
        const stack = error?.stack || "";
        parentPort?.postMessage({
          requestId,
          type: "error",
          error: message,
          stack,
          platform: process.platform,
          arch: process.arch,
        });
      }
    } finally {
      currentRequestId = null;
      cancelledRequests.delete(requestId);
      activeJobs = Math.max(0, activeJobs - 1);
    }
  }
});
console.log("TTS Worker initialized");
