console.log("background is loaded!");

let entropyThreshold = 0.5; // Default value
let currentMode = 'entropy'; // Default mode: 'entropy' or 'random'
let entropies = {};
let randomProfile = {};

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

function getEntropyThreshold(callback) {
  browser.storage.local.get('entropyThreshold').then(data => {
    const threshold = data.entropyThreshold;
    if (threshold !== undefined) {
      entropyThreshold = threshold;
      callback(threshold);
    } else {
      callback(entropyThreshold);
    }
  });
}

function setEntropyThreshold(threshold) {
  entropyThreshold = threshold;
  browser.storage.local.set({ 'entropyThreshold': threshold });
  console.log('New threshold value set:', threshold);
}

function setMode(mode) {
  currentMode = mode;
  browser.storage.local.set({ 'currentMode': mode });
  console.log('New mode set:', mode);
}

// HTTP header modification based on the random profile in 'random' mode
browser.webRequest.onBeforeSendHeaders.addListener(
  function (details) {
    if (currentMode === 'random' && randomProfile["navigator.userAgent"]) {
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
    }
    return { requestHeaders: details.requestHeaders };
  },
  { urls: ["<all_urls>"] },  // Intercept all outgoing requests
  ["blocking", "requestHeaders"]
);

// Retrieve the current random profile from background.js for content.js
function getRandomProfile(callback) {
  browser.storage.local.get('randomProfile').then(data => {
    if (data.randomProfile) {
      randomProfile = data.randomProfile;
      callback(randomProfile);
    }
  });
}

// Listener to update randomProfile and handle entropy-related actions
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
    } else if (message.getRandomProfile) {
      getRandomProfile(profile => sendResponse({ profile: profile }));
      return true;
    }
  });
}

// Initialize mode from storage and random profile
browser.storage.local.get(['currentMode', 'randomProfile']).then(data => {
  if (data.currentMode) {
    currentMode = data.currentMode;
  }
  if (data.randomProfile) {
    randomProfile = data.randomProfile;
  }
});

listenForMessages();

