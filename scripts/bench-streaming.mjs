#!/usr/bin/env node
/**
 * Streaming TTS latency benchmark.
 * Hits the real local Out Loud server and measures TTFA, RTF, and throughput
 * for various paragraph lengths, with median + p95 latencies.
 *
 * Standard metrics:
 *   TTFA  — Time to First Audio: ms until the first audio chunk arrives.
 *           Industry target: <300ms. Commercial APIs (ElevenLabs, Cartesia) cite this.
 *   RTF   — Real-Time Factor: synthesis_time / audio_duration.
 *           Lower is better; <1 means faster than real-time.
 *           Kokoro's own benchmark reports ~0.1x RTF on Apple Silicon (CoreML).
 *           Academic papers (StyleTTS2, Bark, Parler-TTS) all report RTF.
 *
 * Usage:
 *   node scripts/bench-streaming.mjs [--runs N] [--port PORT] [--voice VOICE] [--json]
 *
 * Requires the Electron app (or standalone server) running on localhost.
 */

import * as os from "os";

const BASE_PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--port") || "51730", 10);
const RUNS = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--runs") || "5", 10);
const VOICE = process.argv.find((_, i, a) => a[i - 1] === "--voice") || "af_heart";
const JSON_OUTPUT = process.argv.includes("--json");

const PARAGRAPHS = {
  short: "The quick brown fox jumps over the lazy dog.",
  medium:
    "The quick brown fox jumps over the lazy dog. It was a bright cold day in April, and the clocks were striking thirteen. Winston Smith, his chin nuzzled into his breast in an effort to escape the vile wind, slipped quickly through the glass doors of Victory Mansions.",
  long: "The quick brown fox jumps over the lazy dog. It was a bright cold day in April, and the clocks were striking thirteen. Winston Smith, his chin nuzzled into his breast in an effort to escape the vile wind, slipped quickly through the glass doors of Victory Mansions, though not quickly enough to prevent a swirl of gritty dust from entering along with him. The hallway smelt of boiled cabbage and old rag mats. At one end of it a coloured poster, too large for indoor display, had been tacked to the wall. It depicted simply an enormous face, more than a metre wide: the face of a man of about forty-five, with a heavy black moustache and ruggedly handsome features. Winston made for the stairs. It was no use trying the lift. Even at the best of times it was seldom working, and at present the electric current was cut off during daylight hours.",
};

async function checkServer() {
  try {
    const res = await fetch(`http://127.0.0.1:${BASE_PORT}/api/v1/audio/voices`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    return true;
  } catch {
    return false;
  }
}

async function getServerAcceleration() {
  try {
    const res = await fetch(`http://127.0.0.1:${BASE_PORT}/api/v1/info`);
    if (!res.ok) return "unknown";
    const data = await res.json();
    return data.acceleration ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Parse audio duration from a WAV buffer.
 * Scans for the 'data' chunk and divides its byte size by the byte rate.
 * Works for any PCM/float WAV regardless of fmt chunk size.
 */
function wavDurationMs(wavBuf) {
  // sample rate is at bytes 24-27 in the fmt chunk (standard WAV layout)
  const sampleRate = wavBuf.readUInt32LE(24);
  const blockAlign = wavBuf.readUInt16LE(32); // bytes per sample frame

  // Scan for 'data' sub-chunk marker
  for (let i = 12; i < wavBuf.length - 8; i++) {
    if (
      wavBuf[i] === 0x64 && // d
      wavBuf[i + 1] === 0x61 && // a
      wavBuf[i + 2] === 0x74 && // t
      wavBuf[i + 3] === 0x61 // a
    ) {
      const dataSize = wavBuf.readUInt32LE(i + 4);
      if (blockAlign === 0 || sampleRate === 0) return 0;
      return (dataSize / blockAlign / sampleRate) * 1000;
    }
  }
  return 0;
}

/**
 * Parse the chunked binary streaming response.
 * Each chunk: 12-byte header (chunkIndex u32le, totalChunks u32le, wavLen u32le) + WAV bytes.
 */
async function benchOne(text) {
  const t0 = performance.now();
  let firstChunkAt = 0;
  const chunkTimings = [];
  let totalAudioMs = 0;

  const res = await fetch(`http://127.0.0.1:${BASE_PORT}/api/v1/audio/speech/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ voice: VOICE, input: text, speed: 1 }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Server returned ${res.status}: ${body}`);
  }

  const reader = res.body.getReader();
  let buf = Buffer.alloc(0);
  let totalChunks = 0;
  let chunksReceived = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buf = Buffer.concat([buf, Buffer.from(value)]);

    // Parse as many complete chunks as available
    while (buf.length >= 12) {
      const wavLen = buf.readUInt32LE(8);
      const frameSize = 12 + wavLen;
      if (buf.length < frameSize) break;

      const chunkIndex = buf.readUInt32LE(0);
      totalChunks = buf.readUInt32LE(4);
      const now = performance.now();

      if (chunksReceived === 0) {
        firstChunkAt = now - t0;
      }

      const wavBuf = buf.subarray(12, frameSize);
      totalAudioMs += wavDurationMs(wavBuf);

      chunkTimings.push({ index: chunkIndex, elapsed: now - t0 });
      chunksReceived++;

      buf = buf.subarray(frameSize);
    }
  }

  const totalMs = performance.now() - t0;

  return {
    firstChunkMs: Math.round(firstChunkAt),
    totalMs: Math.round(totalMs),
    audioDurationMs: Math.round(totalAudioMs),
    // RTF = synthesis_time / audio_duration — the standard TTS metric
    rtf: totalAudioMs > 0 ? totalMs / totalAudioMs : null,
    chunks: chunksReceived,
    totalChunks,
    perChunkAvgMs:
      chunksReceived > 1 ? Math.round((totalMs - firstChunkAt) / (chunksReceived - 1)) : 0,
    chunkTimings,
  };
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function median(arr) {
  return percentile(arr, 50);
}

function systemInfo() {
  const cpus = os.cpus();
  const cpu = cpus[0]?.model?.trim() ?? "unknown";
  const cores = cpus.length;
  const memGb = (os.totalmem() / 1024 ** 3).toFixed(1);
  return { cpu, cores, memGb, platform: os.platform(), arch: os.arch() };
}

async function main() {
  const sys = systemInfo();

  const acceleration = await getServerAcceleration();

  if (!JSON_OUTPUT) {
    console.log(`\n📊 Out Loud Streaming TTS Benchmark`);
    console.log(`   Server:       http://127.0.0.1:${BASE_PORT}`);
    console.log(`   Voice:        ${VOICE}`);
    console.log(`   Runs:         ${RUNS} per paragraph`);
    console.log(`   Acceleration: ${acceleration}`);
    console.log(`   CPU:          ${sys.cpu} (${sys.cores} cores)`);
    console.log(`   Memory:       ${sys.memGb} GB`);
    console.log(`   Platform:     ${sys.platform}/${sys.arch}`);
    console.log(`\n   Metrics:`);
    console.log(`     TTFA — Time to First Audio (ms). Industry target: <300ms.`);
    console.log(
      `     RTF  — Real-Time Factor (synthesis_time / audio_duration). Lower is better; <1 = faster-than-realtime.\n`
    );
  }

  const alive = await checkServer();
  if (!alive) {
    console.error(`❌ Server not reachable at port ${BASE_PORT}. Start the app first.`);
    process.exit(1);
  }

  const allResults = {};

  for (const [label, text] of Object.entries(PARAGRAPHS)) {
    const words = text.split(/\s+/).length;

    if (!JSON_OUTPUT) {
      console.log(`─── ${label} (${words} words, ${text.length} chars) ───`);
    }

    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const r = await benchOne(text);
      runs.push(r);
      if (!JSON_OUTPUT) {
        const rtfStr = r.rtf != null ? `RTF ${r.rtf.toFixed(3)}` : "RTF n/a";
        console.log(
          `  run ${i + 1}: TTFA ${r.firstChunkMs}ms | total ${r.totalMs}ms | audio ${r.audioDurationMs}ms | ${rtfStr} | ${r.chunks} chunks`
        );
      }
    }

    const ttfaVals = runs.map((r) => r.firstChunkMs);
    const totalVals = runs.map((r) => r.totalMs);
    const rtfVals = runs.filter((r) => r.rtf != null).map((r) => r.rtf);
    const audioVals = runs.map((r) => r.audioDurationMs);

    const summary = {
      label,
      words,
      chars: text.length,
      ttfa: {
        p50: Math.round(median(ttfaVals)),
        p95: Math.round(percentile(ttfaVals, 95)),
      },
      total: {
        p50: Math.round(median(totalVals)),
        p95: Math.round(percentile(totalVals, 95)),
      },
      rtf: {
        p50: rtfVals.length > 0 ? parseFloat(median(rtfVals).toFixed(3)) : null,
        p95: rtfVals.length > 0 ? parseFloat(percentile(rtfVals, 95).toFixed(3)) : null,
      },
      audioDurationMs: Math.round(median(audioVals)),
      chunks: runs[0].chunks,
    };
    allResults[label] = summary;

    if (!JSON_OUTPUT) {
      console.log(
        `  → TTFA p50 ${summary.ttfa.p50}ms  p95 ${summary.ttfa.p95}ms | RTF p50 ${summary.rtf.p50 ?? "n/a"}  p95 ${summary.rtf.p95 ?? "n/a"}\n`
      );
    }
  }

  if (JSON_OUTPUT) {
    console.log(
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          system: sys,
          acceleration,
          voice: VOICE,
          runs: RUNS,
          results: allResults,
        },
        null,
        2
      )
    );
    return;
  }

  console.log(`\n═══ Summary ═══`);
  console.log(
    `${"Para".padEnd(8)} ${"Words".padStart(5)} ${"TTFA p50".padStart(9)} ${"TTFA p95".padStart(9)} ${"RTF p50".padStart(8)} ${"RTF p95".padStart(8)} ${"Audio(ms)".padStart(10)}`
  );
  console.log("─".repeat(65));
  for (const s of Object.values(allResults)) {
    console.log(
      `${s.label.padEnd(8)} ${String(s.words).padStart(5)} ${String(s.ttfa.p50 + "ms").padStart(9)} ${String(s.ttfa.p95 + "ms").padStart(9)} ${String(s.rtf.p50 ?? "n/a").padStart(8)} ${String(s.rtf.p95 ?? "n/a").padStart(8)} ${String(s.audioDurationMs + "ms").padStart(10)}`
    );
  }

  console.log(`\n   RTF < 1.0 means faster than real-time.`);
  console.log(`   Kokoro reference: ~0.1x RTF on Apple Silicon (CoreML), ~0.3x on CPU.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
