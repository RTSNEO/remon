document.addEventListener('DOMContentLoaded', () => {
  const goalInput = document.getElementById('goalInput');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const logArea = document.getElementById('logArea');
  const statusText = document.getElementById('statusText');

  // Load previous state
  chrome.storage.local.get(['isRunning', 'goal', 'logs'], (data) => {
    if (data.goal) goalInput.value = data.goal;
    if (data.isRunning) {
      setRunningState(true);
    }
    if (data.logs) {
      logArea.innerHTML = data.logs;
      logArea.scrollTop = logArea.scrollHeight;
    }
  });

  function log(message, type = 'info') {
    const p = document.createElement('div');
    const time = new Date().toLocaleTimeString();
    p.textContent = `[${time}] ${message}`;
    p.style.color = type === 'error' ? 'red' : (type === 'action' ? 'green' : 'black');
    p.style.marginBottom = '4px';
    logArea.appendChild(p);
    logArea.scrollTop = logArea.scrollHeight;

    // Save logs to storage
    chrome.storage.local.set({ logs: logArea.innerHTML });
  }

  function setRunningState(isRunning) {
    startBtn.disabled = isRunning;
    stopBtn.disabled = !isRunning;
    goalInput.disabled = isRunning;
    statusText.textContent = isRunning ? 'Status: Running...' : 'Status: Idle';
    chrome.storage.local.set({ isRunning });
  }

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