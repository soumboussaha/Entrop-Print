let entropyThreshold = 0.5; // Default value
let currentMode = 'entropy'; // Default mode: 'entropy' or 'random'
let randomProfile = {}; // Store the random profile for HTTP headers
let entropies = {};

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

// Function to get entropy threshold
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

// Function to set entropy threshold
function setEntropyThreshold(threshold) {
  entropyThreshold = threshold;
  browser.storage.local.set({ 'entropyThreshold': threshold });
  console.log('New threshold value set:', threshold);
}

// Function to set current mode (random or entropy)
function setMode(mode) {
  currentMode = mode;
  browser.storage.local.set({ 'currentMode': mode });
  console.log('New mode set:', mode);
}

// Function to generate random profile
function generateRandomProfile() {
  const { platform, userAgent } = generateConsistentPlatformAndUserAgent();
  return {
    "navigator.userAgent": userAgent,
    "navigator.platform": platform,
    "navigator.language": generateRandomLanguage(),
    "navigator.languages": generateRandomLanguages(),
    "navigator.doNotTrack": Math.random() < 0.5 ? "1" : "0", // Randomize Do Not Track
    "WebGLRenderingContext.UNMASKED_RENDERER_WEBGL": generateRandomWebGLRenderer(),
    "WebGLRenderingContext.UNMASKED_VENDOR_WEBGL": generateRandomWebGLVendor(),
  };
}

// Function to generate and store the random profile if needed
function updateRandomProfile() {
  if (currentMode === 'random') {
    randomProfile = generateRandomProfile();
  }
}

// HTTP header modification using webRequest API
browser.webRequest.onBeforeSendHeaders.addListener(
  function (details) {
    if (currentMode === 'random') { // Only apply randomization in random mode
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
      updateRandomProfile();  // Regenerate random profile if mode changes to 'random'
    } else if (message.getMode) {
      browser.storage.local.get('currentMode').then(data => {
        sendResponse({ mode: data.currentMode || currentMode });
      });
      return true;
    } else if (message.getRandomProfile) {  // Return randomProfile to content.js
      sendResponse({ profile: randomProfile });
    }
  });
}

// Initialize mode from storage
browser.storage.local.get('currentMode').then(data => {
  if (data.currentMode) {
    currentMode = data.currentMode;
  }
  updateRandomProfile(); // Ensure profile is generated if in random mode
});

// Start listening for messages
listenForMessages();
