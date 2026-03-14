// background.js

let isRunning = false;
let currentGoal = '';
let geminiTabId = null;
let targetTabId = null;
let cycleCount = 0; // Tracks cycles so system prompt is sent only on the first one
// Track active Gemini listener + timeout to prevent stale accumulation
let currentGeminiListener = null;
let currentGeminiTimeout = null;

// Helper to send logs to sidepanel
function log(text, level = 'info') {
  console.log(`[${level.toUpperCase()}] ${text}`);
  chrome.runtime.sendMessage({ type: 'LOG', text, level }).catch(() => {
    /* Ignore error if sidepanel is closed */
  });
}

// Ensure Side Panel opens when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));

let creatingOffscreen;
async function setupOffscreenDocument() {
  const path = 'offscreen.html';
  if (await chrome.offscreen.hasDocument()) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
  } else {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: path,
      reasons: ['DOM_PARSER'],
      justification: 'keep background service worker active',
    });
    await creatingOffscreen;
    creatingOffscreen = null;
  }
}

async function closeOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) {
    await chrome.offscreen.closeDocument();
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_AGENT') {
    isRunning = true;
    currentGoal = message.goal;
    chrome.storage.local.set({ isRunning: true, goal: currentGoal });
    log(`Background received start command. Goal: ${currentGoal}`);

    // Set up offscreen document to prevent service worker from going to sleep
    setupOffscreenDocument().catch(console.error);

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
  } else if (message.type === 'KEEPALIVE' || message.type === 'KEEPALIVE_PING') {
    // Keeps the Manifest V3 Service Worker alive during long tasks and from the offscreen document
  }
  return true;
});

async function startExecutionLoop() {
  try {
    // 1. Identify the target tab (active tab in the current window)
    // We must do this FIRST so we know what to switch back to if we open Gemini
    const initialTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    let foundTarget = false;
    for (const tab of initialTabs) {
       if (!tab.url.includes('gemini.google.com')) {
          targetTabId = tab.id;
          foundTarget = true;
          log(`Target tab identified: ${tab.url}`, 'info');
          break;
       }
    }

    if (!foundTarget) {
      log('Active tab is Gemini or invalid. Please click Start while on the website you want to automate.', 'error');
      stopAgent();
      return;
    }

    // 2. Ensure Gemini Tab is open
    geminiTabId = await ensureGeminiTab(targetTabId);
    if (!geminiTabId) {
      log('Could not find or open Gemini tab.', 'error');
      stopAgent();
      return;
    }

    // Main execution loop
    let recentActions = []; // Track recently clicked IDs to prevent infinite loops
    cycleCount = 0; // Reset so first cycle sends full system prompt

    while (isRunning) {
      log('--- Starting new reasoning cycle ---', 'info');

      // 0. Update Target Tab in case the last action spawned a new tab natively
      const currentActiveTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (currentActiveTabs.length > 0 && !currentActiveTabs[0].url.includes('gemini.google.com')) {
          targetTabId = currentActiveTabs[0].id;
      }

      // 1. Force target tab to foreground to un-throttle its JavaScript and extract a clean DOM
      //    (Background tabs fail document.elementFromPoint and visibility checks)
      await chrome.tabs.update(targetTabId, { active: true }).catch(() => {
        /* Ignore if tab is already closed */
      });
      await sleep(1000);

      // A. Get Page Context
      log('Extracting page context...', 'info');

      let targetTab = null;
      try {
        targetTab = await chrome.tabs.get(targetTabId);
      } catch (e) {
        log('Target tab closed. Finding new active tab...', 'error');
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        let newTarget = null;
        for (const t of tabs) {
          if (!t.url.includes('gemini.google.com')) {
            newTarget = t;
            break;
          }
        }

        if (newTarget) {
          targetTabId = newTarget.id;
          targetTab = newTarget;
        } else {
          log('No valid fallback tab found. Pausing...', 'error');
          await sleep(3000);
          continue;
        }
      }

      if (targetTab.status === 'loading') {
        log('Target page is still loading. Waiting...', 'info');
        while (targetTab.status === 'loading' && isRunning) {
          await sleep(500);
          try { targetTab = await chrome.tabs.get(targetTabId); } catch (e) { break; }
        }
        continue;
      }

      let pageContext = null;
      if (targetTab.url.startsWith('chrome://') || targetTab.url.startsWith('about:') || targetTab.url.startsWith('edge://') || targetTab.url.startsWith('chrome-extension://')) {
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

      // 1. Wait a tiny bit for the red markers to finish painting to the screen
      await sleep(300);

      // 2. Capture Screenshot of the Marked Page
      let imageData = null;
      if (!targetTab.url.startsWith('chrome://') && !targetTab.url.startsWith('chrome-extension://')) {
        try {
          log('Capturing marked screenshot...', 'info');
          imageData = await chrome.tabs.captureVisibleTab(targetTab.windowId, { format: 'jpeg', quality: 60 });
        } catch (err) {
          log(`Screenshot failed: ${err.message}`, 'error');
        }
      }

      // 3. Clean up the marks instantly so the user doesn't stare at them
      chrome.tabs.sendMessage(targetTabId, { type: 'UNMARK_ELEMENTS' }).catch(() => {
        /* Ignore if tab is closed or content script not responding */
      });

      // B. Keep Gemini completely in the background. Generating and messaging work fine intrinsically.
      await sleep(300);

      log('Sending context and screenshot to Gemini...', 'action');
      
      const antiLoopWarning = buildAntiLoopWarning(recentActions);

      // Load CV from storage (may be a PDF data URL or plain text)
      const { cvContent, cvIsPdf } = await new Promise(resolve =>
        chrome.storage.local.get(['cvContent', 'cvIsPdf'], resolve)
      );

      // Cycle 0: full system prompt + upload PDF as attachment to Gemini
      // Subsequent cycles: compact page map only (Gemini retains the PDF in its context window)
      const prompt = cycleCount === 0
        ? buildSystemPrompt(currentGoal, pageContext, antiLoopWarning, cvIsPdf ? '' : (cvContent || ''))
        : buildCyclePrompt(currentGoal, pageContext, antiLoopWarning, cvIsPdf ? '' : (cvContent || ''));

      // Only send PDF attachment on the FIRST cycle — Gemini keeps it in context thereafter
      const cvData = (cycleCount === 0 && cvIsPdf && cvContent) ? cvContent : null;
      cycleCount++;
      
      // Phase 1: Send prompt to Gemini. This activates Gemini tab briefly, types the prompt,
      // and resolves once the send button is clicked. Returns a waitForReply Promise for phase 2.
      const waitForReply = await askGeminiSend(geminiTabId, prompt, imageData, cvData);

      // Keep Gemini in the foreground while it generates — the target tab stays in background
      // so any modals/popups on it remain alive and undisturbed.

      // Phase 2: Wait for Gemini's response (Gemini generates in the background, no tab switch needed)
      const geminiResponse = await waitForReply;

      if (!isRunning) break;
      if (!geminiResponse) {
        log('Failed to get Gemini response. Retrying...', 'error');
        await sleep(5000);
        continue;
      }

      log(`Gemini raw response: ${geminiResponse}`, 'info');

      // C. Parse Action array
      const actions = parseGeminiResponse(geminiResponse);
      if (!actions || actions.length === 0) {
        log('Failed to parse a valid JSON action from Gemini. Retrying...', 'error');
        await sleep(2000);
        continue;
      }
      log(`Parsed ${actions.length} action(s): ${JSON.stringify(actions)}`, 'action');

      // D. Execute each action in the batch sequentially
      let navigated = false;
      for (const action of actions) {
        if (!isRunning) break;
        log(`Executing action: ${action.action}...`, 'info');

        if (action.action === 'done') {
          log('Gemini decided the goal is complete.', 'action');
          stopAgent();
          return;
        }

        const executeResult = await executeAction(targetTabId, action);
        if (executeResult && executeResult.status === 'success') {
          log('Action executed successfully.', 'info');
          recentActions.push({ type: action.action, id: action.id });
          if (recentActions.length > 10) recentActions.shift();
        } else {
          log(`Action failed: ${executeResult ? executeResult.error : 'Unknown'}`, 'error');
        }

        // If a navigate happened, stop processing rest of batch and re-evaluate
        if (action.action === 'navigate') { navigated = true; break; }

        await sleep(400); // Small pause between batch actions for DOM to update
      }

      // Wait a moment for page to load/update before next cycle
      log('Waiting 1 second for page updates...', 'info');
      await sleep(navigated ? 2000 : 1000);
    }
  } catch (error) {
    log(`Execution loop error: ${error.message}`, 'error');
    stopAgent();
  }
}

function stopAgent() {
  isRunning = false;
  chrome.storage.local.set({ isRunning: false });
  chrome.runtime.sendMessage({ type: 'AGENT_STOPPED' }).catch(() => {
    /* Ignore if sidepanel is closed */
  });
  // Also notify gemini.js directly so it can kill its stale pollInterval / timeoutId
  if (geminiTabId) {
    chrome.tabs.sendMessage(geminiTabId, { type: 'AGENT_STOPPED' }).catch(() => {
      /* Ignore if Gemini tab is closed */
    });
  }
  // Cancel any stale background askGemini timeout + listener
  if (currentGeminiTimeout) { clearTimeout(currentGeminiTimeout); currentGeminiTimeout = null; }
  if (currentGeminiListener) { chrome.runtime.onMessage.removeListener(currentGeminiListener); currentGeminiListener = null; }
  closeOffscreenDocument().catch(console.error);
}

async function ensureGeminiTab(returnTabId) {
  const tabs = await chrome.tabs.query({ url: '*://gemini.google.com/*' });
  let geminiId = null;

  if (tabs.length > 0) {
    log('Found existing Gemini tab. Reloading...', 'info');
    geminiId = tabs[0].id;
    // Ensure the existing tab is also pinned
    chrome.tabs.update(geminiId, { active: true, pinned: true }).catch(() => {
      /* Ignore if tab is closed */
    });
    await chrome.tabs.reload(geminiId);
    await sleep(6000); // Wait for it to load
  } else {
    log('Opening new pinned Gemini tab...', 'info');
    // Open Gemini fully active, pinned, and defaulting to Flash model.
    const newTab = await chrome.tabs.create({ url: 'https://gemini.google.com/app?model=gemini-1.5-flash', active: true, pinned: true });
    geminiId = newTab.id;
    // Wait for it to load
    await sleep(6000);
  }

  // Swap back to target tab
  if (returnTabId) {
     await chrome.tabs.update(returnTabId, { active: true }).catch(() => {
       /* Ignore if tab is closed */
     });
  }

  return geminiId;
}

function getPageContext(tabId) {
  return new Promise((resolve) => {
    // Send a message to content.js to extract DOM
    chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_CONTEXT' }, (response) => {
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message;
        log(`Error communicating with target page: ${errorMsg}`, 'error');

        // If the content script is missing or the port closed (meaning script isn't listening properly), try to explicitly inject it
        if (errorMsg.includes('Receiving end does not exist') || errorMsg.includes('message port closed')) {
          log('Content script missing or unresponsive. Injecting now...', 'info');
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
          }).then(() => {
            // Wait for script to initialize and DOM to settle on complex SPAs
            setTimeout(() => {
              chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_CONTEXT' }, (retryResponse) => {
                if (chrome.runtime.lastError) {
                  log(`Retry failed: ${chrome.runtime.lastError.message}`, 'error');
                  resolve(null);
                } else {
                  resolve(retryResponse ? retryResponse.context : null);
                }
              });
            }, 3000);
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

function buildAntiLoopWarning(recentActions) {
  if (recentActions.length < 3) return '';
  
  // 1. Consecutive loop (A -> A)
  const last = recentActions[recentActions.length - 1];
  const count = recentActions.filter(a => a.type === last.type && a.id === last.id).length;
  
  if (count >= 3) {
      return `\nCRITICAL WARNING: You have interacted with element ID [${last.id}] ${count} times recently. STOP. If the page isn't changing, the action is likely already applied or NOT working. If you are clicking a sidebar menu item, check if it's already highlighted. DO NOT repeat the same action again. Try scrolling or navigating to a different URL (e.g. searching again).`;
  }

  // 2. Sequence loop (A, B -> A, B)
  if (recentActions.length >= 4) {
      const a1 = recentActions[recentActions.length - 4];
      const b1 = recentActions[recentActions.length - 3];
      const a2 = recentActions[recentActions.length - 2];
      const b2 = recentActions[recentActions.length - 1];
      if (a1.id === a2.id && b1.id === b2.id && a1.type === a2.type && b1.type === b2.type) {
          return `\nWARNING: You are in a repeating sequence loop (Alternating between [${a1.id}] and [${b1.id}]). STOP THIS LOOP. Look at the page state more carefully. One of these buttons might already be "(ACTIVE)".`;
      }
  }
  
  return '';
}

function buildSystemPrompt(goal, pageContext, antiLoopWarning = '', cvContent = '') {
  const cvSection = cvContent
    ? `\n\nCANDIDATE CV / RESUME (use this to auto-fill forms — include name, email, phone, skills, work history, education):\n---\n${cvContent}\n---`
    : '';

  return `You are an autonomous web browsing agent controlling a real browser to achieve a user goal.
Your goal is: "${goal}"
${cvSection}

Each turn I will send you a screenshot of the webpage with numbered red boxes [ID] over interactive elements, plus a text map of those elements.
You MUST reply with ONLY a JSON object (no markdown, no explanation) containing an "actions" array of up to 10 sequential steps to take.

Available action types:
1. Click:    {"action": "click", "id": <number>}
2. Type:     {"action": "type", "id": <number>, "text": "<string>"}
   - Append \\n to submit via Enter, e.g. "ELV Engineer\\n"
3. Select:   {"action": "select", "id": <number>, "value": "<option text>"}
   - Use for <select> dropdowns. Value must match one of the options shown in the element label.
4. Scroll:   {"action": "scroll", "direction": "down"}
5. Navigate: {"action": "navigate", "url": "<string>"}
6. Done:     {"action": "done", "reason": "<string>"}
   - ONLY when the complete goal is fully achieved and all forms are submitted.
   - Do NOT use done while a form or modal is still open.

Rules:
- If the screen shows a form, fill ALL visible fields in one batch before clicking Next/Submit.
- Prefer Easy Apply / one-click apply paths.
- If you see a <select> dropdown, read its options from the label (shown as [opt1|opt2|...]) and use the select action.
- DO NOT repeat the same action on the same element consecutively.
- TOGGLES: If a filter or button is already marked as "(ACTIVE)", clicking it will UNSELECT it. DO NOT click an "(ACTIVE)" element unless your goal is explicitly to remove that filter.
- MODAL SAFETY: If a dialog/modal is open, you MUST click the primary action button (Submit, Review, Next, Save, Apply, Continue, Confirm). NEVER click Dismiss, Discard, ×, Close, Cancel or any button that would close the dialog and lose progress.
- If you see a "Save this application?" or similar save-warning dialog, ALWAYS click "Save" or "Continue" — NEVER "Discard" or the × close button.
- If the only visible buttons are Dismiss/Discard/Cancel and you cannot proceed, use {"action": "scroll", "direction": "down"} to reveal the real Submit button, then click it.
- **NEVER** use the "navigate" action to leave the current website or go to alternative job boards (like Bayt, Indeed, etc.) during an active application. If you don't see the form, it is simply loading. Reply with an empty list \`{"actions": []}\` to wait for the next cycle.
- **NEVER** use a "key" action. If you want to press Enter, append \\n to the end of your string in a "type" action.

Example:
{"actions": [
  {"action": "type", "id": 5, "text": "15"},
  {"action": "select", "id": 7, "value": "Male"},
  {"action": "click", "id": 14}
]}

Now here is the current page state:

Current Webpage Map:
---
${pageContext}
---
${antiLoopWarning}
What is your next batch of actions?`;
}

function buildCyclePrompt(goal, pageContext, antiLoopWarning = '', cvContent = '') {
  const cvReminder = cvContent
    ? `\nCANDIDATE CV (use for form filling):\n---\n${cvContent.substring(0, 1500)}\n---`
    : '';
  return `You are an autonomous web agent. ACHIEVE THE GOAL: "${goal}"
Available actions: click, type, select, scroll, navigate, done.
Reply with ONLY a JSON object: {"actions": [{"action": "click", "id": 123}, ...]}

IMPORTANT: If an element is marked "(ACTIVE)", it is already selected. Clicking it again will TOGGLE IT OFF. Do not click active filters unless you want to remove them.
DO NOT use the "key" action. Use \\n in a "type" action for Enter.

Current Webpage Map:
---
${pageContext}
---
${antiLoopWarning}${cvReminder}
What is your next batch of actions?`;
}

/**
 * Phase 1: Activate Gemini tab, type + send the prompt.
 * Returns a Promise (waitForReply) that resolves with the text response when Gemini finishes.
 * The caller should switch away from the Gemini tab immediately after this resolves.
 */
/**
 * Fetches the required session tokens (at, bl, sid) from Gemini.
 * Primarily uses chrome.scripting to read from the active Gemini tab.
 */
async function getGeminiToken(tabId) {
  if (tabId) {
    try {
      log('Extracting session parameters via chrome.scripting...', 'info');
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => {
          const viz = (typeof WIZ_global_data !== 'undefined' ? WIZ_global_data : (typeof _WIZ_global_data !== 'undefined' ? _WIZ_global_data : null));
          if (!viz) return null;
          
          return {
            at: viz.SNlM0e || null,
            bl: viz.cfb2h || null,
            // Search multiple common property names for SID
            sid: viz.FdrFq || viz.o0S9v || viz.cfb2h || null 
          };
        }
      });

      if (results && results[0] && results[0].result) {
        const data = results[0].result;
        // Fallback for sid if not in WIZ_global_data directly
        if (!data.sid) {
            log('sid not in WIZ_global_data, attempting URL extraction...', 'info');
            try {
                const tab = await chrome.tabs.get(tabId);
                const url = new URL(tab.url);
                data.sid = url.searchParams.get('f.sid');
            } catch(e) { /* Tab might be closed or URL invalid */ }
        }
        log(`Session params extracted: at=${!!data.at}, bl=${!!data.bl}, sid=${!!data.sid}`, 'info');
        return data;
      }
    } catch (e) {
      log('Scripting parameter extraction failed: ' + e.message, 'warn');
    }
  }

  // 2. Minimal fallback to background fetch (only for 'at' and 'bl' regex)
  try {
    log('Falling back to background fetch for tokens...', 'info');
    const response = await fetch('https://gemini.google.com/app', {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const text = await response.text();
    const atMatch = text.match(/"SNlM0e":"(.*?)"/);
    const blMatch = text.match(/"cfb2h":"(.*?)"/);
    const sidMatch = text.match(/"FdrFq":"(.*?)"/) || text.match(/f\.sid=(.*?)["&]/);
    
    return {
        at: atMatch ? atMatch[1] : null,
        bl: blMatch ? blMatch[1] : 'boq_assistant-bard-web-server_20260311.02_p5',
        sid: sidMatch ? sidMatch[1] : '-5442142607698186209'
    };
  } catch (e) {
    log('Background fetch extraction failed: ' + e.message, 'error');
  }
  return null;
}

/**
 * Direct API interaction with Gemini using POST requests.
 */
async function directApiAskGemini(tabId, promptText, imageData, cvData) {
  const session = await getGeminiToken(tabId);
  if (!session || !session.at) {
    log('Could not obtain mandatory Gemini token seat.', 'error');
    return null;
  }

  const atToken = session.at;
  const sid = session.sid || "-5442142607698186209";
  const bl = session.bl || "boq_assistant-bard-web-server_20260311.02_p5";

  const reqId = Math.floor(Math.random() * 900000) + 100000;
  // Use dynamic parameters to ensure authenticity
  const url = `https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=${bl}&f.sid=${sid}&hl=en&_reqid=${reqId}&rt=c`;

  const bodyObj = [
    null,
    JSON.stringify([
      [promptText, 0, null, null, null, null, 0],
      ["en"],
      ["", "", ""], // No specific conversation ID needed for new prompts
      null, null, null,
      [1]
    ])
  ];

  const formData = new URLSearchParams();
  formData.append('f.req', JSON.stringify(bodyObj));
  formData.append('at', atToken);

  try {
    log(`Sending direct POST request to Gemini API (reqId: ${reqId})...`, 'info');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Same-Domain': '1'
      },
      body: formData
    });

    log(`Gemini API POST response status: ${response.status}`, 'info');
    const text = await response.text();
    
    if (!response.ok) {
        log(`API Error body snippet: ${text.substring(0, 500)}`, 'error');
        throw new Error(`HTTP ${response.status}`);
    }

    log(`Received API response length: ${text.length}. Parsing...`, 'info');
    if (text.length < 500) {
        log(`Small API response content: ${text}`, 'info');
    }
    const result = parseGeminiApiStreamingResponse(text);
    if (!result) {
        log('API call succeeded but parsing returned empty result.', 'warn');
    }
    return result;
  } catch (e) {
    log('Direct API call failed: ' + e.message, 'error');
    return null;
  }
}

function parseGeminiApiStreamingResponse(rawResponse) {
  let finalText = "";
  let chunkCount = 0;
  let allTextChunks = [];

  try {
    // 1. Split into envelope segments (Gemini uses \nLength\n format or similar)
    const segments = rawResponse.split(/\r?\n\d+\r?\n|\r?\n\r?\n/);
    for (let segment of segments) {
      segment = segment.trim();
      if (!segment) continue;

      // A segment might contain multiple JSON blocks or leading length/junk.
      let searchIdx = 0;
      while (searchIdx < segment.length) {
        const jsonStart = segment.indexOf('[', searchIdx);
        const objStart = segment.indexOf('{', searchIdx);
        let start = -1;
        if (jsonStart !== -1 && objStart !== -1) start = Math.min(jsonStart, objStart);
        else if (jsonStart !== -1) start = jsonStart;
        else if (objStart !== -1) start = objStart;

        if (start === -1) break;

        let parsed = null;
        let currentStr = segment.substring(start);
        try {
          parsed = JSON.parse(currentStr);
        } catch (e) {
          // Attempt to find the last valid JSON boundary if the whole segment is not valid
          const lastBracket = currentStr.lastIndexOf(']');
          const lastBrace = currentStr.lastIndexOf('}');
          const lastMatch = Math.max(lastBracket, lastBrace);
          if (lastMatch !== -1) {
            try {
              const candidate = currentStr.substring(0, lastMatch + 1);
              parsed = JSON.parse(candidate);
              currentStr = candidate;
            } catch (e2) { /* Partial segment still not valid JSON */ }
          }
        }

        if (parsed) {
          const toInspect = Array.isArray(parsed) ? parsed : [parsed];
          for (const item of toInspect) {
            let data = null;
            if (Array.isArray(item) && item[0] === "wrb.fr" && item[2]) {
              // wrb.fr payload is often a nested JSON string
              try { data = JSON.parse(item[2]); } catch (e) { /* Not a JSON string */ }
            } else {
              data = item;
            }

            if (!data) continue;
            chunkCount++;

            const found = [];
            function collectAllStrings(obj, depth = 0) {
              if (depth > 12) return;
              if (typeof obj === 'string' && obj.length > 0) {
                found.push(obj);
                if (obj.includes('{') || obj.startsWith('[')) {
                  try {
                    const nested = JSON.parse(obj);
                    collectAllStrings(nested, depth + 1);
                  } catch (e) { /* Not valid JSON, skip nested parsing */ }
                }
              } else if (Array.isArray(obj)) {
                for (const sub of obj) collectAllStrings(sub, depth + 1);
              } else if (typeof obj === 'object' && obj !== null) {
                for (const key in obj) collectAllStrings(obj[key], depth + 1);
              }
            }
            collectAllStrings(data);

            const jsonLike = found.filter(s => s.includes('"action"'));
            const jsonFallback = found.filter(s => s.includes('{') && s.length > 30);
            const substantial = found.filter(s => s.length > 30);

            const best = jsonLike.length > 0
              ? jsonLike.reduce((a, b) => b.length > a.length ? b : a)
              : jsonFallback.length > 0
                ? jsonFallback.reduce((a, b) => b.length > a.length ? b : a)
                : substantial.length > 0
                  ? substantial.reduce((a, b) => b.length > a.length ? b : a)
                  : '';

            if (best) {
              allTextChunks.push(best);
              if (best.includes('"action"') || best.includes('{')) {
                finalText = best;
              }
            }
          }
          searchIdx = start + currentStr.length;
        } else {
          searchIdx = start + 1;
        }
      }
    }

    if (!finalText && allTextChunks.length > 0) {
      allTextChunks.sort((a, b) => b.length - a.length);
      finalText = allTextChunks[0];
    }
  } catch (error) {
    console.warn("Error in parseGeminiApiStreamingResponse", error);
  }
  return finalText;
}

/**
 * Phase 1: Try direct API first, fallback to UI automation if needed.
 */
async function askGeminiSend(tabId, prompt, imageData, cvData = null) {
  log('Attempting direct API communication with Gemini...', 'info');
  
  const apiResponse = await directApiAskGemini(tabId, prompt, imageData, cvData);
  if (apiResponse) {
    log('Received response via direct API.', 'info');
    return Promise.resolve(apiResponse);
  }

  log('Direct API failed. Falling back to UI automation...', 'warn');

  return new Promise((resolvePhase1, rejectPhase1) => {
    // Send prompt to Gemini content script (existing UI fallback)
    chrome.tabs.sendMessage(tabId, { type: 'SEND_PROMPT', prompt, imageData, cvData }, (response) => {
      if (chrome.runtime.lastError) {
        log(`Error communicating with Gemini tab: ${chrome.runtime.lastError.message}`, 'error');
        resolvePhase1(Promise.resolve(null));
        return;
      }

      if (response && response.status === 'sent') {
        const waitForReply = new Promise((resolvePhase2) => {
          currentGeminiListener = (message) => {
            if (message.type === 'GEMINI_RESPONSE') {
              if (currentGeminiTimeout) { clearTimeout(currentGeminiTimeout); currentGeminiTimeout = null; }
              chrome.runtime.onMessage.removeListener(currentGeminiListener);
              currentGeminiListener = null;
              resolvePhase2(message.text);
            }
          };
          chrome.runtime.onMessage.addListener(currentGeminiListener);

          currentGeminiTimeout = setTimeout(() => {
            if (currentGeminiListener) { chrome.runtime.onMessage.removeListener(currentGeminiListener); currentGeminiListener = null; }
            currentGeminiTimeout = null;
            log('Timeout waiting for Gemini response (took > 150s)', 'error');
            resolvePhase2(null);
          }, 150000);
        });

        resolvePhase1(waitForReply);
      } else {
        resolvePhase1(Promise.resolve(null));
      }
    });
  });
}

function parseGeminiResponse(responseText) {
  try {
    let jsonStr = responseText;
    // Strip markdown code fences if present
    const fencedMatch = responseText.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
    if (fencedMatch) jsonStr = fencedMatch[1];

    // Extract first complete {...} block
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
    } else {
      // If no braces found, it's definitely not JSON
      return null;
    }

    const parsed = JSON.parse(jsonStr);

    // New batch format: { actions: [...] }
    if (Array.isArray(parsed.actions) && parsed.actions.length > 0) {
      return parsed.actions; // Return array
    }
    // Old single-action format fallback: { action: '...', id: ... }
    if (parsed.action) return [parsed]; // Wrap in array for uniform handling
  } catch (e) {
    console.error('JSON Parse Error', e, responseText);
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
