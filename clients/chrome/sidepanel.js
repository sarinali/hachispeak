// Sidepanel init and event wiring

const ui = {
  textEl: null,
  voiceSelect: null,
  languageSelect: null,
  playBtn: null,
  downloadBtn: null,
  volumeSlider: null,
  volumeValue: null,
  speedSlider: null,
  speedValue: null,
  highlightCheckbox: null,
  readModeCheckbox: null,
  overlay: null,

  getText() {
    return this.textEl.value.trim();
  },
  updateUI() {
    const icon = this.playBtn.querySelector(".play-icon");
    icon.innerHTML = isPlaying
      ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
      : '<path d="M8 5v14l11-7z"/>';
    if (this.downloadBtn) this.downloadBtn.disabled = !hasCachedAudio();
  },
  updateHighlight() {
    updateHighlight(this.textEl, this.overlay, isPlaying);
  },
  clearHighlight() {
    clearHighlight(this.textEl, this.overlay);
  },
  enableControls(enabled) {
    this.textEl.disabled = !enabled;
    this.languageSelect.disabled = !enabled;
    this.voiceSelect.disabled = !enabled;
  },
};

async function init() {
  ui.textEl = document.getElementById("selected-text");
  ui.voiceSelect = document.getElementById("voice-select");
  ui.languageSelect = document.getElementById("language-select");
  ui.playBtn = document.getElementById("play-btn");
  ui.downloadBtn = document.getElementById("download-btn");
  ui.volumeSlider = document.getElementById("volume-slider");
  ui.volumeValue = document.getElementById("volume-value");
  ui.speedSlider = document.getElementById("speed-slider");
  ui.speedValue = document.getElementById("speed-value");
  ui.highlightCheckbox = document.getElementById("highlight-checkbox");
  ui.readModeCheckbox = document.getElementById("read-mode-checkbox");
  ui.overlay = document.getElementById("text-highlight-overlay");

  const retryBtn = document.getElementById("retry-btn");
  retryBtn?.addEventListener("click", async () => {
    retryBtn.textContent = "Checking...";
    retryBtn.disabled = true;
    await checkServer();
    retryBtn.textContent = "Retry Connection";
    retryBtn.disabled = false;
  });

  await loadSettings();
  applySettings();
  bindEvents();
  await checkServer();
  listenForMessages();
  await initActiveTabTracking();
}

function formatSpeed(v) {
  return `${Math.round(v * 100) / 100}x`;
}

function applySettings() {
  ui.languageSelect.value = settings.language;
  updateVoiceOptions(ui.languageSelect, ui.voiceSelect);
  ui.voiceSelect.value = settings.voice;
  if (ui.volumeSlider) {
    ui.volumeSlider.value = settings.volume;
    ui.volumeValue.textContent = settings.volume + "%";
  }
  if (ui.speedSlider) {
    ui.speedSlider.value = settings.speed;
    ui.speedValue.textContent = formatSpeed(settings.speed);
  }
  setSpeed(settings.speed);
  if (ui.highlightCheckbox) ui.highlightCheckbox.checked = settings.highlightChunk;
  if (settings.text) {
    ui.textEl.value = settings.text;
    ui.playBtn.disabled = false;
  }
}

function bindEvents() {
  ui.languageSelect.addEventListener("change", () => {
    settings.language = ui.languageSelect.value;
    updateVoiceOptions(ui.languageSelect, ui.voiceSelect);
    settings.voice = ui.voiceSelect.value;
    saveSettings();
    // Mid-read: abort and continue the remaining sentences in the new voice.
    if (isPlaying || isPaused) resumeWithVoice(ui);
    else clearCache();
  });

  ui.voiceSelect.addEventListener("change", () => {
    settings.voice = ui.voiceSelect.value;
    saveSettings();
    if (isPlaying || isPaused) resumeWithVoice(ui);
    else clearCache();
  });

  ui.textEl.addEventListener("input", () => {
    settings.text = ui.getText();
    ui.playBtn.disabled = !settings.text;
    clearCache();
    saveSettings();
  });

  ui.volumeSlider?.addEventListener("input", () => {
    settings.volume = parseInt(ui.volumeSlider.value);
    ui.volumeValue.textContent = settings.volume + "%";
    setVolume(settings.volume / 100);
    saveSettings();
  });

  ui.speedSlider?.addEventListener("input", () => {
    settings.speed = parseFloat(ui.speedSlider.value);
    ui.speedValue.textContent = formatSpeed(settings.speed);
    setSpeed(settings.speed); // applies instantly, including mid-read
    saveSettings();
  });

  ui.highlightCheckbox?.addEventListener("change", () => {
    settings.highlightChunk = ui.highlightCheckbox.checked;
    saveSettings();
    isPlaying ? ui.updateHighlight() : ui.clearHighlight();
  });

  ui.readModeCheckbox?.addEventListener("change", () => {
    setReadMode(ui.readModeCheckbox.checked);
  });

  ui.playBtn.addEventListener("click", () => togglePlayback(ui));
  ui.downloadBtn?.addEventListener("click", download);
}

// --- Active-tab ownership for click-to-read --------------------------------
// Content scripts are per-tab; this panel is one global UI. Read mode is a
// panel-level intent that follows whichever tab is active, and page messages
// are accepted only from the active tab.
let activeTabId = null;
let readModeIntent = false; // is the checkbox on?
let readModeTabId = null; // tab currently decorated with read mode

async function initActiveTabTracking() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id ?? null;
  } catch (e) {}

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    activeTabId = tabId;
    applyReadModeToActiveTab();
  });
  chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      if (tab?.id != null) {
        activeTabId = tab.id;
        applyReadModeToActiveTab();
      }
    } catch (e) {}
  });
}

// Message a tab's content script; inject content.js and retry if it isn't there
// (tab opened before the extension loaded, or a stale script after reload).
async function sendToTab(tabId, msg) {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
    return true;
  } catch (e) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      await chrome.tabs.sendMessage(tabId, msg);
      return true;
    } catch (e2) {
      return false;
    }
  }
}

async function applyReadModeToActiveTab() {
  // Turn off the previous owner if it's no longer the target (or intent is off).
  if (readModeTabId != null && (readModeTabId !== activeTabId || !readModeIntent)) {
    chrome.tabs
      .sendMessage(readModeTabId, { type: "SET_READ_MODE", enabled: false })
      .catch(() => {});
    readModeTabId = null;
  }
  if (!readModeIntent || activeTabId == null) return;
  const ok = await sendToTab(activeTabId, { type: "SET_READ_MODE", enabled: true });
  readModeTabId = ok ? activeTabId : null;
}

// Checkbox handler.
function setReadMode(enabled) {
  readModeIntent = enabled;
  applyReadModeToActiveTab();
}

function listenForMessages() {
  chrome.runtime.onMessage.addListener((msg, sender) => {
    // Ignore page messages from any tab that isn't the active one. Messages with
    // no sender.tab (e.g. the right-click context menu, sent from the background)
    // are trusted and pass through.
    if (sender?.tab && sender.tab.id !== activeTabId) return;

    if (msg.type === "READ_MODE_CHANGED") {
      readModeIntent = !!msg.enabled;
      readModeTabId = msg.enabled ? activeTabId : null;
      if (ui.readModeCheckbox) ui.readModeCheckbox.checked = !!msg.enabled;
      return;
    }

    if (msg.type === "PLAY_TEXT") {
      const text = (msg.text || "").trim();
      if (text) play(ui, text); // always replace + play (clean abort of the old one)
      return;
    }

    if (msg.type === "TEXT_SELECTED") {
      const text = (msg.text || "").trim();
      if (text && text !== ui.getText()) {
        ui.textEl.value = text;
        ui.playBtn.disabled = false;
      }
    }
  });
}

async function download() {
  if (!hasCachedAudio() || !(await checkServer())) return;

  ui.downloadBtn.disabled = true;
  ui.downloadBtn.innerHTML = '<div class="spinner small"></div>';

  try {
    const blob = await fetchAudio(getCachedText(), settings.voice, "wav");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "out-loud-audio.wav";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {}

  ui.downloadBtn.disabled = !hasCachedAudio();
  ui.downloadBtn.innerHTML =
    '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>';
}

document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
