console.log("Content script loaded successfully!");

let entropyThreshold;
let entropies = {};
let scriptCounts = { total: 0, firstParty: 0, thirdParty: 0 };
let logs = [];
let uniqueScripts = new Set();
let randomProfile = {};

function getCurrentMode() {
  return new Promise((resolve) => {
    browser.runtime.sendMessage({ getMode: true }, response => {
      resolve(response.mode);
      console.log("Applied Mode is " + response.mode);
    });
  });
}

// Function to request entropy threshold from the background script
function requestEntropyThreshold() {
  return new Promise((resolve, reject) => {
    browser.runtime.sendMessage({ getEntropyThreshold: true }, response => {
      if (response && response.threshold !== undefined) {
        entropyThreshold = response.threshold;
        console.log("Applied Entropy is " + response.threshold);
        resolve();
      } else {
        reject('Failed to get entropy threshold');
      }
    });
  });
}

function getEntropyData() {
  return new Promise((resolve, reject) => {
    browser.storage.local.get('entropyData').then(data => {
      if (data.entropyData) {
        entropies = data.entropyData;
        resolve();
      } else {
        reject('Failed to get entropy data from local storage');
      }
    });
  });
}

// Send the random profile to the background script
function updateBackgroundWithRandomProfile(randomProfile) {
  browser.runtime.sendMessage({
    action: "setRandomProfile",
    profile: randomProfile
  }, response => {
    console.log(response.status);  // Confirm if the background script received the profile
  });
}

// Function to inject the monitoring script
function injectMonitoringScript(threshold, entropies, mode) {
  const scriptContent = `
    (function() {
      let entropyValues = ${JSON.stringify(entropies)};
      let entropyThreshold = ${threshold};
      let attributeAccessData = {};
      let randomProfile = ${JSON.stringify(randomProfile)};
      let scriptsExceedingThreshold = new Set();

      // (Other parts of the injected script stay the same)
      
    })();
  `;

  const script = document.createElement('script');
  script.textContent = scriptContent;
  document.documentElement.appendChild(script);
  script.remove();
}

// Main function to orchestrate the order of execution
async function main() {
  try {
    await getEntropyData();
    const mode = await getCurrentMode();
    await requestEntropyThreshold();

    // If random mode, generate the profile before injecting the script
    if (mode === 'random') {
      randomProfile = generateRandomProfile();
      updateBackgroundWithRandomProfile(randomProfile);  // Send the profile to background.js
    }

    injectMonitoringScript(entropyThreshold, entropies, mode);
  } catch (error) {
    console.error('Error in main function:', error);
  }
}

// Random profile generation (unchanged from the previous version)
function generateRandomProfile() {
  const { platform, userAgent } = generateConsistentPlatformAndUserAgent();
  return {
    "screen.width": Math.floor(Math.random() * (1920 - 1024 + 1)) + 1024,
    "screen.height": Math.floor(Math.random() * (1080 - 768 + 1)) + 768,
    "navigator.userAgent": userAgent,
    "navigator.platform": platform,
    "HTMLCanvasElement.toDataURL": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/wcAAgEB/wliKwAAAABJRU5ErkJggg==",  // example for canvas
    "storage.quota": Math.floor(Math.random() * 5000) + 1000,    // example for storage quota
    "Permissions.state": "granted",                             // example for permissions
    "HTMLElement.offsetHeight": Math.floor(Math.random() * 1000) + 300,
    "HTMLElement.offsetWidth": Math.floor(Math.random() * 1000) + 300,
    "navigator.language": generateRandomLanguage(),
    "navigator.languages": generateRandomLanguages(),
    "navigator.plugins": generateRandomPlugins(),
    "WebGLRenderingContext.UNMASKED_RENDERER_WEBGL": generateRandomWebGLRenderer(),
    "WebGLRenderingContext.UNMASKED_VENDOR_WEBGL": generateRandomWebGLVendor(),
  };
}

function generateConsistentPlatformAndUserAgent() {
  const browsers = [
    { name: "Chrome", version: "91.0.4472.124", platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36" },
    { name: "Firefox", version: "89.0", platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:89.0) Gecko/20100101 Firefox/89.0" },
    { name: "Safari", version: "14.0", platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Safari/605.1.15" },
    { name: "Edge", version: "91.0", platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36 Edg/91.0.864.59" }
  ];
  const randomBrowser = browsers[Math.floor(Math.random() * browsers.length)];
  return { platform: randomBrowser.platform, userAgent: randomBrowser.userAgent };
}

function generateRandomLanguage() {
  const languages = ["en-US", "fr-FR", "es-ES", "de-DE", "zh-CN"];
  return languages[Math.floor(Math.random() * languages.length)];
}

function generateRandomLanguages() {
  const languageOptions = [
    ["en-US", "en"],
    ["fr-FR", "fr"],
    ["es-ES", "es"],
    ["de-DE", "de"],
    ["zh-CN", "zh"]
  ];
  return languageOptions[Math.floor(Math.random() * languageOptions.length)];
}

function generateRandomPlugins() {
  const plugins = [
    { name: "Shockwave Flash", filename: "flashplayer.xpt", description: "Shockwave Flash 32.0 r0" },
    { name: "Chrome PDF Viewer", filename: "internal-pdf-viewer", description: "Portable Document Format" },
    { name: "Widevine Content Decryption Module", filename: "widevinecdm.dll", description: "Content Decryption Module" },
  ];
  const randomPlugins = [];
  const pluginCount = Math.floor(Math.random() * plugins.length);
  for (let i = 0; i <= pluginCount; i++) {
    randomPlugins.push(plugins[i]);
  }
  return randomPlugins;
}

function generateRandomWebGLRenderer() {
  const renderers = ["ANGLE (Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0)", "AMD Radeon Pro 560X OpenGL Engine", "Apple M1"];
  return renderers[Math.floor(Math.random() * renderers.length)];
}

function generateRandomWebGLVendor() {
  const vendors = ["Google Inc.", "Intel Inc.", "ATI Technologies Inc."];
  return vendors[Math.floor(Math.random() * vendors.length)];
}

main();
