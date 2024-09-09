
console.log("background is loaded!");

let entropyThreshold = 0.83; // Default value
let currentMode = 'entropy'; // Default mode: 'entropy' or 'random'
let entropies = {};
let randomProfile = {};

// Function to generate a random user-agent, platform, and other header values
function generateRandomProfile() {
  const browsers = [
    { name: "Chrome", version: "91.0", platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0 Safari/537.36" },
    { name: "Firefox", version: "89.0", platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:89.0) Gecko/20100101 Firefox/89.0" },
    { name: "Safari", version: "14.0", platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Safari/605.1.15" },
    { name: "Edge", version: "91.0", platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0 Safari/537.36 Edg/91.0" }
  ];
  const randomBrowser = browsers[Math.floor(Math.random() * browsers.length)];
  return {
    "navigator.userAgent": randomBrowser.userAgent,
    "navigator.platform": randomBrowser.platform,
    "navigator.language": generateRandomLanguage(),
    "navigator.doNotTrack": Math.random() > 0.5 ? "1" : "0"
  };
}


function setEntropyThreshold(threshold) {
  entropyThreshold = threshold;
  browser.storage.local.set({'entropyThreshold': threshold});
  console.log('New threshold value set:', threshold);
}

function setMode(mode) {
  currentMode = mode;
  browser.storage.local.set({'currentMode': mode});
  console.log('New mode set:', mode);
}

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

// Generate random language
function generateRandomLanguage() {
  const languages = ["en-US", "fr-FR", "es-ES", "de-DE", "zh-CN"];
  return languages[Math.floor(Math.random() * languages.length)];
}

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
      callback(data.randomProfile);  // Pass the profile to the callback
    } else {
      callback({});  // If there's no random profile, return an empty object
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
      getRandomProfile(profile => {
        sendResponse({ profile: profile });  // Now send the profile properly
      });
      return true;  // This keeps the message channel open for async response
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
