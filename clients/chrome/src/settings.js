// Settings management

let settings = { ...DEFAULT_SETTINGS };

async function loadSettings() {
  try {
    const stored = await chrome.storage.sync.get("ttsSettings");
    if (stored.ttsSettings) settings = { ...settings, ...stored.ttsSettings };

    const serverSettings = await fetchSettings();
    if (serverSettings) {
      settings = {
        ...settings,
        voice: serverSettings.voice || settings.voice,
        volume: serverSettings.volume ?? settings.volume,
        text: serverSettings.text || settings.text,
      };
    }
  } catch (e) {}
}

async function saveSettings() {
  try {
    await chrome.storage.sync.set({ ttsSettings: settings });
    await postSettings(settings);
  } catch (e) {}
}

function populateVoices(voiceSelect) {
  voiceSelect.innerHTML = "";
  VOICE_OPTIONS.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = `${v.name} (${v.gender})`;
    voiceSelect.appendChild(opt);
  });
  if (!VOICE_OPTIONS.find((v) => v.id === settings.voice)) {
    settings.voice = VOICE_OPTIONS[0].id;
  }
  voiceSelect.value = settings.voice;
}
