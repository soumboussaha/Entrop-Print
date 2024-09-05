console.log("Content script loaded successfully!");

let entropyThreshold;
let entropies = {};
let scriptCounts = { total: 0, firstParty: 0, thirdParty: 0 };
let logs = [];
let uniqueScripts = new Set();

function getCurrentMode() {
    return new Promise((resolve) => {
      browser.runtime.sendMessage({ getMode: true }, response => {
        resolve(response.mode);
      });
    });
  }
  
// Function to request entropy threshold from the background script
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
function injectMonitoringScript(threshold, entropies) {
  const scriptContent = `
    (function() {
      let entropyValues = ${JSON.stringify(entropies)};
      let entropyThreshold = ${threshold};
      let attributeAccessData = {};

      function calculateVectorEntropy(attributes,scriptSource) {
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
        return 0.99;
      }

      function logNewVector(attribute, vector, scriptSource) {
        const logEntry = \`\${new Date().toISOString()} - Last accessed attribute: \${attribute} in vector: \${vector} : \${scriptSource}\\n\`;
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
          const vectorEntropy = calculateVectorEntropy(attributes,scriptSource);
          allowAccess = vectorEntropy <= entropyThreshold;

          window.postMessage({
            type: 'FP_LOG',
            data: { lastAttribute: attribute, vector: attributes.join("|"), scriptSource, webpage: window.location.href, timestamp: new Date().toISOString() }
          }, '*');

          if (allowAccess) {
            return true;
          } else {
            logNewVector(attribute, attributes.join("|"), scriptSource);
            return false;
          }
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
              return originalValue;
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
                        return originalGetter.call(this);
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
    if (mode === 'entropy') {
      injectMonitoringScript(entropyThreshold, entropies);
    } else if (mode === 'random') {
      applyRandomProfile();
    }
  } catch (error) {
    console.error('Error in main function:', error);
  }
}

function applyRandomProfile() {
    // Implement your random profile logic here
    console.log("Applying random profile");
    // For example:
    const randomProfile = generateRandomProfile();
    injectRandomProfileScript(randomProfile);
  }
  
  function generateRandomProfile() {
    // Generate and return a random profile
    // This is just an example,we adjust according to needs
    return {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      screenWidth: Math.floor(Math.random() * (1920 - 1024 + 1)) + 1024,
      screenHeight: Math.floor(Math.random() * (1080 - 768 + 1)) + 768,
      // Add more properties as needed
    };
  }
  
  function injectRandomProfileScript(profile) {
    const scriptContent = `
      (function() {
        // Override properties with random profile
        Object.defineProperty(screen, 'width', { value: ${profile.screenWidth} });
        Object.defineProperty(screen, 'height', { value: ${profile.screenHeight} });
        Object.defineProperty(navigator, 'userAgent', { value: "${profile.userAgent}" });
        // Add more property overrides as needed
      })();
    `;
    const script = document.createElement('script');
    script.textContent = scriptContent;
    document.documentElement.appendChild(script);
    script.remove();
  }

// Listen for messages from the injected script
window.addEventListener('message', function(event) {
  if (event.data.type === 'FP_LOG') {
    logs.push(event.data.data);
    updateScriptCounts(event.data.data.scriptSource);
  }
});

// Function to update script counts
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
