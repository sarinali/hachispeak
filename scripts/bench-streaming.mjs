#!/usr/bin/env node
/**
 * Streaming TTS latency benchmark.
 * Hits the real local Out Loud server and measures time-to-first-chunk,
 * per-chunk timing, and total duration for various paragraph lengths.
 *
 * Usage:
 *   node scripts/bench-streaming.mjs [--runs N] [--port PORT] [--voice VOICE]
 *
 * Requires the Electron app (or standalone server) running on localhost.
 */

const BASE_PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--port") || "51730", 10);
const RUNS = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--runs") || "3", 10);
const VOICE = process.argv.find((_, i, a) => a[i - 1] === "--voice") || "af_heart";

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

/**
 * Parse the chunked binary streaming response.
 * Each chunk: 12-byte header (chunkIndex u32le, totalChunks u32le, wavLen u32le) + WAV bytes.
 */
async function benchOne(text) {
  const t0 = performance.now();
  let firstChunkAt = 0;
  const chunkTimings = [];

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
      chunkTimings.push({ index: chunkIndex, elapsed: now - t0 });
      chunksReceived++;

      buf = buf.subarray(frameSize);
    }
  }

  const totalTime = performance.now() - t0;

  return {
    firstChunkMs: Math.round(firstChunkAt),
    totalMs: Math.round(totalTime),
    chunks: chunksReceived,
    totalChunks,
    perChunkAvgMs:
      chunksReceived > 1 ? Math.round((totalTime - firstChunkAt) / (chunksReceived - 1)) : 0,
    chunkTimings,
  };
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function main() {
  console.log(`\n📊 Out Loud Streaming TTS Benchmark`);
  console.log(`   Server: http://127.0.0.1:${BASE_PORT}`);
  console.log(`   Voice:  ${VOICE}`);
  console.log(`   Runs:   ${RUNS} per paragraph\n`);

  const alive = await checkServer();
  if (!alive) {
    console.error(`❌ Server not reachable at port ${BASE_PORT}. Start the app first.`);
    process.exit(1);
  }

  const results = {};

  for (const [label, text] of Object.entries(PARAGRAPHS)) {
    const words = text.split(/\s+/).length;
    console.log(`─── ${label} (${words} words, ${text.length} chars) ───`);

    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const r = await benchOne(text);
      runs.push(r);
      console.log(
        `  run ${i + 1}: first-chunk ${r.firstChunkMs}ms | total ${r.totalMs}ms | ${r.chunks} chunks | avg/chunk ${r.perChunkAvgMs}ms`
      );
    }

    const firstChunks = runs.map((r) => r.firstChunkMs);
    const totals = runs.map((r) => r.totalMs);

    const summary = {
      label,
      words,
      chars: text.length,
      medianFirstChunkMs: median(firstChunks),
      medianTotalMs: median(totals),
      chunks: runs[0].chunks,
    };
    results[label] = summary;

    console.log(
      `  → median first-chunk: ${summary.medianFirstChunkMs}ms | median total: ${summary.medianTotalMs}ms\n`
    );
  }

  console.log(`\n═══ Summary ═══`);
  console.log(
    `${"Para".padEnd(8)} ${"Words".padStart(6)} ${"1st chunk (ms)".padStart(15)} ${"Total (ms)".padStart(12)} ${"Chunks".padStart(7)}`
  );
  console.log("─".repeat(52));
  for (const s of Object.values(results)) {
    console.log(
      `${s.label.padEnd(8)} ${String(s.words).padStart(6)} ${String(s.medianFirstChunkMs).padStart(15)} ${String(s.medianTotalMs).padStart(12)} ${String(s.chunks).padStart(7)}`
    );
  }
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
