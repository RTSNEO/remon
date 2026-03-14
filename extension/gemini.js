// gemini.js

let isProcessingPrompt = false;
let lastMessageCount = 0;
let pollInterval = null;
let responseObserver = null;
let keepAliveInterval = null;
let timeoutId = null;

function log(msg, level = 'info') {
    console.log(`[Gemini.js] ${msg}`);
    try {
        if (chrome.runtime && chrome.runtime.id) {
            chrome.runtime.sendMessage({ type: 'LOG', text: msg, level }).catch(() => {});
        }
    } catch (e) {}
}

function cleanup() {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    if (keepAliveInterval) { clearInterval(keepAliveInterval); keepAliveInterval = null; }
    if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
    isProcessingPrompt = false;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SEND_PROMPT') {
    cleanup(); // Clear any previous stale intervals
    isProcessingPrompt = true;

    // The background script now handles direct API communication. 
    // Content script is only responsible for the UI automation fallback.
    log("Gemini.js: Received SEND_PROMPT. Using UI automation fallback...");
    uiSendPromptToGemini(message.prompt, message.imageData, message.cvData)
      .then(() => {
        sendResponse({ status: 'sent' });
        pollForResponse();
      })
      .catch((err) => {
        isProcessingPrompt = false;
        sendResponse({ status: 'error', error: err.message });
      });
    return true; // async response
  } else if (message.type === 'AGENT_STOPPED') {
    cleanup();
  }
});

async function uiSendPromptToGemini(promptText, imageData, cvData) {
  return new Promise(async (resolve, reject) => {
    // 0. Autonomously force the Fast Model (Flash) if Gemini defaulted to Pro
    try {
        const modelDropdown = document.querySelector('button[aria-haspopup="listbox"]');
        if (modelDropdown && modelDropdown.innerText.toLowerCase().includes('advanced')) {
            console.log("Gemini Advanced (Pro mode) detected. Forcing switch to Flash model...");
            modelDropdown.click();
            await new Promise(r => setTimeout(r, 400)); // Wait for dropdown menu to appear
            
            // Look through the listbox for the Flash option
            const options = document.querySelectorAll('[role="option"]');
            for (const opt of options) {
                if (opt.innerText.toLowerCase().includes('flash')) {
                    opt.click();
                    await new Promise(r => setTimeout(r, 600)); // Wait for model switch to process
                    break;
                }
            }
        }
    } catch(e) {
        console.warn("Could not automatically switch Gemini model. Continuing...", e);
    }

    // 1. Find the chat input
    // The selector may change over time on Gemini. Common ones:
    // rich-textarea, .ql-editor, div[contenteditable="true"]
    const chatInput = document.querySelector('div[role="textbox"][contenteditable="true"]') ||
                      document.querySelector('rich-textarea div[contenteditable="true"]') ||
                      document.querySelector('div[data-placeholder*="Ask"]') ||
                      document.querySelector('div[aria-label*="Message"]') ||
                      document.querySelector('textarea:not([hidden])') ||
                      document.querySelector('.ql-editor');

    if (!chatInput) {
      reject(new Error('Could not find chat input element on Gemini page.'));
      return;
    }

    // 2. Count current messages to know when a new one arrives
    const messages = document.querySelectorAll('message-content, .message-content');
    lastMessageCount = messages.length;

    // 3. Insert text
    chatInput.focus();
    
    try {
       document.execCommand('selectAll', false, null);
    } catch(e) {}
    
    // Use execCommand to insert text as it correctly triggers React/Angular synthetic events
    // If it fails, fallback to direct textContent + event dispatching
    const successful = document.execCommand('insertText', false, promptText);

    if (!successful) {
      // Fallback
      chatInput.textContent = promptText;
      chatInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 4. Handle file uploads: screenshot image and/or PDF CV
    let uploadDelay = 500;
    const filesToUpload = [];

    if (imageData && imageData.startsWith('data:image')) {
        try {
            const byteString = atob(imageData.split(',')[1]);
            const mimeString = imageData.split(',')[0].split(':')[1].split(';')[0];
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
            filesToUpload.push(new File([new Blob([ab], { type: mimeString })], 'screenshot.jpg', { type: mimeString }));
            uploadDelay = 3000;
        } catch (e) { console.error('Failed to process screenshot:', e); }
    }

    if (cvData && cvData.startsWith('data:application/pdf')) {
        try {
            const byteString = atob(cvData.split(',')[1]);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
            filesToUpload.push(new File([new Blob([ab], { type: 'application/pdf' })], 'cv.pdf', { type: 'application/pdf' }));
            uploadDelay = 5000; // Give Gemini more time to process the PDF
        } catch (e) { console.error('Failed to process CV PDF:', e); }
    }

    if (filesToUpload.length > 0) {
        log("Starting file upload sequence...");
        
        // Check if file input is ALREADY visible (skip menu clicks)
        let fileInput = document.querySelector('input[type="file"][name="Filedata"]') ||
                        document.querySelector('input[type="file"][accept*="image"]') ||
                        document.querySelector('input[type="file"][accept*="pdf"]');

        if (!fileInput) {
            // 1. Find the main "Plus" button to open the menu
            let uploadMenuBtn = document.querySelector('button.upload-card-button') ||
                                document.querySelector('button[aria-label*="upload file menu"]') ||
                                document.querySelector('button[aria-label*="Upload"]');
            
            if (uploadMenuBtn) {
                // Check if menu is already open
                const isMenuOpen = uploadMenuBtn.getAttribute('aria-label')?.toLowerCase().includes('close') || 
                                   !!document.querySelector('div.cdk-overlay-container button[role="menuitem"]');
                
                if (!isMenuOpen) {
                    log("Opening upload menu...");
                    uploadMenuBtn.click();
                    await new Promise(r => setTimeout(r, 800)); // Wait for menu animation
                }
            }

            // 2. Click the specific "Upload files" menu item to inject/reveal the file input
            let uploadFilesItem = document.querySelector('button[role="menuitem"][data-test-id="local-images-files-uploader-button"]') ||
                                  document.querySelector('button[role="menuitem"][aria-label*="Upload files"]') ||
                                  Array.from(document.querySelectorAll('button[role="menuitem"]')).find(b => b.innerText.toLowerCase().includes('upload'));
            
            if (uploadFilesItem) {
                log("Clicking 'Upload files' menu item...");
                uploadFilesItem.click();
                await new Promise(r => setTimeout(r, 800)); // Wait for input injection
            }
        }

        // 3. Now find the hidden file input (it should be injected into the DOM now)
        fileInput = document.querySelector('input[type="file"][name="Filedata"]') ||
                        document.querySelector('input[type="file"][accept*="image"]') ||
                        document.querySelector('input[type="file"][accept*="pdf"]') ||
                        document.querySelector('input[type="file"]') || 
                        document.querySelector('uploader-manager input[type="file"]');

        if (!fileInput) {
            // Final desperate search in any overlay container
            const overlays = document.querySelectorAll('.cdk-overlay-container input[type="file"]');
            if (overlays.length > 0) fileInput = overlays[overlays.length - 1];
        }

        if (!fileInput) {
            // Check shadow roots if still not found
            const allElements = document.querySelectorAll('*');
            for (const el of allElements) {
                if (el.shadowRoot) {
                    const input = el.shadowRoot.querySelector('input[type="file"]');
                    if (input) {
                        fileInput = input;
                        break;
                    }
                }
            }
        }

        if (fileInput) {
            log("File input found. Attaching files...");
            const dataTransfer = new DataTransfer();
            for (const f of filesToUpload) dataTransfer.items.add(f);
            fileInput.files = dataTransfer.files;
            
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
            fileInput.dispatchEvent(new Event('input', { bubbles: true }));
            log("Files attached successfully.");
        } else {
            console.warn('Could not find file input for attach (Screenshot/PDF) after multi-step trigger.');
            log("Upload failed: Input not found after menu interaction.", "error");

            // Extreme fallback: try to find any clickable uploader
            const fallbackUploader = document.querySelector('.file-uploader') || document.querySelector('[data-test-id="uploader"]');
            if (fallbackUploader) {
                log("Attempting fallback uploader click...");
                fallbackUploader.click();
            }
        }
    }

    // 5. Find and click send button after waiting for text (and optional image) to register
    setTimeout(() => {
      // Enhanced send button detection: exclude 'Stop generating' buttons
      const getSendButton = () => {
          const btns = Array.from(document.querySelectorAll('button'));
          return btns.find(b => {
              const label = (b.ariaLabel || b.title || b.innerText || "").toLowerCase();
              return (label.includes('send') || label.includes('submit')) && !label.includes('stop');
          }) || document.querySelector('button[aria-label*="Send message"]') ||
                document.querySelector('button[aria-label*="Send"]') ||
                document.querySelector('button[title*="Send"]');
      };

      const stopButton = Array.from(document.querySelectorAll('button')).find(b => {
          const label = (b.ariaLabel || b.title || b.innerText || "").toLowerCase();
          return label.includes('stop');
      });

      if (stopButton) {
          console.log("Gemini is currently generating (Stop button present). Waiting to see if it clears...");
      }

      const sendButton = getSendButton();

      if (sendButton && !sendButton.disabled) {
        // Count messages RIGHT BEFORE sending to ensure accurate baseline
        lastMessageCount = document.querySelectorAll('message-content, .message-content').length;
        sendButton.click();
        resolve();
      } else {
        console.warn('Send button not immediately found or is disabled. Retrying...');

        let retries = 10;
        const retryInterval = setInterval(() => {
           const btn = getSendButton();
           const isGenerating = !!Array.from(document.querySelectorAll('button')).find(b => (b.ariaLabel||"").toLowerCase().includes('stop'));

           if (btn && !btn.disabled && !isGenerating) {
              clearInterval(retryInterval);
              lastMessageCount = document.querySelectorAll('message-content, .message-content').length;
              btn.click();
              resolve();
           } else if (--retries <= 0) {
              clearInterval(retryInterval);
              // Fallback to Enter key if button is still problematic but input is ready
              lastMessageCount = document.querySelectorAll('message-content, .message-content').length;
              console.log("Button retry exhausted. Attempting Enter key fallback.");
              chatInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
              chatInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
              resolve();
           }
        }, 1000);
      }
    }, uploadDelay); // Dynamic delay based on whether an image was uploaded
  });
}

function pollForResponse() {
  if (pollInterval) clearInterval(pollInterval);
  if (responseObserver) responseObserver.disconnect(); // Legacy clean up

  let lastText = '';
  let stableCount = 0;

  // Fallback timeout to prevent infinite hanging
  timeoutId = setTimeout(() => {
      cleanup();
      console.error('Timed out waiting for Gemini response.');
      try {
          if (chrome.runtime && chrome.runtime.id) {
              chrome.runtime.sendMessage({ type: 'GEMINI_RESPONSE', text: null }).catch(() => {});
          }
      } catch (e) {}
  }, 150000); // 150s to match background timeout

  // Keep MV3 Service Worker alive during long generation
  keepAliveInterval = setInterval(() => {
      try {
          if (chrome.runtime && chrome.runtime.id) {
              chrome.runtime.sendMessage({ type: 'KEEPALIVE' }).catch(() => {});
          } else {
              cleanup();
          }
      } catch (e) {
          cleanup();
      }
  }, 10000);

  pollInterval = setInterval(() => {
    // Detect context invalidation
    if (!chrome.runtime || !chrome.runtime.id) {
        cleanup();
        return;
    }
    const isGenerating = document.querySelector('model-response-indicator') ||
                         document.querySelector('.generating-indicator') ||
                         document.querySelector('.dot-flashing') ||
                         document.body.innerText.includes('Gemini is typing') ||
                         !!Array.from(document.querySelectorAll('button')).find(b => (b.ariaLabel||"").toLowerCase().includes('stop'));

    const messages = document.querySelectorAll('message-content, .message-content');
    if (messages.length > lastMessageCount) {
        const newestMessage = messages[messages.length - 1];
        
        let text = '';
        if (newestMessage) {
           text = newestMessage.innerText || newestMessage.textContent || "";
        } else {
           const pTags = document.querySelectorAll('p');
           if (pTags.length > 0) text = pTags[pTags.length - 1].innerText;
        }

        // Wait until generation flag explicitly clears
        if (isGenerating) {
            stableCount = 0;
            lastText = text;
            return;
        }

        if (text === lastText && text.trim() !== '') {
            stableCount++;
        } else {
            lastText = text;
            stableCount = 0;
        }

        // If not generating and text has been physically stable for 3 UI ticks (1500ms)
        if (stableCount >= 3) {
            // Require valid JSON termination if possible, but allow fallback if stable for many ticks
            const isJsonTerminated = text.trim().endsWith('}');
            
            if (isJsonTerminated || stableCount >= 10) {
                clearTimeout(timeoutId);
                clearInterval(pollInterval);
                if (keepAliveInterval) clearInterval(keepAliveInterval);
                pollInterval = null;
                isProcessingPrompt = false;
                
                log(`Response gathered (stableCount: ${stableCount}, json: ${isJsonTerminated})`);
                try {
                    if (chrome.runtime && chrome.runtime.id) {
                        chrome.runtime.sendMessage({ type: 'GEMINI_RESPONSE', text });
                    }
                } catch (e) {}
            }
        }
    }
  }, 500);
}
