// content.js

let elementMap = new Map(); // Store id -> DOM element mapping

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACT_CONTEXT') {
    const context = extractContext();
    sendResponse({ context });
  } else if (message.type === 'EXECUTE_ACTION') {
    executeAction(message.action)
      .then(() => sendResponse({ status: 'success' }))
      .catch((err) => sendResponse({ status: 'error', error: err.message }));
    return true; // Keep message channel open for async response
  }
});

function isVisible(el) {
  if (!el || !el.getBoundingClientRect) return false;
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== 'hidden' &&
    style.display !== 'none' &&
    style.opacity !== '0'
  );
}

function extractContext() {
  elementMap.clear();
  let contextText = '';
  let idCounter = 1;

  // 1. Get raw text from the page body (simplified)
  const bodyText = document.body.innerText.replace(/\s+/g, ' ').substring(0, 1000);
  contextText += `--- Visible Page Text snippet ---\n${bodyText}\n\n`;

  // 2. Identify interactive elements and map them
  const selectors = 'a, button, input, select, textarea, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';
  const elements = document.querySelectorAll(selectors);

  contextText += `--- Interactive Elements ---\n`;
  for (const el of elements) {
    if (isVisible(el)) {
      const id = idCounter++;
      elementMap.set(id, el);

      const tagName = el.tagName.toLowerCase();
      let label = el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.getAttribute('name') || '';
      label = label.replace(/\s+/g, ' ').trim().substring(0, 50);

      if (label || tagName === 'input' || tagName === 'textarea') {
         let info = `[${id}] <${tagName}>`;
         if (el.type) info += ` type="${el.type}"`;
         if (label) info += ` text="${label}"`;
         if (el.href) info += ` href="${el.href}"`;

         contextText += `${info}\n`;
      }
    }
  }

  return contextText.substring(0, 5000); // Truncate to avoid massive prompts
}

async function executeAction(action) {
  if (!action || !action.action) {
    throw new Error('Invalid action format');
  }

  const { action: type, id, text, url } = action;

  if (type === 'navigate' && url) {
    window.location.href = url;
    return;
  }

  if (type === 'done') {
    console.log('Agent finished task.');
    return;
  }

  if (id === undefined || !elementMap.has(id)) {
    throw new Error(`Element with id [${id}] not found.`);
  }

  const el = elementMap.get(id);

  if (type === 'click') {
    // Attempt standard click, then fallback to dispatchEvent
    try {
       el.click();
    } catch(e) {
       el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }
  } else if (type === 'type' && text !== undefined) {
    el.focus();
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    // Simulate enter key if needed, or simply leave the value populated
    // Note: React/Vue sometimes require more complex typing simulation,
    // but standard DOM value + dispatchEvent usually works for basic HTML.
  } else {
    throw new Error(`Unknown action type: ${type}`);
  }
}
