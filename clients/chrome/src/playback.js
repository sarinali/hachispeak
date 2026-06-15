// Playback control
//
// One owner of "the current utterance":
// - A single reused StreamingAudioPlayer (one AudioContext, not recreated per play).
// - A monotonic `playGeneration`. Starting a new utterance increments it; every
//   player callback early-returns if its generation is no longer current, so stale
//   onEnd/cache/UI callbacks from an aborted utterance become no-ops.
//
// Clicks => play() (always replace). The sidebar Play button => togglePlayback()
// (pause/resume if active, else play). Voice/language change mid-read =>
// resumeWithVoice() (abort + re-synthesize the remaining sentences).

let player = null; // single StreamingAudioPlayer, reused across utterances
let audio = null; // <audio> element for the blocking 404 fallback only
let isPlaying = false;
let isPaused = false;
let playGeneration = 0; // bumps on every new utterance / stop; guards stale callbacks
let currentText = ""; // text of the current utterance (for resume-from-position)
let currentTextStart = 0; // UTF-16 offset into currentText where the playing chunk starts
let playStartedAt = 0; // performance.now() when the current play() kicked off (for latency logging)
let cachedAudio = { text: "", voice: "", chunks: [], textRanges: [] };

function getPlayer() {
  if (!player) player = new StreamingAudioPlayer();
  return player;
}

function createPlayerCallbacks(ui, gen) {
  return {
    onStart: () => {
      if (gen !== playGeneration) {
        olog(`drop stale onStart #${gen} (current #${playGeneration})`);
        return;
      }
      olog(`first audio #${gen} in ${Math.round(performance.now() - playStartedAt)}ms`);
      isPlaying = true;
      isPaused = false;
      ui.updateUI();
      ui.playBtn.disabled = false;
    },
    onChunkChange: (idx, total, textStart, textEnd) => {
      if (gen !== playGeneration) return;
      currentTextStart = textStart;
      ui.updateHighlight();
    },
    onEnd: () => {
      if (gen !== playGeneration) {
        olog(`drop stale onEnd #${gen} (current #${playGeneration})`);
        return;
      }
      olog(`end #${gen} after ${Math.round(performance.now() - playStartedAt)}ms`);
      isPlaying = false;
      isPaused = false;
      ui.clearHighlight();
      ui.updateUI();
      ui.enableControls(true);
    },
    onError: () => {
      if (gen !== playGeneration) return;
      olog(`error #${gen}`);
      isPlaying = false;
      isPaused = false;
      ui.clearHighlight();
      ui.updateUI();
      ui.enableControls(true);
    },
  };
}

// Hard-stop the current pipeline: abort the fetch + stop scheduled audio sources.
// Synchronous (player.stop() is sync) and keeps the AudioContext for reuse.
// Does NOT bump the generation or touch UI — callers decide that.
function abortCurrent() {
  if (isPlaying || isPaused) olog(`abort (was playing=${isPlaying}, paused=${isPaused})`);
  player?.stop();
  if (audio) {
    audio.pause();
    URL.revokeObjectURL(audio.src);
    audio = null;
  }
  isPlaying = false;
  isPaused = false;
}

// The single entry point for "read this now" (always replaces what's playing).
async function play(ui, textArg) {
  const text = (textArg ?? ui.getText()).trim();

  const gen = ++playGeneration; // (1) claim a new generation; older ones now inert
  olog(`play #${gen} len=${text.length}`);
  abortCurrent(); // (2) kill the previous fetch + sound before scheduling new audio
  if (gen !== playGeneration) return; // (3) superseded already → bail
  if (!text) return;

  playStartedAt = performance.now();
  currentText = text;
  ui.playBtn.disabled = false;

  const canUseCache =
    cachedAudio.text === text &&
    cachedAudio.voice === settings.voice &&
    cachedAudio.chunks.length > 0;

  if (canUseCache) {
    await playCached(ui, gen);
    return;
  }

  if (!(await checkServer())) return;
  if (gen !== playGeneration) return; // superseded during the server check

  ui.playBtn.disabled = true;
  ui.enableControls(false);

  try {
    await playStream(ui, gen);
  } catch (e) {
    if (gen !== playGeneration) return;
    // Only fall back to whole-file synthesis if the stream endpoint is missing
    // (older server). Otherwise surface the error instead of silently degrading.
    if (e && /(\b|_)404\b/.test(String(e.message))) {
      try {
        await playBlocking(ui, gen);
      } catch (e2) {}
    } else {
      isPlaying = false;
      isPaused = false;
      ui.updateUI();
      ui.enableControls(true);
      ui.playBtn.disabled = !text;
      document.getElementById("download-banner")?.classList.remove("hidden");
    }
  }
}

// Play/pause toggle for the sidebar button. Pause/resume is NOT an abort — it
// suspends/resumes the same generation. With nothing active, starts fresh.
async function togglePlayback(ui) {
  if (isPaused && player) {
    await player.resume();
    isPaused = false;
    isPlaying = true;
    ui.updateUI();
    return;
  }

  if (isPlaying && player) {
    await player.pause();
    isPaused = true;
    isPlaying = false;
    ui.updateUI();
    return;
  }

  await play(ui);
}

async function playCached(ui, gen) {
  const p = getPlayer();
  p.setVolume(settings.volume / 100);
  p.setSpeed(settings.speed ?? 1);
  ui.playBtn.disabled = true;
  ui.enableControls(false);

  const cb = createPlayerCallbacks(ui, gen);
  p.onStart = cb.onStart;
  p.onChunkChange = cb.onChunkChange;
  p.onEnd = cb.onEnd;
  p.onError = cb.onError;

  await p.playCached(cachedAudio.chunks, cachedAudio.textRanges);
  if (gen === playGeneration) ui.playBtn.disabled = !ui.getText();
}

async function playStream(ui, gen) {
  const p = getPlayer();
  p.setVolume(settings.volume / 100);
  p.setSpeed(settings.speed ?? 1);

  const cb = createPlayerCallbacks(ui, gen);
  p.onStart = cb.onStart;
  p.onChunkChange = cb.onChunkChange;
  p.onEnd = () => {
    if (gen === playGeneration) {
      cachedAudio = {
        text: currentText,
        voice: settings.voice,
        chunks: p.getChunks(),
        textRanges: p.getChunkTextRanges(),
      };
    }
    cb.onEnd();
  };
  p.onError = cb.onError;

  // Speed is applied client-side (playbackRate); the server always renders at 1x.
  await p.playStreaming(`${SERVER_URL}/api/v1/audio/speech/stream`, {
    model: "model_q8f16",
    voice: settings.voice,
    input: currentText,
    speed: 1,
  });

  if (gen === playGeneration) ui.playBtn.disabled = !currentText;
}

async function playBlocking(ui, gen) {
  try {
    const blob = await fetchAudio(currentText, settings.voice, "mp3");
    if (gen !== playGeneration) return;
    const url = URL.createObjectURL(blob);

    audio = new Audio(url);
    audio.volume = settings.volume / 100;
    audio.playbackRate = settings.speed ?? 1;
    audio.onended = () => {
      if (gen !== playGeneration) return;
      isPlaying = false;
      ui.updateUI();
      ui.enableControls(true);
      URL.revokeObjectURL(url);
    };

    await audio.play();
    if (gen !== playGeneration) return;
    isPlaying = true;
    ui.updateUI();
  } catch (e) {
    ui.enableControls(true);
    document.getElementById("download-banner")?.classList.remove("hidden");
  } finally {
    if (gen === playGeneration) ui.playBtn.disabled = !currentText;
  }
}

// User-facing stop (Stop button / Esc): invalidate in-flight callbacks, abort,
// reset UI. Bumping the generation guarantees nothing resumes.
function stopPlayback(ui) {
  playGeneration++;
  currentTextStart = 0;
  abortCurrent();
  ui.clearHighlight();
  ui.updateUI();
  ui.enableControls(true);
}

// Voice/language changed mid-read: abort and re-synthesize the remaining
// sentences (from the current chunk) with the now-current voice.
async function resumeWithVoice(ui) {
  if (!isPlaying && !isPaused) return false;
  const remaining = currentTextStart > 0 ? currentText.slice(currentTextStart) : currentText;
  clearCache();
  await play(ui, remaining);
  return true;
}

function setSpeed(rate) {
  player?.setSpeed(rate);
}

function setVolume(vol) {
  player?.setVolume(vol);
  if (audio) audio.volume = vol;
}

function clearCache() {
  cachedAudio = { text: "", voice: "", chunks: [], textRanges: [] };
}

function hasCachedAudio() {
  return cachedAudio.chunks.length > 0;
}

function getCachedText() {
  return cachedAudio.text;
}
