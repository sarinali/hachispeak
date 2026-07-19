// Download Microsoft Visual C++ 2015-2022 Redistributable (x64).
// Bundled into the Windows installer via build-resources/installer.nsh so the
// onnxruntime-node native binary can load on fresh Windows installs.
//
// We don't commit the redist binary to git (it's 25 MB and changes shape every
// few months as Microsoft updates it). Instead, both local and CI Windows
// builds invoke this script before electron-builder runs.

import { existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET = resolve(__dirname, "..", "build-resources", "vc_redist.x64.exe");
const URL = "https://aka.ms/vs/17/release/vc_redist.x64.exe";

// Re-download if the existing file is suspiciously small (interrupted previous
// download, etc.). 10 MB floor — current redist is ~25 MB; anything below 10
// is definitely corrupt.
const MIN_SIZE = 10 * 1024 * 1024;

async function main() {
  if (existsSync(TARGET) && statSync(TARGET).size > MIN_SIZE) {
    console.log(`[vc-redist] already present at ${TARGET}, skipping download`);
    return;
  }

  console.log(`[vc-redist] downloading ${URL} -> ${TARGET}`);
  await mkdir(dirname(TARGET), { recursive: true });

  const res = await fetch(URL, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`download failed: HTTP ${res.status} ${res.statusText}`);
  }
  if (!res.body) throw new Error("download failed: empty response body");

  await pipeline(res.body, createWriteStream(TARGET));

  const finalSize = statSync(TARGET).size;
  if (finalSize < MIN_SIZE) {
    throw new Error(`downloaded file is only ${finalSize} bytes; expected > ${MIN_SIZE}`);
  }
  console.log(`[vc-redist] downloaded ${(finalSize / 1024 / 1024).toFixed(1)} MB`);
}

main().catch((err) => {
  console.error("[vc-redist] FAILED:", err.message);
  process.exit(1);
});
