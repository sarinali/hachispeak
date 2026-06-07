import * as fs from "fs/promises";
import { existsSync } from "fs";
import * as path from "path";
import * as os from "os";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
// @ts-ignore
import wavefile from "wavefile";
const { WaveFile } = wavefile;
// ffmpeg-static returns a path inside app.asar in packaged builds; the binary
// itself is asarUnpack'd. fluent-ffmpeg spawns the binary via child_process,
// which bypasses Electron's asar layer, so we must resolve to the real
// app.asar.unpacked path or the spawn will fail with ENOENT.
function resolveFfmpegBinary(p) {
    if (!p)
        return null;
    if (p.includes("app.asar") && !p.includes("app.asar.unpacked")) {
        const unpacked = p.replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep);
        if (existsSync(unpacked))
            return unpacked;
        const unpackedAlt = p.replace("app.asar", "app.asar.unpacked");
        if (existsSync(unpackedAlt))
            return unpackedAlt;
    }
    if (existsSync(p))
        return p;
    return p;
}
const resolvedFfmpegPath = resolveFfmpegBinary(ffmpegPath);
if (resolvedFfmpegPath) {
    ffmpeg.setFfmpegPath(resolvedFfmpegPath);
}
export function createWavBuffer(waveform, sampleRate) {
    const wav = new WaveFile();
    wav.fromScratch(1, sampleRate, "32f", waveform);
    return wav.toBuffer().buffer;
}
export function buildAtempoChain(velocity) {
    if (velocity === 1)
        return "anull";
    const filters = [];
    let remaining = velocity;
    while (remaining < 0.5) {
        filters.push("atempo=0.5");
        remaining /= 0.5;
    }
    while (remaining > 2) {
        filters.push("atempo=2.0");
        remaining /= 2;
    }
    if (remaining !== 1) {
        filters.push(`atempo=${remaining}`);
    }
    return filters.length > 0 ? filters.join(",") : "anull";
}
export async function modifyWavSpeed(wavBuffer, velocity) {
    if (velocity === 1)
        return wavBuffer;
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `input-${crypto.randomUUID()}.wav`);
    const outputPath = path.join(tmpDir, `output-${crypto.randomUUID()}.wav`);
    await fs.writeFile(inputPath, Buffer.from(wavBuffer));
    const filter = buildAtempoChain(velocity);
    await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .output(outputPath)
            .noVideo()
            .audioFilters(filter)
            .on("end", () => resolve())
            .on("error", (err) => reject(err))
            .run();
    });
    const data = await fs.readFile(outputPath);
    fs.unlink(inputPath).catch(() => { });
    fs.unlink(outputPath).catch(() => { });
    return new Uint8Array(data).buffer;
}
export async function wavToMp3(wavBuffer) {
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `input-${crypto.randomUUID()}.wav`);
    const outputPath = path.join(tmpDir, `output-${crypto.randomUUID()}.mp3`);
    await fs.writeFile(inputPath, Buffer.from(wavBuffer));
    await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .audioBitrate("192k")
            .output(outputPath)
            .on("end", () => resolve())
            .on("error", (err) => reject(err))
            .run();
    });
    const data = await fs.readFile(outputPath);
    fs.unlink(inputPath).catch(() => { });
    fs.unlink(outputPath).catch(() => { });
    return new Uint8Array(data).buffer;
}
