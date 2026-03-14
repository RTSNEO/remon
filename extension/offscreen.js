// offscreen.js

// Send a ping every 20 seconds to keep the service worker alive.
setInterval(() => {
  chrome.runtime.sendMessage({ type: 'KEEPALIVE_PING', source: 'offscreen' });
}, 20000);
