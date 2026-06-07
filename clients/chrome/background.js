// Background service worker - handles sidepanel and context menu

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("Failed to set panel behavior:", error));

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "read-selection",
    title: "Read out loud",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "read-selection" && info.selectionText) {
    chrome.sidePanel.open({ windowId: tab.windowId }).then(() => {
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: "PLAY_TEXT",
          text: info.selectionText,
        });
      }, 500);
    });
  }
});

// Note: the side panel listens to chrome.runtime messages directly, so the
// content script's messages (which carry sender.tab) reach it without a relay.
// A relay here would strip sender.tab and bypass the active-tab gate.
