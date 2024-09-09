console.log("Content script loaded successfully!");

let entropyThreshold;
let entropies = {};
let scriptCounts = { total: 0, firstParty: 0, thirdParty: 0 };
let logs = [];
let uniqueScripts = new Set();
let randomProfile = {};  // To store the random profile from background.js

// Function to retrieve the random profile (only userAgent and platform) from the background script
function getRandomProfileFromBackground() {
  return new Promise((resolve, reject) => {
    browser.runtime.sendMessage({ getRandomProfile: true }, response => {
      if (response && response.profile) {
        // Set userAgent and platform from the background
        randomProfile.navigatorUserAgent = response.profile["navigator.userAgent"];
        randomProfile.navigatorPlatform = response.profile["navigator.platform"];
        resolve(randomProfile);
      } else {
        console.error("Failed to get random profile from background.js", response);
        reject('No profile received from background.js');
      }
    });
  });
}

function getCurrentMode() {
  return new Promise((resolve) => {
    browser.runtime.sendMessage({ getMode: true }, response => {
      resolve(response.mode);
      console.log("Applied Mode is " + response.mode);
    });
  });
}


function getEntropyData() {
  return new Promise((resolve, reject) => {
    browser.storage.local.get('entropyData', (data) => {
      if (data.entropyData) {
        entropies = data.entropyData;
        resolve();
      } else {
        reject('Failed to get entropy data from local storage');
      }
    });
  });
}

function requestEntropyThreshold() {
  return new Promise((resolve, reject) => {
    browser.runtime.sendMessage({ getEntropyThreshold: true }, response => {
      if (response && response.threshold !== undefined) {
        entropyThreshold = response.threshold;
        resolve();
      } else {
        reject('Failed to get entropy threshold');
      }
    });
  });
}


// Function to inject the monitoring script and randomize properties
function injectMonitoringScript(threshold, entropies, mode) {
  const scriptContent = `
    (function() {
      let entropyValues = ${JSON.stringify(entropies)};
      let entropyThreshold = ${threshold};
      let attributeAccessData = {};
      let randomProfile = ${JSON.stringify(randomProfile)};
      let scriptsExceedingThreshold = new Set();

      function calculateVectorEntropy(attributes, scriptSource) {
        function normalizeVector(vector) {
          return vector.split('|').map(attr => attr.trim()).sort().join('|');
        }
        const normalizedAttributes = normalizeVector(attributes.join('|'));
        for (const key in entropyValues) {
          if (entropyValues.hasOwnProperty(key)) {
            const normalizedKey = normalizeVector(key);
            if (normalizedKey === normalizedAttributes) {
              return entropyValues[key];
            }
          }
        }
        return 0.99; // Default entropy if not found in the database
      }
    
      

      function logNewVector(attribute, vector, scriptSource, entropy) {
        const logEntry = \`\${new Date().toISOString()} - Last accessed attribute: \${attribute}, Vector: \${vector}, Script source: \${scriptSource}, Detected entropy: \${entropy}\\n\`;
        fetch('http://localhost:8000/Logvectors.txt', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: logEntry
        }).catch(error => {
          console.error('Error logging vector:', error);
        });
      }

      function reportAccess(attribute, scriptSource) {
        let allowAccess = false;
        if (attribute && scriptSource) {
          if (!attributeAccessData[scriptSource]) {
            attributeAccessData[scriptSource] = new Set();
          }
          attributeAccessData[scriptSource].add(attribute);
          const attributes = Array.from(attributeAccessData[scriptSource]);
          const vectorEntropy = calculateVectorEntropy(attributes, scriptSource);
          console.log(\`Detected entropy for vector [\${attributes.join("|")}] from script [\${scriptSource}]: \${vectorEntropy}\`);

          //logNewVector(attribute, attributes.join("|"), scriptSource, vectorEntropy);

          allowAccess = vectorEntropy <= entropyThreshold;

          if (!allowAccess && !scriptsExceedingThreshold.has(scriptSource)) {
                // Send a message to content.js to track this script
            window.postMessage({
              type: 'SCRIPT_EXCEEDS_THRESHOLD',
              data: { scriptSource: scriptSource, entropy: vectorEntropy }
            }, '*');
          }

          window.postMessage({
            type: 'FP_LOG',
            data: { lastAttribute: attribute, vector: attributes.join("|"), scriptSource, webpage: window.location.href, timestamp: new Date().toISOString() }
          }, '*');

          if (!allowAccess && "${mode}" === 'random') {
            console.log('Randomizing access for attribute:', attribute, 'in random mode due to entropy exceeding threshold');
            return true;
          }

          return allowAccess;
        }
        return false;
      }

      function hookMethod(obj, method, objName) {
        const originalMethod = obj[method];
        obj[method] = function() {
          const scripts = document.getElementsByTagName('script');
          const currentScript = scripts[scripts.length - 1];
          const scriptSource = currentScript ? (currentScript.src || window.location.href) : window.location.href;
          if (reportAccess(objName + '.' + method, scriptSource)) {
            return originalMethod.apply(this, arguments);
          }
        };
      }

      function hookProperty(obj, prop, objName) {
        let originalValue = obj[prop];
        Object.defineProperty(obj, prop, {
          get: function() {
            const scripts = document.getElementsByTagName('script');
            const currentScript = scripts[scripts.length - 1];
            const scriptSource = currentScript ? (currentScript.src || window.location.href) : window.location.href;
            if (reportAccess(objName + '.' + prop, scriptSource)) {
              if ("${mode}" === 'random') {
                return randomProfile[objName + '.' + prop] || originalValue;
              } else {
                return originalValue;
              }
            } else {
              return undefined;
            }
          },
          set: function(value) {
            const scripts = document.getElementsByTagName('script');
            const currentScript = scripts[scripts.length - 1];
            const scriptSource = currentScript ? (currentScript.src || window.location.href) : window.location.href;
            if (reportAccess(objName + '.' + prop, scriptSource)) {
              originalValue = value;
            }
          },
          configurable: true
        });
      }

      function hookAllProperties(obj, objName) {
        for (let prop in obj) {
          if (typeof obj[prop] !== 'function') {
            hookProperty(obj, prop, objName);
          }
        }
      }

      function hookAllPropertieswebgl(obj, objName) {
        const excludeProps = ['canvas', 'drawingBufferWidth', 'drawingBufferHeight'];
        for (let prop in obj) {
          if (!excludeProps.includes(prop) && typeof obj[prop] !== 'function') {
            try {
              if (objName.includes('WebGLRenderingContext') || objName.includes('WebGL2RenderingContext')) {
                const descriptor = Object.getOwnPropertyDescriptor(obj, prop);
                if (descriptor && descriptor.get) {
                  const originalGetter = descriptor.get;
                  Object.defineProperty(obj, prop, {
                    get: function() {
                      const scripts = document.getElementsByTagName('script');
                      const currentScript = scripts[scripts.length - 1];
                      const scriptSource = currentScript ? (currentScript.src || window.location.href) : window.location.href;
                      if (reportAccess(objName + '.' + prop, scriptSource)) {
                        if ("${mode}" === 'random') {
                          return randomProfile[objName + '.' + prop] || originalGetter.call(this);
                        } else {
                          return originalGetter.call(this);
                        }
                      } else {
                        return undefined;
                      }
                    }
                  });
                }
              } else {
                hookProperty(obj, prop, objName);
              }
            } catch (error) {
              console.log(error);
            }
          }
        }
      }

      // Hook required properties
      hookAllProperties(screen, 'screen');
      hookAllProperties(navigator, 'navigator');
      hookProperty(HTMLCanvasElement.prototype, 'toDataURL', 'HTMLCanvasElement');
      hookProperty(history, 'length', 'history');

      // to be fixed
      //hookProperty(WebGLShaderPrecisionFormat.prototype, 'precision', 'WebGLShaderPrecisionFormat');
      //hookProperty(WebGLShaderPrecisionFormat.prototype, 'rangeMax', 'WebGLShaderPrecisionFormat');
      //hookProperty(WebGLShaderPrecisionFormat.prototype, 'rangeMin', 'WebGLShaderPrecisionFormat');

      if (window.WebGLRenderingContext) {
        hookAllPropertieswebgl(WebGLRenderingContext, 'WebGLRenderingContext');
      }
      if (window.WebGL2RenderingContext) {
        hookAllPropertieswebgl(WebGL2RenderingContext, 'WebGL2RenderingContext');
      }

      //hookProperty(navigator.storage.estimate, 'quota', 'navigator.storage.estimate');
      if (window.Permissions) {
        hookProperty(Permissions.prototype, 'state', 'Permissions');
      }

      // to fix
      //hookProperty(HTMLElement.prototype, 'offsetHeight', 'HTMLElement');
      //hookProperty(HTMLElement.prototype, 'offsetWidth', 'HTMLElement');

      
      if (window.BaseAudioContext) {
        //hookProperty(BaseAudioContext.prototype, 'sampleRate', 'BaseAudioContext');
        //hookProperty(BaseAudioContext.prototype, 'currentTime', 'BaseAudioContext');
        //hookProperty(BaseAudioContext.prototype, 'state', 'BaseAudioContext');
      }
      if (window.AudioContext) {
        hookProperty(AudioContext.prototype, 'baseLatency', 'AudioContext');
        hookProperty(AudioContext.prototype, 'outputLatency', 'AudioContext');
      }
      if (window.AudioDestinationNode) {
        hookProperty(AudioDestinationNode.prototype, 'maxChannelCount', 'AudioDestinationNode');
      }
      if (window.AudioNode) {
        hookProperty(AudioNode.prototype, 'channelCount', 'AudioNode');
        hookProperty(AudioNode.prototype, 'numberOfInputs', 'AudioNode');
        hookProperty(AudioNode.prototype, 'numberOfOutputs', 'AudioNode');
      }

      // Hook Fonts
      hookProperty(document, 'fonts', 'document');

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

    // Get userAgent and platform from background.js and generate rest in content.js
    randomProfile = await getRandomProfileFromBackground();

    // Generate other randomized values in content.js for WebGL, screen, etc.
    const generatedProfile = generateRandomProfile();
    randomProfile = { ...randomProfile, ...generatedProfile };

    injectMonitoringScript(entropyThreshold, entropies, mode);
  } catch (error) {
    console.error('Error in main function:', error);
  }
}

// Random profile generation (except userAgent and platform, which are from background.js)
function generateRandomProfile() {
  return {
    "screen.width": Math.floor(Math.random() * (1920 - 1024 + 1)) + 1024,
    "screen.height": Math.floor(Math.random() * (1080 - 768 + 1)) + 768,
    "HTMLCanvasElement.toDataURL": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/wcAAgEB/wliKwAAAABJRU5ErkJggg==",
    //"navigator.storage.estimate.quota": Math.floor(Math.random() * 5000) + 1000,
    "Permissions.state": "granted",
    "HTMLElement.offsetHeight": Math.floor(Math.random() * 1000) + 300,
    "HTMLElement.offsetWidth": Math.floor(Math.random() * 1000) + 300,
    "navigator.language": generateRandomLanguage(),
    "navigator.languages": generateRandomLanguages(),
    "navigator.plugins": generateRandomPlugins(),
    "WebGLRenderingContext.UNMASKED_RENDERER_WEBGL": generateRandomWebGLRenderer(),
    "WebGLRenderingContext.UNMASKED_VENDOR_WEBGL": generateRandomWebGLVendor(),
    "fonts": generateRandomFonts(),  // Random fonts
    "AudioContext.sampleRate": Math.floor(Math.random() * (48000 - 44100 + 1)) + 44100, // Random sample rate
    "AudioContext.baseLatency": Math.random().toFixed(5),  // Random base latency
    "screen.availHeight": Math.floor(Math.random() * (1080 - 768 + 1)) + 768,
    "screen.availWidth": Math.floor(Math.random() * (1920 - 1024 + 1)) + 1024,
     "history.length":Math.floor(Math.random() * 50) + 1,
  };
}

// Generate a random list of fonts
function generateRandomFonts() {
  const fonts = ["Arial", "Verdana", "Times New Roman", "Courier New", "Georgia", "Palatino", "Garamond", "Comic Sans MS"];
  return fonts.slice(0, Math.floor(Math.random() * fonts.length) + 1);
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
  return plugins.slice(0, Math.floor(Math.random() * plugins.length) + 1);
}

function generateRandomWebGLRenderer() {
  const renderers = ["ANGLE (Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0)", "AMD Radeon Pro 560X OpenGL Engine", "Apple M1"];
  return renderers[Math.floor(Math.random() * renderers.length)];
}

function generateRandomWebGLVendor() {
  const vendors = ["Google Inc.", "Intel Inc.", "ATI Technologies Inc."];
  return vendors[Math.floor(Math.random() * vendors.length)];
}




// Listen for messages from the injected script
window.addEventListener('message', function(event) {
  if (event.data.type === 'FP_LOG') {
    logs.push(event.data.data);
  } else if (event.data.type === 'SCRIPT_EXCEEDS_THRESHOLD') {
    // Increment the count when a script exceeds the entropy threshold
    const scriptSource = event.data.data.scriptSource;
    console.log(`Script exceeded entropy threshold: ${scriptSource}`);
    incrementExceedingScriptCount(scriptSource);
  }
});

// Increment the count for scripts that exceed the entropy threshold
function incrementExceedingScriptCount(scriptSource) {
  if (!uniqueScripts.has(scriptSource)) {
    uniqueScripts.add(scriptSource);
    scriptCounts.total++;
    if (scriptSource.includes(window.location.hostname)) {
      scriptCounts.firstParty++;
    } else {
      scriptCounts.thirdParty++;
    }
    browser.runtime.sendMessage({ action: "updateScriptCounts", counts: scriptCounts });
  }
}


// Listen for messages from the popup
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "applyRandomProfile") {
    applyRandomProfile();
  } else if (message.action === "applyEntropyBlocking") {
    entropyThreshold = message.threshold;
    injectMonitoringScript(entropyThreshold, entropies);
  } else if (message.action === "getScriptCounts") {
    sendResponse({ counts: scriptCounts });
  } else if (message.action === "getLogs") {
    sendResponse({ logs: logs.map(log => `${log.timestamp} - ${log.lastAttribute} : ${log.scriptSource} : ${log.webpage}`).join('\n') });
  }
});

main();
