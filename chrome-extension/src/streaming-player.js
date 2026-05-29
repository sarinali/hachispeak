// StreamingAudioPlayer - Web Audio API streaming player
// Plays audio chunks as they arrive with time-based chunk tracking

function concatArrays(a, b) {
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

class StreamingAudioPlayer {
  constructor() {
    this.audioContext = null;
    this.gainNode = null;
    this.scheduledSources = [];
    this.chunksReceived = 0;
    this.totalChunks = 0;
    this.isPlaying = false;
    this.isPaused = false;
    this.abortController = null;
    this.onProgress = null;
    this.onStart = null;
    this.onEnd = null;
    this.onError = null;
    this.onChunkChange = null;
    this.audioChunks = [];
    this.decodedBuffers = []; // decoded AudioBuffer per chunk, index-aligned with chunkTimings
    this.chunkSources = []; // scheduled source per chunk index (not spliced; used for speed reschedule)
    this.volume = 0.8;
    this.speed = 1;
    this.playbackStartTime = 0;
    this.scheduledEndTime = 0;
    this.chunkTimings = [];
    this.allChunksReceived = false;
    this.animationFrameId = null;
    this.lastReportedChunk = -1;
  }

  setVolume(vol) {
    this.volume = vol;
    if (this.gainNode) {
      this.gainNode.gain.value = vol;
    }
  }

  // Client-side speed: change playbackRate on sources. Applies instantly with no
  // re-synthesis. The currently-playing chunk finishes at the old rate; all
  // not-yet-started chunks are rescheduled from the current chunk's end using the
  // new rate, and future streamed chunks pick up this.speed automatically.
  setSpeed(rate) {
    this.speed = rate;
    if (!this.audioContext || !this.isPlaying || this.isPaused) return;

    const now = this.audioContext.currentTime;
    const curIdx = this.getCurrentChunkIndex(now);
    if (curIdx < 0 || !this.chunkTimings[curIdx]) return;

    let t = this.chunkTimings[curIdx].endTime; // resume scheduling after the current chunk
    for (let i = curIdx + 1; i < this.decodedBuffers.length; i++) {
      try {
        this.chunkSources[i]?.stop();
      } catch (e) {}
      const buf = this.decodedBuffers[i];
      if (!buf) continue;
      const source = this.createSource(buf);
      const dur = buf.duration / this.speed;
      source.start(t);
      this.chunkTimings[i] = { startTime: t, endTime: t + dur };
      this.chunkSources[i] = source;
      this.scheduledSources.push(source);
      t += dur;
    }
    this.scheduledEndTime = t;
  }

  getCurrentChunkIndex(currentTime) {
    for (let i = 0; i < this.chunkTimings.length; i++) {
      const t = this.chunkTimings[i];
      if (currentTime >= t.startTime && currentTime < t.endTime) {
        return i;
      }
    }
    if (this.chunkTimings.length > 0) {
      const last = this.chunkTimings[this.chunkTimings.length - 1];
      if (currentTime >= last.endTime) {
        return this.chunkTimings.length - 1;
      }
    }
    return -1;
  }

  updatePlayback = () => {
    if (!this.audioContext || this.playbackStartTime === 0) return;

    const now = this.audioContext.currentTime;
    const remaining = Math.max(0, this.scheduledEndTime - now);
    const currentChunk = this.getCurrentChunkIndex(now);

    if (currentChunk !== this.lastReportedChunk && currentChunk >= 0) {
      this.lastReportedChunk = currentChunk;
      if (this.onChunkChange) {
        this.onChunkChange(currentChunk, this.chunkTimings.length);
      }
    }

    if (remaining > 0.05 || !this.allChunksReceived) {
      this.animationFrameId = requestAnimationFrame(this.updatePlayback);
    }
  };

  async pause() {
    if (this.audioContext && this.isPlaying && !this.isPaused) {
      this.cancelAnimation();
      await this.audioContext.suspend();
      this.isPaused = true;
      return true;
    }
    return false;
  }

  async resume() {
    if (this.audioContext && this.isPaused) {
      await this.audioContext.resume();
      this.isPaused = false;
      this.animationFrameId = requestAnimationFrame(this.updatePlayback);
      return true;
    }
    return false;
  }

  async playCached(chunks) {
    this.cleanup(true);
    await this.initAudioContext();
    this.audioChunks = chunks;
    this.allChunksReceived = true;

    const BUFFER_TIME = 0.1;
    let scheduledEndTime = this.audioContext.currentTime + BUFFER_TIME;
    this.playbackStartTime = scheduledEndTime;

    for (const chunk of chunks) {
      try {
        const audioBuffer = await this.audioContext.decodeAudioData(chunk.slice(0));
        const source = this.createSource(audioBuffer);
        source.start(scheduledEndTime);

        const dur = audioBuffer.duration / this.speed;
        this.chunkTimings.push({
          startTime: scheduledEndTime,
          endTime: scheduledEndTime + dur,
        });

        scheduledEndTime += dur;
        this.scheduledSources.push(source);
        this.decodedBuffers.push(audioBuffer);
        this.chunkSources.push(source);
      } catch (e) {
        console.log("Error scheduling cached chunk:", e);
      }
    }

    this.scheduledEndTime = scheduledEndTime;
    this.isPlaying = true;
    this.isPaused = false;
    this.totalChunks = chunks.length;
    this.chunksReceived = chunks.length;

    if (this.onStart) this.onStart();

    this.animationFrameId = requestAnimationFrame(this.updatePlayback);

    await this.waitForPlaybackEnd();
    this.cancelAnimation();
    if (this.onEnd) this.onEnd();
  }

  getChunks() {
    return this.audioChunks;
  }

  async playStreaming(url, requestBody) {
    this.cleanup(true);
    await this.initAudioContext();
    this.allChunksReceived = false;

    const BUFFER_TIME = 0.1;
    this.isPlaying = true;
    this.isPaused = false;
    this.abortController = new AbortController();

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer x",
        },
        body: JSON.stringify(requestBody),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const reader = response.body.getReader();
      let buffer = new Uint8Array(0);
      let firstChunkScheduled = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer = concatArrays(buffer, value);

        while (buffer.length >= 12) {
          const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
          const chunkIndex = view.getUint32(0, true);
          const totalChunks = view.getUint32(4, true);
          const wavLength = view.getUint32(8, true);

          if (buffer.length < 12 + wavLength) break;

          const wavData = buffer.slice(12, 12 + wavLength);
          buffer = buffer.slice(12 + wavLength);

          this.totalChunks = totalChunks;
          this.chunksReceived = chunkIndex + 1;
          this.audioChunks.push(wavData.buffer.slice(0));

          try {
            const audioBuffer = await this.audioContext.decodeAudioData(wavData.buffer.slice(0));
            const source = this.createSource(audioBuffer);

            if (!firstChunkScheduled) {
              this.playbackStartTime = this.audioContext.currentTime + BUFFER_TIME;
              this.scheduledEndTime = this.playbackStartTime;
              firstChunkScheduled = true;
              if (this.onStart) this.onStart();
              this.animationFrameId = requestAnimationFrame(this.updatePlayback);
            }

            const now = this.audioContext.currentTime;
            if (this.scheduledEndTime < now) {
              this.scheduledEndTime = now + 0.01;
            }

            const dur = audioBuffer.duration / this.speed;
            this.chunkTimings.push({
              startTime: this.scheduledEndTime,
              endTime: this.scheduledEndTime + dur,
            });

            source.start(this.scheduledEndTime);
            this.scheduledEndTime += dur;
            this.scheduledSources.push(source);
            this.decodedBuffers.push(audioBuffer);
            this.chunkSources.push(source);

            source.onended = () => {
              const index = this.scheduledSources.indexOf(source);
              if (index > -1) this.scheduledSources.splice(index, 1);
            };
          } catch (e) {
            console.log("Error decoding chunk:", e);
          }

          if (this.onProgress) {
            this.onProgress(this.chunksReceived, this.totalChunks);
          }
        }
      }

      this.allChunksReceived = true;
      await this.waitForPlaybackEnd();
      this.cancelAnimation();
      if (this.onEnd) this.onEnd();
    } catch (e) {
      this.cancelAnimation();
      if (e.name === "AbortError") return;
      if (this.onError) this.onError(e);
      throw e;
    } finally {
      this.isPlaying = false;
    }
  }

  stop() {
    if (this.abortController) {
      this.abortController.abort();
    }
    // Keep the AudioContext alive so the next utterance reuses it.
    this.cleanup(true);
  }

  // Private helpers

  async initAudioContext() {
    // Reuse one AudioContext across utterances (avoids the ~6-context browser
    // cap and per-play startup latency). Only create if missing/closed.
    if (!this.audioContext || this.audioContext.state === "closed") {
      this.audioContext = new AudioContext();
      this.gainNode = this.audioContext.createGain();
      this.gainNode.connect(this.audioContext.destination);
    }
    this.gainNode.gain.value = this.volume;
    this.chunkTimings = [];
    this.lastReportedChunk = -1;

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  createSource(audioBuffer) {
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = this.speed;
    source.connect(this.gainNode);
    return source;
  }

  async waitForPlaybackEnd() {
    if (this.scheduledEndTime > 0) {
      const remainingTime = (this.scheduledEndTime - this.audioContext.currentTime) * 1000;
      if (remainingTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingTime + 100));
      }
    }
  }

  cancelAnimation() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  cleanup(keepContext = false) {
    this.cancelAnimation();
    this.isPlaying = false;
    this.isPaused = false;

    for (const source of this.scheduledSources) {
      try {
        source.stop();
      } catch (e) {}
    }
    this.scheduledSources = [];

    if (!keepContext) {
      if (this.audioContext && this.audioContext.state !== "closed") {
        this.audioContext.close().catch(() => {});
      }
      this.audioContext = null;
      this.gainNode = null;
    }

    this.audioChunks = [];
    this.decodedBuffers = [];
    this.chunkSources = [];
    this.playbackStartTime = 0;
    this.scheduledEndTime = 0;
    this.chunksReceived = 0;
    this.totalChunks = 0;
    this.chunkTimings = [];
    this.lastReportedChunk = -1;
    this.allChunksReceived = false;
  }
}
