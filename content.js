console.log("Content script loaded successfully!");

let entropyThreshold;
let entropies = {};
let scriptCounts = { total: 0, firstParty: 0, thirdParty: 0 };
let logs = [];
let uniqueScripts = new Set();
let randomProfile = {};  // To store the random profile from background.js

// Function to retrieve the random profile (only userAgent and platform) from the background script
async function getRandomProfileFromBackground() {
  try {
    const response = await browser.runtime.sendMessage({ getRandomProfile: true });
    if (response && response.profile) {
      // Set userAgent and platform from the background
      randomProfile.navigatorUserAgent = response.profile["navigator.userAgent"];
      randomProfile.navigatorPlatform = response.profile["navigator.platform"];
      console.log("Random profile retrieved from background.js:", randomProfile);
      return randomProfile;
    } else {
      throw new Error('No profile received from background.js');
    }
  } catch (error) {
    console.error("Failed to get random profile from background.js:", error);
    throw error;
  }
}

// Function to get the current mode from the background script
async function getCurrentMode() {
  try {
    const response = await browser.runtime.sendMessage({ getMode: true });
    console.log("Applied Mode is " + response.mode);
    return response.mode;
  } catch (error) {
    console.error("Failed to get current mode:", error);
    throw error;
  }
}

// Function to retrieve entropy data from local storage
async function getEntropyData() {
  try {
    const data = await browser.storage.local.get('entropyData');
    if (data.entropyData) {
      entropies = data.entropyData;
      console.log("Entropy data retrieved:", entropies);
    } else {
      throw new Error('Failed to get entropy data from local storage');
    }
  } catch (error) {
    console.error("Error retrieving entropy data:", error);
    throw error;
  }
}

// Function to request entropy threshold from the background script
async function requestEntropyThreshold() {
  try {
    const response = await browser.runtime.sendMessage({ getEntropyThreshold: true });
    if (response && response.threshold !== undefined) {
      entropyThreshold = response.threshold;
      console.log("Entropy threshold received:", entropyThreshold);
    } else {
      throw new Error('Failed to get entropy threshold');
    }
  } catch (error) {
    console.error("Error requesting entropy threshold:", error);
    throw error;
  }
}

// Inject a script that stops the execution of the entire script when a threshold is exceeded
function blockScriptExecution(scriptSource) {
  console.log('Attempting to block script:', scriptSource);
  const scriptContent = `
    (function() {
      const scripts = document.getElementsByTagName('script');
      for (let script of scripts) {
        if (script.src === "${scriptSource}") {
          console.log('Blocking script due to exceeded entropy threshold:', script.src);
          script.parentNode.removeChild(script);  // Remove the script element to stop it from running
        }
      }
    })();
  `;
  const script = document.createElement('script');
  script.textContent = scriptContent;
  document.documentElement.appendChild(script);
  // Delay removal to ensure execution
  setTimeout(() => {
    script.remove();
  }, 1000);
  console.log('Block script injected for:', scriptSource);
}

// Function to inject the monitoring script and randomize properties
function injectMonitoringScript(threshold, entropies, mode) {
  console.log("Injecting monitoring script with threshold:", threshold, "and mode:", mode);
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
        return 0.83; // Default entropy if not found in the database
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

          allowAccess = vectorEntropy <= entropyThreshold;

          if (!allowAccess && !scriptsExceedingThreshold.has(scriptSource)) {
            scriptsExceedingThreshold.add(scriptSource);
            window.postMessage({
              type: 'SCRIPT_EXCEEDS_THRESHOLD',
              data: { scriptSource: scriptSource, entropy: vectorEntropy }
            }, '*');
            return false;  // Block the access immediately
          }

          window.postMessage({
            type: 'FP_LOG',
            data: { lastAttribute: attribute, vector: attributes.join("|"), scriptSource, webpage: window.location.href, timestamp: new Date().toISOString() }
          }, '*');

          if (!allowAccess && "${mode}" === 'random') {
            console.log('Randomizing access for attribute:', attribute, 'in random mode due to entropy exceeding threshold');
            return true; // Randomize value
          } else if (!allowAccess) {
            console.log('Blocking script due to exceeded entropy threshold');
            return false; // Block the access
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
              console.error(`Error hooking property ${prop} of ${objName}:`, error);
            }
          }
        }
      }

      // Hook storage.estimate to randomize quota
      if (navigator.storage && navigator.storage.estimate) {
        hookMethod(navigator.storage, 'estimate', 'navigator.storage.estimate');
      }

      // Hook required properties
      hookAllProperties(screen, 'screen');
      hookAllProperties(navigator, 'navigator');
      hookProperty(HTMLCanvasElement.prototype, 'toDataURL', 'HTMLCanvasElement');
      hookProperty(history, 'length', 'history');

      // Fix WebGLShaderPrecisionFormat issues
      hookProperty(WebGLShaderPrecisionFormat.prototype, 'precision', 'WebGLShaderPrecisionFormat');
      hookProperty(WebGLShaderPrecisionFormat.prototype, 'rangeMax', 'WebGLShaderPrecisionFormat');
      hookProperty(WebGLShaderPrecisionFormat.prototype, 'rangeMin', 'WebGLShaderPrecisionFormat');

      if (window.WebGLRenderingContext) {
        hookAllPropertieswebgl(WebGLRenderingContext, 'WebGLRenderingContext');
      }
      if (window.WebGL2RenderingContext) {
        hookAllPropertieswebgl(WebGL2RenderingContext, 'WebGL2RenderingContext');
      }

      // Hook Fonts
      hookProperty(document, 'fonts', 'document');

      // Hook HTMLElement.offsetHeight and offsetWidth
      hookProperty(HTMLElement.prototype, 'offsetHeight', 'HTMLElement');
      hookProperty(HTMLElement.prototype, 'offsetWidth', 'HTMLElement');

      // Hook AudioContext properties
      if (window.AudioContext) {
        hookProperty(AudioContext.prototype, 'baseLatency', 'AudioContext');
        hookProperty(AudioContext.prototype, 'outputLatency', 'AudioContext');
      }

      if (window.AudioDestinationNode) {
        hookProperty(AudioDestinationNode.prototype, 'maxChannelCount', 'AudioDestinationNode');
      }

    })();
  `;

  const script = document.createElement('script');
  script.textContent = scriptContent;
  document.documentElement.appendChild(script);
  // Delay removal to ensure execution
  setTimeout(() => {
    script.remove();
  }, 1000);
  console.log("Monitoring script injected.");
}

// Main function to orchestrate the order of execution
async function main() {
  try {
    await getEntropyData();
    const mode = await getCurrentMode();
    await requestEntropyThreshold();

    // Get userAgent and platform from background.js and generate rest in content.js
    await getRandomProfileFromBackground();

    // Generate other randomized values in content.js for WebGL, screen, etc.
    const generatedProfile = generateRandomProfile();
    randomProfile = { ...randomProfile, ...generatedProfile };
    console.log("Complete random profile:", randomProfile);

    injectMonitoringScript(entropyThreshold, entropies, mode);
    console.log("Monitoring script injected successfully.");
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
    "Permissions.state": "granted",
    "HTMLElement.offsetHeight": Math.floor(Math.random() * 1000) + 300,
    "HTMLElement.offsetWidth": Math.floor(Math.random() * 1000) + 300,
    "navigator.language": generateRandomLanguage(),
    "navigator.languages": generateRandomLanguages(),
    "navigator.plugins": generateRandomPlugins(),
    "WebGLRenderingContext.UNMASKED_RENDERER_WEBGL": generateRandomWebGLRenderer(),
    "WebGLRenderingContext.UNMASKED_VENDOR_WEBGL": generateRandomWebGLVendor(),
    "fonts": generateRandomFonts(),
    "AudioContext.sampleRate": Math.floor(Math.random() * (48000 - 44100 + 1)) + 44100,
    "AudioContext.baseLatency": Math.random().toFixed(5),
    "screen.availHeight": Math.floor(Math.random() * (1080 - 768 + 1)) + 768,
    "screen.availWidth": Math.floor(Math.random() * (1920 - 1024 + 1)) + 1024,
    "history.length": Math.floor(Math.random() * 50) + 1,
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
  if (!event.data || !event.data.type) return;

  if (event.data.type === 'FP_LOG') {
    logs.push(event.data.data);
    console.log('FP_LOG received:', event.data.data);
  } else if (event.data.type === 'SCRIPT_EXCEEDS_THRESHOLD') {
    const { scriptSource, entropy } = event.data.data;
    console.log(`Script exceeded entropy threshold: ${scriptSource} with entropy ${entropy}`);
    incrementExceedingScriptCount(scriptSource);
    blockScriptExecution(scriptSource);  // Block script execution once it exceeds threshold
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
    console.log(`Updating script counts:`, scriptCounts);
    browser.runtime.sendMessage({ action: "updateScriptCounts", counts: scriptCounts })
      .catch(error => console.error("Error updating script counts:", error));
  }
}

// Listen for messages from the popup
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "applyRandomProfile") {
    applyRandomProfile();
  } else if (message.action === "applyEntropyBlocking") {
    entropyThreshold = message.threshold;
    console.log("Applying entropy blocking with threshold:", entropyThreshold);
    injectMonitoringScript(entropyThreshold, entropies, "entropy");
  } else if (message.action === "getScriptCounts") {
    sendResponse({ counts: scriptCounts });
  } else if (message.action === "getLogs") {
    sendResponse({ logs: logs.map(log => `${log.timestamp} - ${log.lastAttribute} : ${log.scriptSource} : ${log.webpage}`).join('\n') });
  }
});

// Function to apply a random profile (triggered by popup)
function applyRandomProfile() {
  console.log("Applying random profile");
  const generatedProfile = generateRandomProfile();
  randomProfile = { ...randomProfile, ...generatedProfile };
  console.log("Random profile applied:", randomProfile);
  injectMonitoringScript(entropyThreshold, entropies, "random");
}

// Main execution
main();
