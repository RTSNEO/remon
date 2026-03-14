const vm = require('vm');
const assert = require('assert');

// Mock chrome API
const chrome = {
  tabs: {
    onUpdated: {
      listeners: [],
      addListener(l) { this.listeners.push(l); },
      removeListener(l) { this.listeners = this.listeners.filter(i => i !== l); },
      trigger(tabId, changeInfo) {
        this.listeners.forEach(l => l(tabId, changeInfo));
      }
    },
    onRemoved: {
      listeners: [],
      addListener(l) { this.listeners.push(l); },
      removeListener(l) { this.listeners = this.listeners.filter(i => i !== l); },
      trigger(tabId) {
        this.listeners.forEach(l => l(tabId));
      }
    },
    get(tabId, callback) {
        // Default behavior: return a tab that is still loading
        setTimeout(() => callback({ id: tabId, status: 'loading' }), 0);
    }
  },
  runtime: {
    lastError: null
  }
};

const context = {
  chrome,
  isRunning: true,
  setInterval,
  clearInterval,
  console,
  setTimeout
};

vm.createContext(context);

const scriptContent = `
function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(updatedListener);
      chrome.tabs.onRemoved.removeListener(removedListener);
      if (stopCheckInterval) clearInterval(stopCheckInterval);
    };

    const updatedListener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        cleanup();
        resolve('completed');
      }
    };

    const removedListener = (removedTabId) => {
      if (removedTabId === tabId) {
        cleanup();
        resolve('removed');
      }
    };

    chrome.tabs.onUpdated.addListener(updatedListener);
    chrome.tabs.onRemoved.addListener(removedListener);

    const stopCheckInterval = setInterval(() => {
      if (!isRunning) {
        cleanup();
        resolve('stopped');
      }
    }, 10);

    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab || tab.status === 'complete') {
        cleanup();
        resolve('initial_complete');
      }
    });
  });
}
`;

vm.runInContext(scriptContent, context);

async function test() {
  console.log('Running tests for waitForTabComplete...');

  // Test 1: Tab finishes loading
  console.log('Test 1: Tab finishes loading');
  const p1 = context.waitForTabComplete(123);
  setTimeout(() => {
    chrome.tabs.onUpdated.trigger(123, { status: 'complete' });
  }, 50);
  const res1 = await p1;
  assert.strictEqual(res1, 'completed');
  assert.strictEqual(chrome.tabs.onUpdated.listeners.length, 0);
  console.log('Test 1 passed');

  // Test 2: Tab is removed
  console.log('Test 2: Tab is removed');
  const p2 = context.waitForTabComplete(456);
  setTimeout(() => {
    chrome.tabs.onRemoved.trigger(456);
  }, 50);
  const res2 = await p2;
  assert.strictEqual(res2, 'removed');
  assert.strictEqual(chrome.tabs.onRemoved.listeners.length, 0);
  console.log('Test 2 passed');

  // Test 3: Agent is stopped
  console.log('Test 3: Agent is stopped');
  context.isRunning = true;
  const p3 = context.waitForTabComplete(789);
  setTimeout(() => {
    context.isRunning = false;
  }, 50);
  const res3 = await p3;
  assert.strictEqual(res3, 'stopped');
  console.log('Test 3 passed');

  // Test 4: Tab already complete
  console.log('Test 4: Tab already complete');
  chrome.tabs.get = (id, cb) => cb({ id, status: 'complete' });
  const res4 = await context.waitForTabComplete(101);
  assert.strictEqual(res4, 'initial_complete');
  console.log('Test 4 passed');

  console.log('All tests passed!');
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
