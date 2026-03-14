// content.js
(function() {
  // Prevent multiple injections in the same scope from throwing, 
  // but ensure we update the listener if the extension was reloaded.
  try {
      if (window.geminiMessageListener) {
          chrome.runtime.onMessage.removeListener(window.geminiMessageListener);
      }
  } catch(e) { /* Ignore orphaned listener errors */ }

  window.geminiElementMap = window.geminiElementMap || new Map();
  const elementMap = window.geminiElementMap;

  function getXPath(element) {
      if (!element) return '';
      if (element.id !== '') return `id("${element.id}")`;
      if (element === document.body) return 'BODY';

      let ix = 0;
      const siblings = element.parentNode ? element.parentNode.childNodes : [];
      for (let i = 0; i < siblings.length; i++) {
          const sibling = siblings[i];
          if (sibling === element) {
              const parentXPath = getXPath(element.parentNode);
              return parentXPath ? (parentXPath + '/' + element.tagName + '[' + (ix + 1) + ']') : '';
          }
          if (sibling.nodeType === 1 && sibling.tagName === element.tagName) ix++;
      }
      return '';
  }

  function querySelectorAllDeep(selector, root = document) {
      let results = Array.from(root.querySelectorAll(selector));
      const allElements = root.querySelectorAll('*');
      for (const el of allElements) {
          if (el.shadowRoot) {
              results = results.concat(querySelectorAllDeep(selector, el.shadowRoot));
          }
          if (el.tagName && el.tagName.toLowerCase() === 'iframe') {
              try {
                  if (el.contentDocument) {
                      results = results.concat(querySelectorAllDeep(selector, el.contentDocument));
                  }
              } catch(e) {}
          }
      }
      return results;
  }

  function getAbsoluteRect(el) {
      const rect = el.getBoundingClientRect();
      let top = rect.top;
      let left = rect.left;
      let win = el.ownerDocument.defaultView;
      while (win && win !== window) {
          const frame = win.frameElement;
          if (!frame) break;
          const frameRect = frame.getBoundingClientRect();
          top += frameRect.top;
          left += frameRect.left;
          win = win.parent;
      }
      return { top, left, bottom: top + rect.height, right: left + rect.width, width: rect.width, height: rect.height };
  }

  function deepContains(parent, child) {
      let node = child;
      while (node && node !== document) {
          if (node === parent) return true;
          if (node.nodeType === 11 && node.host) {
              node = node.host;
          } else if (node.ownerDocument && node.ownerDocument !== document && node.ownerDocument.defaultView && node.ownerDocument.defaultView.frameElement) {
              node = node.ownerDocument.defaultView.frameElement;
          } else {
              node = node.parentNode;
          }
      }
      return false;
  }

  function getElementByXPath(path) {
      try {
          return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      } catch(e) {
          return null;
      }
  }

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

  function markElements() {
    elementMap.clear();
    unmarkElements(); // Clean up any existing marks just in case
    
    let idCounter = 1;

    // Identify interactive elements and map them
    const selectors = 'a, button, input, select, textarea, label, summary, [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="option"], [role="tab"], [role="combobox"], [role="menuitem"], [role="searchbox"], [role="radio"], [tabindex]:not([tabindex="-1"]), [class*="btn" i], [class*="button" i], [class*="dropdown" i]';
    const elements = querySelectorAllDeep(selectors);

    const viewWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewHeight = window.innerHeight || document.documentElement.clientHeight;
    
    let candidates = [];

    for (const el of elements) {
      if (isVisible(el)) {
        const rect = getAbsoluteRect(el);
        
        // Skip if off-screen
        if (rect.bottom < 0 || rect.right < 0 || rect.left > viewWidth || rect.top > viewHeight) {
            continue;
        }
        candidates.push({ el, rect });
      }
    }

    let visibleCandidates = [];
    
    for (const item of candidates) {
        const { el, rect } = item;
        
        // Raycast to ensure element is not blocked by a modal overlay or floating header
        // Keep x/y bounds within the TOP window bounds because document.elementFromPoint runs locally
        const points = [
            { x: Math.max(0, Math.min(rect.left + rect.width / 2, viewWidth - 1)), y: Math.max(0, Math.min(rect.top + rect.height / 2, viewHeight - 1)) },
            { x: Math.max(0, Math.min(rect.left + 5, viewWidth - 1)), y: Math.max(0, Math.min(rect.top + 5, viewHeight - 1)) },
            { x: Math.max(0, Math.min(rect.right - 5, viewWidth - 1)), y: Math.max(0, Math.min(rect.bottom - 5, viewHeight - 1)) }
        ];

        let isOccluded = true;
        for (const pt of points) {
            let topEl = null;
            try { topEl = document.elementFromPoint(pt.x, pt.y); } catch(e) { }
            if (!topEl) continue;

            // If the uppermost element is our element, or a descendant (e.g. an icon inside our button)
            // Or if our element is inside the uppermost element (e.g. a link inside a span that took the click)
            if (deepContains(el, topEl) || deepContains(topEl, el)) {
                isOccluded = false;
                break;
            }

            // Relax for composite components (like styled dropdowns): 
            // If topEl is a sibling overlay, they share a very close structural wrapper.
            let parent = el.parentNode;
            let depth = 0;
            while (parent && parent !== document.body && depth < 3) {
                if (deepContains(parent, topEl)) {
                    isOccluded = false;
                    break;
                }
                if (parent.nodeType === 11 && parent.host) { parent = parent.host; }
                else if (parent.ownerDocument && parent.ownerDocument !== document && parent.ownerDocument.defaultView && parent.ownerDocument.defaultView.frameElement) { parent = parent.ownerDocument.defaultView.frameElement; }
                else { parent = parent.parentNode; }
                depth++;
            }
            if (!isOccluded) break;
        }

        // If it is covered by a massive backdrop or sibling overlay, skip rendering it to AI
        if (!isOccluded) visibleCandidates.push(item);
    }

    // FALLBACK: If raycasting was too aggressive and removed EVERYTHING, revert to all candidates.
    if (visibleCandidates.length === 0 && candidates.length > 0) {
        visibleCandidates = candidates;
    }

    // Cap at 75 elements to prevent massive prompts
    visibleCandidates = visibleCandidates.slice(0, 75);

    let contextText = '';
    for (const item of visibleCandidates) {
        const { el, rect } = item;
        const id = idCounter++;
        elementMap.set(id, { el, xpath: getXPath(el) });

        // Draw the mark on screen
        const marker = document.createElement('div');
        marker.className = 'agent-ui-marker';
        marker.textContent = id;
        marker.style.position = 'absolute';
        marker.style.top = `${window.scrollY + rect.top}px`;
        marker.style.left = `${window.scrollX + rect.left}px`;
        marker.style.backgroundColor = 'red';
        marker.style.color = 'white';
        marker.style.fontSize = '12px';
        marker.style.fontWeight = 'bold';
        marker.style.padding = '2px 4px';
        marker.style.borderRadius = '3px';
        marker.style.zIndex = '2147483647'; // Max z-index
        marker.style.pointerEvents = 'none'; // Don't block clicks
        marker.style.border = '1px solid black';
        
        document.body.appendChild(marker);

        const tagName = el.tagName.toLowerCase();
        const role = el.getAttribute('role');
        const isChecked = el.checked || el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true';
        const isActive = el.classList.contains('active') || el.classList.contains('selected') || el.classList.contains('is-active');

        let label = '';
        if (tagName === 'select') {
          // Show current value + available options so AI can use the select action
          label = el.options[el.selectedIndex]?.text || '';
          const opts = Array.from(el.options).map(o => o.text.trim()).filter(Boolean);
          if (opts.length > 0) label += (label ? ' ' : '') + '[' + opts.slice(0, 6).join('|') + ']';
        } else {
          label = el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.getAttribute('name') || el.title || '';
        }
        label = label.replace(/\s+/g, ' ').trim().substring(0, 50);

        let stateStr = '';
        if (isChecked || isActive) {
            stateStr = ' (ACTIVE)';
        } else if (el.disabled) {
            stateStr = ' (DISABLED)';
        }
        
        contextText += `[${id}] <${tagName}${role ? `:${role}` : ''}> ${label ? `"${label}"` : ''}${stateStr}\n`;
    }

    // Prevent background.js from infinitely retrying if the map is genuinely empty
    if (contextText === '') return 'No interactive elements found on the visible screen.';

    // Append any visible validation errors / alerts so the AI knows what's wrong
    const errorText = collectVisibleErrors();
    if (errorText) contextText += '\n--- VALIDATION ERRORS (must fix before proceeding) ---\n' + errorText;

    return contextText.substring(0, 5000); // Truncate just in case
  }

  /**
   * Collect visible error/alert messages on the page.
   * Covers: aria-live regions, role=alert, elements next to aria-invalid inputs,
   * and any element whose text looks like an error (class contains "error"/"invalid"/"warning").
   */
  function collectVisibleErrors() {
    const seen = new Set();
    let result = '';

    function addText(text) {
      const t = text.replace(/\s+/g, ' ').trim();
      if (t.length > 3 && !seen.has(t)) {
        seen.add(t);
        result += '• ' + t + '\n';
      }
    }

    // 1. role="alert" and aria-live regions
    document.querySelectorAll('[role="alert"], [aria-live="assertive"], [aria-live="polite"]').forEach(el => {
      if (isVisible(el)) addText(el.innerText || el.textContent || '');
    });

    // 2. Elements adjacent to aria-invalid inputs (e.g. <p class="error"> after <input aria-invalid="true">)
    document.querySelectorAll('[aria-invalid="true"], [aria-errormessage], .artdeco-text-input--error input')
      .forEach(el => {
        // Check next sibling or parent siblings for error text
        const candidates = [el.nextElementSibling, el.parentElement && el.parentElement.nextElementSibling];
        for (const c of candidates) {
          if (c && isVisible(c)) addText(c.innerText || c.textContent || '');
        }
        // Also check aria-errormessage target
        const errId = el.getAttribute('aria-errormessage') || el.getAttribute('aria-describedby');
        if (errId) {
          const errEl = document.getElementById(errId);
          if (errEl && isVisible(errEl)) addText(errEl.innerText || errEl.textContent || '');
        }
      });

    // 3. Elements with error/invalid/warning CSS classes
    const errorSelectors = [
      '[class*="error" i]', '[class*="invalid" i]', '[class*="validation" i]',
      '[class*="form__error" i]', '[class*="field-error" i]', '[class*="input-error" i]'
    ].join(', ');
    document.querySelectorAll(errorSelectors).forEach(el => {
      const tag = el.tagName.toLowerCase();
      // Skip containers — only leaf-ish text nodes
      if (['div', 'form', 'section', 'fieldset'].includes(tag)) return;
      if (isVisible(el)) addText(el.innerText || el.textContent || '');
    });

    return result;
  }

  function unmarkElements() {
     const markers = document.querySelectorAll('.agent-ui-marker');
     markers.forEach(m => m.remove());
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

    if (type === 'scroll') {
        const direction = action.direction || 'down';
        const scrollAmount = window.innerHeight * 0.8;
        const scrollMult = direction === 'down' ? 1 : -1;
        
        if (id !== undefined && elementMap.has(id)) {
            // Scroll a specific container if ID is provided
            const el = elementMap.get(id).el;
            // Find the nearest scrollable ancestor
            let scrollParent = el;
            while (scrollParent && scrollParent !== document.body) {
                const overflowY = window.getComputedStyle(scrollParent).overflowY;
                const isScrollable = (overflowY === 'auto' || overflowY === 'scroll') && scrollParent.scrollHeight > scrollParent.clientHeight;
                if (isScrollable) break;
                scrollParent = scrollParent.parentElement;
            }
            if (scrollParent && scrollParent !== document.body) {
                scrollParent.scrollBy({ top: scrollAmount * scrollMult, behavior: 'smooth' });
            } else {
                window.scrollBy({ top: scrollAmount * scrollMult, behavior: 'smooth' });
            }
        } else {
            // Generic scroll: The window might not be scrollable (e.g. if a modal is open).
            // Find the largest scrollable container and scroll that.
            let bestContainer = window;
            let maxArea = 0;
            
            const elements = document.querySelectorAll('*');
            for (let i = 0; i < elements.length; i++) {
                const el = elements[i];
                if (el.scrollHeight > el.clientHeight && el.clientHeight > 0) {
                    const style = window.getComputedStyle(el);
                    if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                        const rect = el.getBoundingClientRect();
                        const area = rect.width * rect.height;
                        if (area > maxArea) {
                            maxArea = area;
                            bestContainer = el;
                        }
                    }
                }
            }
            
            // Scroll both the window and the largest scrollable container (usually the modal)
            window.scrollBy({ top: scrollAmount * scrollMult, behavior: 'smooth' });
            if (bestContainer !== window && bestContainer.scrollBy) {
                bestContainer.scrollBy({ top: scrollAmount * scrollMult, behavior: 'smooth' });
            }
        }
        return;
    }

    if (id === undefined || !elementMap.has(id)) {
      throw new Error(`Element with id [${id}] not found.`);
    }

    const { el: originalEl, xpath } = elementMap.get(id);
    
    // Resolve stale reference if detached
    let el = originalEl;
    if (!el.isConnected) {
       el = getElementByXPath(xpath);
       if (!el) {
         throw new Error(`Element [${id}] is detached and no longer found via XPath.`);
       }
    }

    if (type === 'click') {
      // Use only el.click() to avoid double-triggering on sites that open modals
      // (firing both native click + synthetic MouseEvent caused two application windows to open)
      try { el.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch(e) {}
      try { el.focus(); } catch(e) {}

      let clicked = false;
      try { el.click(); clicked = true; } catch(e) {}
      if (!clicked) {
        // Fallback: dispatch a single synthetic click only if native click threw
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      }

      // Try native form submission if it's a submit button
      if (el.type === 'submit' && el.closest('form')) {
        try { el.closest('form').submit(); } catch(e) {}
      }
    } else if (type === 'type' && text !== undefined) {
      el.focus();

      // Strip trailing newline from the value — handle Enter separately below
      const hasEnter = text.endsWith('\n');
      const cleanText = hasEnter ? text.slice(0, -1) : text;

      // Get the native setter from the element's OWN window context
      // Using `window.HTMLInputElement` fails if element is inside an IFrame (throws IllegalInvocation)
      const tag = el.tagName.toLowerCase();
      const isContentEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';

      if (isContentEditable) {
          // contenteditable div (LinkedIn search bar, rich text editors, etc.)
          // Must use execCommand to trigger framework listeners properly
          el.focus();
          try { document.execCommand('selectAll', false, null); } catch(e) {}
          const ok = document.execCommand('insertText', false, cleanText);
          if (!ok) {
              el.textContent = cleanText;
              el.dispatchEvent(new Event('input', { bubbles: true }));
          }
      } else {
          // Get the native setter from the element's OWN window context
          // Using global `window.HTMLInputElement` fails cross-frame (throws IllegalInvocation)
          const elWin = el.ownerDocument.defaultView || window;
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(elWin.HTMLInputElement.prototype, 'value')?.set;
          const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(elWin.HTMLTextAreaElement.prototype, 'value')?.set;

          if (tag === 'textarea' && nativeTextAreaValueSetter) {
              nativeTextAreaValueSetter.call(el, cleanText);
          } else if (tag === 'input' && nativeInputValueSetter) {
              nativeInputValueSetter.call(el, cleanText);
          } else {
              try { el.value = cleanText; } catch(e) {
                  el.textContent = cleanText;
              }
          }

          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Only fire Enter if the agent explicitly requested it via a trailing newline in text
      if (hasEnter) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));

        if (el.tagName.toLowerCase() === 'input' && el.closest('form')) {
          try { el.closest('form').submit(); } catch(e) {}
        }
      }
    } else if (type === 'select' && (action.option !== undefined || action.value !== undefined)) {
      if (el.tagName.toLowerCase() !== 'select') {
        throw new Error(`Element [${id}] is a ${el.tagName}, not a <select> dropdown.`);
      }

      const valToMatch = (action.option || action.value).trim().toLowerCase();
      let found = false;

      // First pass: exact match
      for (const opt of Array.from(el.options)) {
          if (opt.text.trim().toLowerCase() === valToMatch || opt.value.trim().toLowerCase() === valToMatch) {
              el.value = opt.value;
              found = true;
              break;
          }
      }

      // Second pass: partial match
      if (!found) {
          for (const opt of Array.from(el.options)) {
              if (opt.text.toLowerCase().includes(valToMatch) || opt.value.toLowerCase().includes(valToMatch)) {
                  el.value = opt.value;
                  found = true;
                  break;
              }
          }
      }

      if (!found) {
        throw new Error(`Could not find option matching "${valToMatch}" in dropdown [${id}]`);
      }

      // Trigger framework listeners
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));

    } else {
      throw new Error(`Unknown action type: ${type}`);
    }
  }

  window.geminiMessageListener = (message, sender, sendResponse) => {
    if (message.type === 'EXTRACT_CONTEXT') {
      const context = markElements();
      sendResponse({ context });
    } else if (message.type === 'UNMARK_ELEMENTS') {
      unmarkElements();
      sendResponse({ status: 'success' });
    } else if (message.type === 'EXECUTE_ACTION') {
      executeAction(message.action)
        .then(() => sendResponse({ status: 'success' }))
        .catch((err) => sendResponse({ status: 'error', error: err.message }));
      return true; // Keep message channel open for async response
    }
  };

  chrome.runtime.onMessage.addListener(window.geminiMessageListener);

  // Ensure the page gets marked on load ONLY IF we haven't initialized it yet in this tab session
  if (!window.geminiAgentInjected) {
      setTimeout(markElements, 500);
      window.geminiAgentInjected = true;
  }
})();
