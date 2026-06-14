// Shared constants

// Lightweight debug logging. Toggle off to silence. Logs to the side panel's
// console (chrome://extensions -> Out Loud -> "Inspect views: sidepanel.html").
const OUTLOUD_DEBUG = true;
function olog(...args) {
  if (OUTLOUD_DEBUG)
    console.log("[OutLoud]", `+${(performance.now() / 1000).toFixed(2)}s`, ...args);
}

const SERVER_URL = "http://localhost:51730";
const DEFAULT_VOICE = "af_heart";
const DEFAULT_VOLUME = 80;
const DEFAULT_SPEED = 1;

const DEFAULT_SETTINGS = {
  text: "",
  voice: DEFAULT_VOICE,
  volume: DEFAULT_VOLUME,
  speed: DEFAULT_SPEED,
};

const VOICE_OPTIONS = [
  { id: "af_heart", name: "Heart", gender: "Female" },
  { id: "af_bella", name: "Bella", gender: "Female" },
  { id: "af_nicole", name: "Nicole", gender: "Female" },
  { id: "af_aoede", name: "Aoede", gender: "Female" },
  { id: "af_kore", name: "Kore", gender: "Female" },
  { id: "af_sarah", name: "Sarah", gender: "Female" },
  { id: "af_nova", name: "Nova", gender: "Female" },
  { id: "af_sky", name: "Sky", gender: "Female" },
  { id: "af_alloy", name: "Alloy", gender: "Female" },
  { id: "af_jessica", name: "Jessica", gender: "Female" },
  { id: "af_river", name: "River", gender: "Female" },
  { id: "am_michael", name: "Michael", gender: "Male" },
  { id: "am_fenrir", name: "Fenrir", gender: "Male" },
  { id: "am_puck", name: "Puck", gender: "Male" },
  { id: "am_echo", name: "Echo", gender: "Male" },
  { id: "am_eric", name: "Eric", gender: "Male" },
  { id: "am_liam", name: "Liam", gender: "Male" },
  { id: "am_onyx", name: "Onyx", gender: "Male" },
  { id: "am_santa", name: "Santa", gender: "Male" },
  { id: "am_adam", name: "Adam", gender: "Male" },
];
