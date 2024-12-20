// popup.js

document.addEventListener('DOMContentLoaded', function() {
  const entropySlider = document.getElementById('entropy-slider');
  const entropyValue = document.getElementById('entropy-value');
  const randomProfileBtn = document.getElementById('random-profile');
  const entropyBlockingBtn = document.getElementById('entropy-blocking-option');
  const entropyControls = document.getElementById('entropy-controls');
  const downloadLogsBtn = document.getElementById('download-logs');
  const totalScripts = document.getElementById('total-scripts');
  const firstPartyScripts = document.getElementById('first-party-scripts');
  const thirdPartyScripts = document.getElementById('third-party-scripts');

  // Initialize entropy threshold
  let currentThreshold = 0.832;

  // Function to update entropy threshold
  function updateEntropyThreshold(value) {
    currentThreshold = parseFloat(value); // Ensure it's a number
    let blockingLevel = "High";
    if (value < 0.442) blockingLevel = "Negligible";
    else if (value < 0.596) blockingLevel = "Low";
    else if (value < 0.705) blockingLevel = "Medium";
    else if (value < 0.832) blockingLevel = "High";
    else blockingLevel = "Very High";

    entropyValue.textContent = `Blocking Level: ${value} - ${blockingLevel}`;
    browser.runtime.sendMessage({ setEntropyThreshold: currentThreshold });
  }

  // Entropy slider event listener
  entropySlider.addEventListener('input', function() {
    updateEntropyThreshold(this.value);
  });

  // Random Profile button click handler
  randomProfileBtn.addEventListener('click', function() {
    entropyControls.style.display = 'block';
    console.log('Random Profile selected');
    browser.runtime.sendMessage({ setMode: 'random' });
    applyToAllTabs('applyRandomProfile');
  });

  // Entropy Blocking Option button click handler
  entropyBlockingBtn.addEventListener('click', function() {
    entropyControls.style.display = 'block';
    browser.runtime.sendMessage({ setMode: 'entropy' });
    applyToAllTabs('applyEntropyBlocking', { threshold: currentThreshold });
  });

  function applyToAllTabs(action, data = {}) {
    browser.tabs.query({}, function(tabs) {
      tabs.forEach(tab => {
        browser.tabs.sendMessage(tab.id, { action, ...data });
      });
    });
  }

  // Download Logs button click handler
  downloadLogsBtn.addEventListener('click', function() {
    // Request logs from content script
    browser.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs.length === 0) {
        console.error("No active tab found.");
        return;
      }

      browser.tabs.sendMessage(tabs[0].id, {action: "getLogs"}, function(response) {
        if (browser.runtime.lastError) {
          console.error("Error sending message to content script:", browser.runtime.lastError);
          return;
        }

        if (response && response.logs) {
          // Create and download the log file
          const blob = new Blob([response.logs], {type: 'text/plain'});
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'fingerprinting_logs.txt';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          console.log("Logs downloaded successfully.");
        } else {
          console.error("No logs received from content script.");
        }
      });
    });
  });

  // Function to update script counts
  function updateScriptCounts(counts) {
    totalScripts.textContent = counts.total;
    firstPartyScripts.textContent = counts.firstParty;
    thirdPartyScripts.textContent = counts.thirdParty;
  }

  // Request initial script counts from content script
  browser.tabs.query({active: true, currentWindow: true}, function(tabs) {
    if (tabs.length === 0) {
      console.error("No active tab found.");
      return;
    }

    browser.tabs.sendMessage(tabs[0].id, {action: "getScriptCounts"}, function(response) {
      if (browser.runtime.lastError) {
        console.error("Error sending message to content script:", browser.runtime.lastError);
        return;
      }

      if (response && response.counts) {
        updateScriptCounts(response.counts);
      } else {
        console.error("No script counts received from content script.");
      }
    });
  });

  // Request initial entropy threshold and mode from background script
  browser.runtime.sendMessage({ getEntropyThreshold: true }, function(response) {
    if (browser.runtime.lastError) {
      console.error("Error sending message to background script:", browser.runtime.lastError);
      return;
    }

    if (response && response.threshold !== undefined) {
      currentThreshold = parseFloat(response.threshold);
      entropySlider.value = currentThreshold;
      entropyValue.textContent = `Entropy Threshold: ${currentThreshold}`;
    } else {
      console.error("No entropy threshold received from background script.");
    }
  });

  browser.runtime.sendMessage({ getMode: true }, function(response) {
    if (browser.runtime.lastError) {
      console.error("Error sending message to background script:", browser.runtime.lastError);
      return;
    }

    if (response && response.mode) {
      if (response.mode === 'random' || response.mode === 'entropy') {
        entropyControls.style.display = 'block';
      }
    }
  });

  // Listen for updates from content script
  browser.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === "updateScriptCounts") {
      updateScriptCounts(request.counts);
    }
  });
});
