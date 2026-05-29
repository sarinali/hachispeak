// Content script - text selection + click-to-read mode

// Guard so re-injection (via chrome.scripting after an extension reload) is a
// no-op instead of throwing "identifier already declared".
if (window.__outLoudContentLoaded) {
  // already initialized in this page
} else {
  window.__outLoudContentLoaded = true;

  let debounceTimer = null;
  let lastSelectedText = "";

  document.addEventListener("mouseup", handleSelection);
  document.addEventListener("keyup", handleSelection);

  function handleSelection() {
    if (readMode.active) return; // selection-to-sidebar is disabled while click-to-read is on
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const text = window.getSelection().toString().trim();
      if (text && text !== lastSelectedText) {
        lastSelectedText = text;
        sendTextToExtension(text);
      }
    }, 200);
  }

  function sendTextToExtension(text) {
    try {
      chrome.runtime.sendMessage({ type: "TEXT_SELECTED", text });
    } catch (e) {}
  }

  document.addEventListener("mousedown", () => {
    if (window.getSelection().toString().trim() === "") {
      lastSelectedText = "";
    }
  });

  // ---------------------------------------------------------------------------
  // Click-to-read mode
  // ---------------------------------------------------------------------------

  // Block-level elements we'll treat as a readable unit. Walking up from the
  // hovered node, we return the innermost match so we read a paragraph, not the
  // whole page container.
  // Semantic text blocks. Note: generic containers (DIV/SECTION/ARTICLE) are
  // intentionally excluded — including them makes the innermost match a layout
  // wrapper, so different clicks resolve the same big block. The computed-display
  // fallback in isReadableBlock() still handles div-soup pages with no semantics.
  const SEMANTIC_BLOCKS = new Set([
    "P",
    "LI",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "BLOCKQUOTE",
    "TD",
    "TH",
    "DD",
    "DT",
    "FIGCAPTION",
    "PRE",
    "CAPTION",
  ]);

  // block-level display values that denote a text block (not a layout container)
  const BLOCK_DISPLAYS = new Set(["block", "list-item", "table-cell", "flow-root"]);

  const MAX_READ_CHARS = 20000; // safety bound on a single click's text

  const readMode = {
    active: false,
    overlay: null,
    badge: null,
    styleEl: null,
    target: null,
  };

  function isReadableBlock(node) {
    if (!node.innerText || !node.innerText.trim()) return false;
    if (SEMANTIC_BLOCKS.has(node.tagName)) return true;
    const display = getComputedStyle(node).display;
    return BLOCK_DISPLAYS.has(display);
  }

  // Climb from the hovered node and return the INNERMOST readable block, so we
  // read one paragraph/heading, not the page wrapper.
  function resolveBlock(el) {
    let node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      if (isReadableBlock(node)) return node;
      node = node.parentElement;
    }
    return el && el.innerText && el.innerText.trim() ? el : null;
  }

  function positionOverlay(el) {
    if (!el || !readMode.overlay) return;
    const r = el.getBoundingClientRect();
    const o = readMode.overlay.style;
    o.top = `${r.top}px`;
    o.left = `${r.left}px`;
    o.width = `${r.width}px`;
    o.height = `${r.height}px`;
    o.display = r.width && r.height ? "block" : "none";
  }

  function onReadMove(e) {
    if (!readMode.active) return;
    const block = resolveBlock(e.target);
    readMode.target = block;
    if (block) positionOverlay(block);
    else if (readMode.overlay) readMode.overlay.style.display = "none";
  }

  function onReadScroll() {
    if (readMode.active && readMode.target) positionOverlay(readMode.target);
  }

  function onReadClick(e) {
    if (!readMode.active) return;
    // Let a deliberate text drag-selection fall through to the normal flow.
    if (window.getSelection().toString().trim()) return;

    const block = resolveBlock(e.target);
    if (!block) return;

    e.preventDefault();
    e.stopPropagation();

    const text = block.innerText.trim().slice(0, MAX_READ_CHARS);
    if (!text) return;

    // brief flash for feedback
    if (readMode.overlay) {
      readMode.overlay.classList.add("out-loud-rm-flash");
      setTimeout(() => readMode.overlay?.classList.remove("out-loud-rm-flash"), 180);
    }

    try {
      chrome.runtime.sendMessage({ type: "PLAY_TEXT", text });
    } catch (err) {}
  }

  function onReadKey(e) {
    if (e.key === "Escape" && readMode.active) {
      disableReadMode();
      try {
        chrome.runtime.sendMessage({ type: "READ_MODE_CHANGED", enabled: false });
      } catch (err) {}
    }
  }

  function enableReadMode() {
    if (readMode.active) return;
    readMode.active = true;

    readMode.overlay = document.createElement("div");
    readMode.overlay.id = "out-loud-read-overlay";

    readMode.badge = document.createElement("div");
    readMode.badge.id = "out-loud-read-badge";
    readMode.badge.textContent = "🔊 Click-to-read ON — Esc to exit";

    readMode.styleEl = document.createElement("style");
    readMode.styleEl.textContent = `
    #out-loud-read-overlay {
      position: fixed; z-index: 2147483646; display: none; pointer-events: none;
      background: rgba(99, 102, 241, 0.18);
      border: 2px solid rgba(99, 102, 241, 0.9);
      border-radius: 4px; box-sizing: border-box;
      transition: top .05s, left .05s, width .05s, height .05s;
    }
    #out-loud-read-overlay.out-loud-rm-flash { background: rgba(99, 102, 241, 0.4); }
    #out-loud-read-badge {
      position: fixed; z-index: 2147483647; top: 12px; right: 12px;
      background: #4f46e5; color: #fff; font: 600 12px/1.2 system-ui, sans-serif;
      padding: 8px 12px; border-radius: 8px; pointer-events: none;
      box-shadow: 0 2px 10px rgba(0,0,0,.25);
    }
    html.out-loud-read-active, html.out-loud-read-active * { cursor: pointer !important; }
  `;

    document.documentElement.appendChild(readMode.styleEl);
    document.body.appendChild(readMode.overlay);
    document.body.appendChild(readMode.badge);
    document.documentElement.classList.add("out-loud-read-active");

    document.addEventListener("mousemove", onReadMove, true);
    document.addEventListener("click", onReadClick, true);
    document.addEventListener("scroll", onReadScroll, true);
    document.addEventListener("keydown", onReadKey, true);
  }

  function disableReadMode() {
    if (!readMode.active) return;
    readMode.active = false;

    document.removeEventListener("mousemove", onReadMove, true);
    document.removeEventListener("click", onReadClick, true);
    document.removeEventListener("scroll", onReadScroll, true);
    document.removeEventListener("keydown", onReadKey, true);

    readMode.overlay?.remove();
    readMode.badge?.remove();
    readMode.styleEl?.remove();
    document.documentElement.classList.remove("out-loud-read-active");
    readMode.overlay = readMode.badge = readMode.styleEl = readMode.target = null;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "GET_SELECTION") {
      sendResponse({ text: window.getSelection().toString().trim() });
      return true;
    }
    if (message.type === "SET_READ_MODE") {
      message.enabled ? enableReadMode() : disableReadMode();
      sendResponse({ ok: true, active: readMode.active });
      return true;
    }
    return true;
  });
} // end __outLoudContentLoaded guard
