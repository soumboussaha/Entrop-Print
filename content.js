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

// Function to inject the monitoring script
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

          // Log the entropy of the accessed vector
          logNewVector(attribute, attributes.join("|"), scriptSource, vectorEntropy);

          allowAccess = vectorEntropy <= entropyThreshold;

          if (!allowAccess && !scriptsExceedingThreshold.has(scriptSource)) {
            scriptsExceedingThreshold.add(scriptSource);
            updateScriptCounts(scriptSource);
          }

          window.postMessage({
            type: 'FP_LOG',
            data: { lastAttribute: attribute, vector: attributes.join("|"), scriptSource, webpage: window.location.href, timestamp: new Date().toISOString() }
          }, '*');

          // Randomize only if the entropy threshold is exceeded
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
                // In random mode, return a dynamic value from the random profile if entropy exceeds threshold
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
      hookProperty(WebGLShaderPrecisionFormat.prototype, 'precision', 'WebGLShaderPrecisionFormat');
      hookProperty(WebGLShaderPrecisionFormat.prototype, 'rangeMax', 'WebGLShaderPrecisionFormat');
      hookProperty(WebGLShaderPrecisionFormat.prototype, 'rangeMin', 'WebGLShaderPrecisionFormat');

      if (window.WebGLRenderingContext) {
        hookAllPropertieswebgl(WebGLRenderingContext, 'WebGLRenderingContext');
      }
      if (window.WebGL2RenderingContext) {
        hookAllPropertieswebgl(WebGL2RenderingContext, 'WebGL2RenderingContext');
      }

      // Hook newly requested attributes
      hookProperty(storage, 'quota', 'storage');
      if (window.Permissions) {
        hookProperty(Permissions.prototype, 'state', 'Permissions');
      }
      hookProperty(HTMLElement.prototype, 'offsetHeight', 'HTMLElement');
      hookProperty(HTMLElement.prototype, 'offsetWidth', 'HTMLElement');

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
    }
    
    injectMonitoringScript(entropyThreshold, entropies, mode);
  } catch (error) {
    console.error('Error in main function:', error);
  }
}

// Random profile generation for WebGL, plugins, platform, userAgent, and languages
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

// Listen for messages from the injected script
window.addEventListener('message', function(event) {
  if (event.data.type === 'FP_LOG') {
    logs.push(event.data.data);
    updateScriptCounts(event.data.data.scriptSource);
  }
});

// Function to update script counts only when the entropy threshold is exceeded
function updateScriptCounts(scriptSource) {
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

