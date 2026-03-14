document.addEventListener('DOMContentLoaded', () => {
  const goalInput = document.getElementById('goalInput');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const logArea = document.getElementById('logArea');
  const statusText = document.getElementById('statusText');
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  const copyLogsBtn = document.getElementById('copyLogsBtn');

  let logEntries = [];

  // Load previous state
  chrome.storage.local.get(['isRunning', 'goal', 'logEntries', 'cvFileName', 'cvContent'], (data) => {
    if (data.goal) goalInput.value = data.goal;
    if (data.isRunning) {
      setRunningState(true);
    }
    if (data.logEntries) {
      logEntries = data.logEntries;
      reconstructLogs();
    }
    if (data.cvFileName && data.cvContent) {
      setCvStatus(data.cvFileName, true);
    }
  });

  function reconstructLogs() {
    logArea.innerHTML = '';
    logEntries.forEach(entry => {
      renderLogEntry(entry);
    });
    logArea.scrollTop = logArea.scrollHeight;
  }

  function renderLogEntry(entry) {
    const p = document.createElement('div');
    p.textContent = `[${entry.time}] ${entry.message}`;
    
    // Use classes for colors to support dark mode
    if (entry.type === 'error') p.style.color = 'var(--error-red)';
    else if (entry.type === 'action') p.style.color = 'var(--success-green)';
    else p.style.color = 'var(--text-color)';
    
    p.style.marginBottom = '4px';
    logArea.appendChild(p);
  }

  function log(message, type = 'info') {
    const time = new Date().toLocaleTimeString();
    const entry = { message, type, time };
    logEntries.push(entry);

    renderLogEntry(entry);
    logArea.scrollTop = logArea.scrollHeight;

    // Save logs to storage
    chrome.storage.local.set({ logEntries });
  }

  function setRunningState(isRunning) {
    startBtn.disabled = isRunning;
    stopBtn.disabled = !isRunning;
    goalInput.disabled = isRunning;
    statusText.textContent = isRunning ? 'Status: Running...' : 'Status: Idle';
    statusText.className = isRunning ? 'status running' : 'status';
    chrome.storage.local.set({ isRunning });
  }

  // --- CV Upload ---
  const cvUploadBtn = document.getElementById('cvUploadBtn');
  const cvFileInput = document.getElementById('cvFileInput');
  const cvStatus   = document.getElementById('cvStatus');
  const cvClearBtn = document.getElementById('cvClearBtn');

  function setCvStatus(filename, loaded) {
    if (loaded) {
      cvStatus.textContent = '✔ ' + filename;
      cvStatus.className = 'loaded';
      cvClearBtn.style.display = 'block';
    } else {
      cvStatus.textContent = 'No file loaded';
      cvStatus.className = '';
      cvClearBtn.style.display = 'none';
    }
  }

  cvUploadBtn.addEventListener('click', () => {
    cvFileInput.value = ''; // reset so same file can be re-selected
    cvFileInput.click();
  });

  cvFileInput.addEventListener('change', () => {
    const file = cvFileInput.files[0];
    if (!file) return;

    const reader = new FileReader();

    if (file.name.endsWith('.pdf')) {
      // Store raw PDF as base64 data URL — Gemini's multimodal model can read PDFs natively,
      // so we upload the actual file as an attachment rather than trying to parse compressed binary.
      reader.readAsDataURL(file);
      reader.onload = (e) => {
        const dataUrl = e.target.result; // "data:application/pdf;base64,..."
        chrome.storage.local.set({ cvContent: dataUrl, cvFileName: file.name, cvIsPdf: true }, () => {
          setCvStatus(file.name, true);
          log(`CV loaded: ${file.name} (PDF — will be sent to Gemini as file attachment)`);
        });
      };
    } else {
      // Plain text
      reader.readAsText(file);
      reader.onload = (e) => {
        const text = e.target.result.substring(0, 8000);
        chrome.storage.local.set({ cvContent: text, cvFileName: file.name }, () => {
          setCvStatus(file.name, true);
          log(`CV loaded: ${file.name} (${text.length} chars)`);
        });
      };
    }

    reader.onerror = () => log('Failed to read CV file.', 'error');
  });

  cvClearBtn.addEventListener('click', () => {
    chrome.storage.local.remove(['cvContent', 'cvFileName'], () => {
      setCvStatus('', false);
      log('CV cleared.');
    });
  });
  // --- End CV Upload ---

  startBtn.addEventListener('click', () => {
    const goal = goalInput.value.trim();
    if (!goal) {
      log('Please enter a goal first.', 'error');
      return;
    }

    setRunningState(true);
    chrome.storage.local.set({ goal });
    log(`Starting agent with goal: "${goal}"`, 'action');

    // Send message to background script to start
    chrome.runtime.sendMessage({ type: 'START_AGENT', goal }, (response) => {
      if (chrome.runtime.lastError) {
        log(`Error: ${chrome.runtime.lastError.message}`, 'error');
        setRunningState(false);
      } else if (response && response.status === 'started') {
         log('Agent loop initiated successfully.');
      }
    });
  });

  stopBtn.addEventListener('click', () => {
    setRunningState(false);
    log('Stopping agent...', 'action');

    // Send message to background script to stop
    chrome.runtime.sendMessage({ type: 'STOP_AGENT' }, (response) => {
      if (chrome.runtime.lastError) {
        log(`Error: ${chrome.runtime.lastError.message}`, 'error');
      } else {
        log('Agent stopped.');
      }
    });
  });

  clearLogsBtn.addEventListener('click', () => {
    logArea.innerHTML = '';
    logEntries = [];
    chrome.storage.local.set({ logEntries: [] });
  });

  copyLogsBtn.addEventListener('click', () => {
    const textToCopy = Array.from(logArea.children).map(child => child.textContent).join('\n');
    navigator.clipboard.writeText(textToCopy).then(() => {
      const originalText = copyLogsBtn.textContent;
      copyLogsBtn.textContent = 'Copied!';
      setTimeout(() => { copyLogsBtn.textContent = originalText; }, 2000);
    }).catch(err => {
      log(`Failed to copy logs: ${err}`, 'error');
    });
  });

  // Listen for logs and status updates from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'LOG') {
      log(message.text, message.level);
    } else if (message.type === 'AGENT_STOPPED') {
      setRunningState(false);
      log('Agent finished/stopped via background process.', 'info');
    }
  });
});