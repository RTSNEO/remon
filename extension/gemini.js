// gemini.js

let isProcessingPrompt = false;
let lastMessageCount = 0;
let pollInterval = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SEND_PROMPT') {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
    isProcessingPrompt = true;

    sendPromptToGemini(message.prompt)
      .then(() => {
        sendResponse({ status: 'sent' });
        // Start polling for the response
        pollForResponse();
      })
      .catch((err) => {
        isProcessingPrompt = false;
        sendResponse({ status: 'error', error: err.message });
      });
    return true; // async response
  }
});

async function sendPromptToGemini(promptText) {
  return new Promise((resolve, reject) => {
    // 1. Find the chat input
    // The selector may change over time on Gemini. Common ones:
    // rich-textarea, .ql-editor, div[contenteditable="true"]
    const chatInput = document.querySelector('rich-textarea div[contenteditable="true"]') ||
                      document.querySelector('div[data-placeholder="Ask Gemini"]') ||
                      document.querySelector('.ql-editor') ||
                      document.querySelector('div[aria-label="Message Gemini"]') ||
                      document.querySelector('div[role="textbox"][contenteditable="true"]') ||
                      document.querySelector('textarea'); // Fallback

    if (!chatInput) {
      reject(new Error('Could not find chat input element on Gemini page.'));
      return;
    }

    // 2. Count current messages to know when a new one arrives
    const messages = document.querySelectorAll('message-content, .message-content');
    lastMessageCount = messages.length;

    // 3. Insert text
    chatInput.focus();
    // Use execCommand to insert text as it correctly triggers React/Angular synthetic events
    // If it fails, fallback to direct textContent + event dispatching
    const successful = document.execCommand('insertText', false, promptText);

    if (!successful) {
      // Fallback
      chatInput.textContent = promptText;
      chatInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 4. Find and click send button
    setTimeout(() => {
      const sendButton = document.querySelector('button[aria-label*="Send message"]') ||
                         document.querySelector('button[aria-label*="Send"]') ||
                         document.querySelector('.send-button') ||
                         document.querySelector('button[title*="Send"]');

      if (sendButton && !sendButton.disabled) {
        sendButton.click();
        resolve();
      } else {
        console.warn('Send button not immediately found or is disabled. Retrying...');

        let retries = 5;
        const retryInterval = setInterval(() => {
           const btn = document.querySelector('button[aria-label*="Send message"]') ||
                       document.querySelector('button[aria-label*="Send"]') ||
                       document.querySelector('.send-button') ||
                       document.querySelector('button[title*="Send"]');

           if (btn && !btn.disabled) {
              clearInterval(retryInterval);
              btn.click();
              resolve();
           } else if (--retries <= 0) {
              clearInterval(retryInterval);
              // Fallback to Enter key
              chatInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
              chatInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
              resolve();
           }
        }, 500);
      }
    }, 500); // Give UI a moment to register input
  });
}

function pollForResponse() {
  let attempts = 0;
  const maxAttempts = 120; // 60 seconds (500ms * 120)

  pollInterval = setInterval(() => {
    attempts++;

    // Look for the "Generating..." indicator. If it's there, keep waiting.
    const isGenerating = document.querySelector('model-response-indicator') ||
                         document.querySelector('.generating-indicator') ||
                         document.body.innerText.includes('Gemini is typing'); // crude fallback

    const messages = document.querySelectorAll('message-content, .message-content');

    // If the message count increased AND we are not currently generating a response
    if (messages.length > lastMessageCount && !isGenerating) {
      // The newest message is the last one in the list
      const newestMessage = messages[messages.length - 1];

      // Get the text content of the message
      let text = newestMessage.innerText;

      // Sometimes it takes a moment for the text to fully render after the indicator disappears
      if (text.trim() === '') {
         return; // wait a bit more
      }

      clearInterval(pollInterval);
      pollInterval = null;
      isProcessingPrompt = false;

      // Send the response back to background script
      chrome.runtime.sendMessage({ type: 'GEMINI_RESPONSE', text });

    } else if (attempts >= maxAttempts) {
      clearInterval(pollInterval);
      pollInterval = null;
      isProcessingPrompt = false;
      console.error('Timed out waiting for Gemini response.');
      chrome.runtime.sendMessage({ type: 'GEMINI_RESPONSE', text: '{"action":"done", "reason":"Timeout waiting for AI"}' });
    }
  }, 500);
}
