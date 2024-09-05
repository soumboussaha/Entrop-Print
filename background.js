console.log("background is loaded!");

let entropyThreshold = 0.832; // Default value
let currentMode = 'entropy'; // Default mode: 'entropy' or 'random'
let entropies = {};
let randomProfile = {};  // Will store the random profile received from content.js

// Function to read entropy data from CSV
function readCSVData() {
  return fetch(browser.runtime.getURL("./data/Entropy.csv"))
    .then(response => response.text())
    .then(data => {
      const rows = data.split('\n');
      rows.forEach(row => {
        const columns = row.split(',');
        const vector = columns[0].trim();
        const entropy = parseFloat(columns[2]);
        entropies[vector] = entropy;
      });
      console.log("Entropy data loaded successfully");
      // Store entropy data in local storage
      browser.storage.local.set({ entropyData: entropies });
    })
    .catch(error => {
      console.error('Error reading CSV file:', error);
    });
}

// Load entropy data when the background script starts
readCSVData().then(() => {
  console.log("Entropy data loaded and ready to be sent to content scripts");
});

// HTTP header modification using webRequest API
browser.webRequest.onBeforeSendHeaders.addListener(
  function(details) {
    for (let header of details.requestHeaders) {
      if (header.name.toLowerCase() === 'user-agent' && randomProfile["navigator.userAgent"]) {
        header.value = randomProfile["navigator.userAgent"];
      }
      if (header.name.toLowerCase() === 'accept-language' && randomProfile["navigator.language"]) {
        header.value = randomProfile["navigator.language"];
      }
      if (header.name.toLowerCase() === 'dnt' && randomProfile["navigator.doNotTrack"]) {
        header.value = randomProfile["navigator.doNotTrack"];
      }
    }
    return { requestHeaders: details.requestHeaders };
  },
  { urls: ["<all_urls>"] },  // Intercept all outgoing requests
  ["blocking", "requestHeaders"]
);

// Listener to handle messages from content.js
function listenForMessages() {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.getEntropyThreshold) {
      getEntropyThreshold(threshold => sendResponse({ threshold: threshold }));
      return true;
    } else if (message.setEntropyThreshold) {
      setEntropyThreshold(message.setEntropyThreshold);
    } else if (message.setMode) {
      setMode(message.setMode);
    } else if (message.getMode) {
      browser.storage.local.get('currentMode').then(data => {
        sendResponse({ mode: data.currentMode || currentMode });
      });
      return true;
    } else if (message.action === "updateScriptCounts") {
      browser.runtime.sendMessage(message);
    } else if (message.getEntropyData) {
      sendResponse({ entropies: entropies });
      return true;
    } else if (message.action === "setRandomProfile") {
      randomProfile = message.profile;  // Store the random profile received from content.js
      sendResponse({ status: "Profile updated" });
    }
  });
}

// Initialize mode from storage
browser.storage.local.get('currentMode').then(data => {
  if (data.currentMode) {
    currentMode = data.currentMode;
  }
});

listenForMessages();
