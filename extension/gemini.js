// gemini.js

let isProcessingPrompt = false;
let lastMessageCount = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SEND_PROMPT') {
    if (isProcessingPrompt) {
       sendResponse({ status: 'busy' });
       return;
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
                      document.querySelector('.ql-editor') ||
                      document.querySelector('div[aria-label="Message Gemini"]') ||
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
      const sendButton = document.querySelector('button[aria-label="Send message"]') ||
                         document.querySelector('.send-button') ||
                         document.querySelector('button[title="Send message"]');

      if (sendButton && !sendButton.disabled) {
        sendButton.click();
        resolve();
      } else {
        // If button not found, try pressing Enter (if it's not a multiline textarea requiring Ctrl+Enter)
        // Gemini usually uses Ctrl+Enter or a send button for multi-line. We'll try to find the button again.
        console.warn('Send button not immediately found or is disabled. Retrying...');

        let retries = 5;
        const retryInterval = setInterval(() => {
           const btn = document.querySelector('button[aria-label="Send message"]') ||
                       document.querySelector('.send-button') ||
                       document.querySelector('button[title="Send message"]');
           if (btn && !btn.disabled) {
              clearInterval(retryInterval);
              btn.click();
              resolve();
           } else if (--retries <= 0) {
              clearInterval(retryInterval);
              reject(new Error('Could not find or click the send button.'));
           }
        }, 500);
      }
    }, 500); // Give UI a moment to register input
  });
}

function pollForResponse() {
  let attempts = 0;
  const maxAttempts = 120; // 60 seconds (500ms * 120)

  const interval = setInterval(() => {
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

      clearInterval(interval);
      isProcessingPrompt = false;

      // Send the response back to background script
      chrome.runtime.sendMessage({ type: 'GEMINI_RESPONSE', text });

    } else if (attempts >= maxAttempts) {
      clearInterval(interval);
      isProcessingPrompt = false;
      console.error('Timed out waiting for Gemini response.');
      chrome.runtime.sendMessage({ type: 'GEMINI_RESPONSE', text: '{"action":"done", "reason":"Timeout waiting for AI"}' });
    }
  }, 500);
}
