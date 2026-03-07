// background.js

let isRunning = false;
let currentGoal = '';
let geminiTabId = null;
let targetTabId = null;

// Helper to send logs to sidepanel
function log(text, level = 'info') {
  console.log(`[${level.toUpperCase()}] ${text}`);
  chrome.runtime.sendMessage({ type: 'LOG', text, level }).catch(() => {});
}

// Ensure Side Panel opens when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_AGENT') {
    isRunning = true;
    currentGoal = message.goal;
    chrome.storage.local.set({ isRunning: true, goal: currentGoal });
    log(`Background received start command. Goal: ${currentGoal}`);

    // Begin main execution loop
    startExecutionLoop();
    sendResponse({ status: 'started' });
  } else if (message.type === 'STOP_AGENT') {
    isRunning = false;
    chrome.storage.local.set({ isRunning: false });
    log('Background received stop command.');
    sendResponse({ status: 'stopped' });
  } else if (message.type === 'GEMINI_RESPONSE') {
    // Handled in the execution loop Promise
    log('Received response from Gemini.', 'info');
  } else if (message.type === 'PAGE_CONTEXT') {
    // Handled in the execution loop Promise
    log('Received page context.', 'info');
  }
  return true;
});

async function startExecutionLoop() {
  try {
    // 1. Ensure Gemini Tab is open
    geminiTabId = await ensureGeminiTab();
    if (!geminiTabId) {
      log('Could not find or open Gemini tab.', 'error');
      stopAgent();
      return;
    }

    // 2. Identify the target tab (active tab in the current window)
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      log('No active tab found to automate.', 'error');
      stopAgent();
      return;
    }
    targetTabId = tabs[0].id;
    log(`Target tab identified: ${tabs[0].url}`, 'info');

    // Main execution loop
    while (isRunning) {
      log('--- Starting new reasoning cycle ---', 'info');

      // A. Get Page Context
      log('Extracting page context...', 'info');

      let targetTab = null;
      try {
        targetTab = await chrome.tabs.get(targetTabId);
      } catch (e) {
        log('Target tab closed. Finding new active tab...', 'error');
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0) targetTabId = tabs[0].id;
        else {
           stopAgent();
           return;
        }
        targetTab = await chrome.tabs.get(targetTabId);
      }

      if (targetTab.status === 'loading') {
        log('Target page is still loading. Waiting 3s...', 'info');
        await sleep(3000);
        continue;
      }

      let pageContext = null;
      if (targetTab.url.startsWith('chrome://') || targetTab.url.startsWith('about:') || targetTab.url.startsWith('edge://')) {
        log('Cannot scrape restricted browser pages.', 'error');
        pageContext = `--- Visible Page Text snippet ---\nYou are currently on a restricted browser page (${targetTab.url}). You cannot click or type here. You MUST use the "navigate" action to go to a valid website (e.g. "https://www.google.com" or "https://www.linkedin.com") to proceed with the goal.`;
      } else {
         pageContext = await getPageContext(targetTabId);
      }

      if (!pageContext) {
        log('Failed to extract page context. Waiting 5s before retry...', 'error');
        await sleep(5000);
        continue;
      }
      log(`Extracted context: ${pageContext.substring(0, 100)}...`, 'info');

      // B. Ask Gemini
      log('Sending context to Gemini...', 'action');
      const prompt = buildPrompt(currentGoal, pageContext);
      const geminiResponse = await askGemini(geminiTabId, prompt);

      if (!isRunning) break;
      if (!geminiResponse) {
        log('Failed to get Gemini response. Retrying...', 'error');
        await sleep(5000);
        continue;
      }

      log(`Gemini raw response: ${geminiResponse}`, 'info');

      // C. Parse Action
      const action = parseGeminiResponse(geminiResponse);
      if (!action) {
        log('Failed to parse a valid JSON action from Gemini. Retrying...', 'error');
        await sleep(2000);
        continue;
      }
      log(`Parsed Action: ${JSON.stringify(action)}`, 'action');

      if (action.action === 'done') {
        log('Gemini decided the goal is complete.', 'action');
        stopAgent();
        break;
      }

      // D. Execute Action
      log(`Executing action: ${action.action}...`, 'info');
      const executeResult = await executeAction(targetTabId, action);
      if (executeResult && executeResult.status === 'success') {
         log('Action executed successfully.', 'info');
      } else {
         log(`Action failed: ${executeResult ? executeResult.error : 'Unknown'}`, 'error');
      }

      // Wait a moment for page to load/update before next cycle
      log('Waiting 3 seconds for page updates...', 'info');
      await sleep(3000);
    }
  } catch (error) {
    log(`Execution loop error: ${error.message}`, 'error');
    stopAgent();
  }
}

function stopAgent() {
  isRunning = false;
  chrome.storage.local.set({ isRunning: false });
  chrome.runtime.sendMessage({ type: 'AGENT_STOPPED' }).catch(() => {});
}

async function ensureGeminiTab() {
  const tabs = await chrome.tabs.query({ url: '*://gemini.google.com/*' });
  if (tabs.length > 0) {
    log('Found existing Gemini tab.', 'info');
    return tabs[0].id;
  }
  log('Opening new pinned Gemini tab.', 'info');
  const newTab = await chrome.tabs.create({ url: 'https://gemini.google.com/app', pinned: true, active: false });
  // Wait for it to load
  await sleep(5000);
  return newTab.id;
}

function getPageContext(tabId) {
  return new Promise((resolve) => {
    // Send a message to content.js to extract DOM
    chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_CONTEXT' }, (response) => {
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message;
        log(`Error communicating with target page: ${errorMsg}`, 'error');

        // If the content script is missing, try to inject it
        if (errorMsg.includes('Receiving end does not exist')) {
            log('Content script missing. Injecting now...', 'info');
            chrome.scripting.executeScript({
               target: { tabId: tabId },
               files: ['content.js']
            }).then(() => {
               // Wait a moment for script to initialize
               setTimeout(() => {
                 chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_CONTEXT' }, (retryResponse) => {
                    if (chrome.runtime.lastError) resolve(null);
                    else resolve(retryResponse ? retryResponse.context : null);
                 });
               }, 1000);
            }).catch((err) => {
               log(`Injection failed: ${err.message}`, 'error');
               resolve(null);
            });
        } else {
            resolve(null);
        }
      } else if (response && response.context) {
        resolve(response.context);
      } else {
        resolve(null);
      }
    });
  });
}

function buildPrompt(goal, pageContext) {
  return `You are an autonomous web browsing agent.
Your goal is: "${goal}"

Here is the current state of the webpage, represented as text and a list of interactive elements. Each interactive element has a unique ID in brackets like [ID].

Current Webpage Context:
---
${pageContext}
---

Based on the goal and the current webpage, decide the next single action to take.
You MUST output your response as a valid JSON object ONLY, with no markdown formatting like \`\`\`json.

Available actions format:
1. Click an element: {"action": "click", "id": <number>}
2. Type text into an element: {"action": "type", "id": <number>, "text": "<string>"}
3. Navigate to a new URL: {"action": "navigate", "url": "<string>"}
4. Finish task: {"action": "done", "reason": "<string>"}

Example output:
{"action": "click", "id": 5}

What is your next action JSON?`;
}

function askGemini(tabId, prompt) {
  return new Promise((resolve) => {
    log('Sending prompt to Gemini content script...', 'info');

    const sendPrompt = () => {
      chrome.tabs.sendMessage(tabId, { type: 'SEND_PROMPT', prompt }, (response) => {
        if (chrome.runtime.lastError) {
           const errorMsg = chrome.runtime.lastError.message;
           log(`Error communicating with Gemini tab: ${errorMsg}`, 'error');

           // If the content script is missing, try to inject it
           if (errorMsg.includes('Receiving end does not exist')) {
              log('Gemini script missing. Injecting now...', 'info');
              chrome.scripting.executeScript({
                 target: { tabId: tabId },
                 files: ['gemini.js']
              }).then(() => {
                 setTimeout(() => {
                   chrome.tabs.sendMessage(tabId, { type: 'SEND_PROMPT', prompt }, handleResponse);
                 }, 1000);
              }).catch((err) => {
                 log(`Gemini injection failed: ${err.message}`, 'error');
                 resolve(null);
              });
           } else {
              resolve(null);
           }
           return;
        }

        handleResponse(response);
      });
    };

    const handleResponse = (response) => {
        if (chrome.runtime.lastError) {
            log(`Error in Gemini retry: ${chrome.runtime.lastError.message}`, 'error');
            resolve(null);
            return;
        }

        if (response && response.status === 'sent') {
           const listener = (message) => {
             if (message.type === 'GEMINI_RESPONSE') {
               chrome.runtime.onMessage.removeListener(listener);
               resolve(message.text);
             }
           };
           chrome.runtime.onMessage.addListener(listener);

           setTimeout(() => {
             chrome.runtime.onMessage.removeListener(listener);
             log('Timeout waiting for Gemini response', 'error');
             resolve(null);
           }, 65000);
        } else {
           const errMsg = response && response.error ? response.error : (response && response.status ? response.status : 'Unknown error');
           log(`Failed to send prompt to Gemini UI: ${errMsg}`, 'error');
           resolve(null);
        }
    };

    sendPrompt();
  });
}

function parseGeminiResponse(responseText) {
  try {
    // Try to extract JSON from markdown if Gemini wraps it
    let jsonStr = responseText;
    const match = responseText.match(/```json\n([\s\S]*?)\n```/);
    if (match) {
      jsonStr = match[1];
    } else {
      const match2 = responseText.match(/```\n([\s\S]*?)\n```/);
      if (match2) jsonStr = match2[1];
    }

    // Sometimes it just outputs `{...}` without markdown. Try to find first { and last }
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
       jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
    }

    const action = JSON.parse(jsonStr);
    if (action.action) return action;
  } catch (e) {
    console.error('JSON Parse Error', e, responseText);
    return null;
  }
  return null;
}

function executeAction(tabId, action) {
  return new Promise((resolve) => {
    if (action.action === 'navigate' && action.url) {
      chrome.tabs.update(tabId, { url: action.url }, () => {
         if (chrome.runtime.lastError) {
           log(`Navigate Action Error: ${chrome.runtime.lastError.message}`, 'error');
         }
         resolve({ status: 'success' });
      });
      return;
    }

    chrome.tabs.sendMessage(tabId, { type: 'EXECUTE_ACTION', action }, (response) => {
      if (chrome.runtime.lastError) {
        log(`Execute Action Error: ${chrome.runtime.lastError.message}`, 'error');
        // If the context was invalidated (e.g. navigation occurred), just resolve success
        resolve({ status: 'success' });
      } else {
        resolve(response || { status: 'success' });
      }
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
