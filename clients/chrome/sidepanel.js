// Sidepanel init and event wiring

const ui = {
  voiceSelect: null,
  playBtn: null,
  downloadBtn: null,
  volumeSlider: null,
  volumeValue: null,
  speedSlider: null,
  speedValue: null,
  readModeCheckbox: null,

  getText() {
    return settings.text;
  },
  updateUI() {
    const icon = this.playBtn.querySelector(".play-icon");
    icon.innerHTML = isPlaying
      ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
      : '<path d="M8 5v14l11-7z"/>';
    if (this.downloadBtn) this.downloadBtn.disabled = !hasCachedAudio();
  },
  updateHighlight() {},
  clearHighlight() {},
  enableControls(enabled) {
    this.voiceSelect.disabled = !enabled;
  },
};

async function init() {
  ui.voiceSelect = document.getElementById("voice-select");
  ui.playBtn = document.getElementById("play-btn");
  ui.downloadBtn = document.getElementById("download-btn");
  ui.volumeSlider = document.getElementById("volume-slider");
  ui.volumeValue = document.getElementById("volume-value");
  ui.speedSlider = document.getElementById("speed-slider");
  ui.speedValue = document.getElementById("speed-value");
  ui.readModeCheckbox = document.getElementById("read-mode-checkbox");

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
  populateVoices(ui.voiceSelect);
  if (ui.volumeSlider) {
    ui.volumeSlider.value = settings.volume;
    ui.volumeValue.textContent = settings.volume + "%";
  }
  if (ui.speedSlider) {
    ui.speedSlider.value = settings.speed;
    ui.speedValue.textContent = formatSpeed(settings.speed);
  }
  setSpeed(settings.speed);
  if (settings.text) {
    ui.playBtn.disabled = false;
  }
}

function bindEvents() {
  ui.voiceSelect.addEventListener("change", () => {
    settings.voice = ui.voiceSelect.value;
    saveSettings();
    if (isPlaying || isPaused) resumeWithVoice(ui);
    else clearCache();
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
    setSpeed(settings.speed);
    saveSettings();
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
      if (text && text !== settings.text) {
        settings.text = text;
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
