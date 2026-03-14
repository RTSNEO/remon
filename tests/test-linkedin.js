const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const pathToExtension = path.join(__dirname, '../extension');
  const userDataDir = '/tmp/test-user-data-dir-linkedin';

  console.log('Launching browser with extension...');
  const browserContext = await chromium.launchPersistentContext(userDataDir, {
    headless: true, // we can run headless for this
    args: [
      `--disable-extensions-except=${pathToExtension}`,
      `--load-extension=${pathToExtension}`,
    ],
  });

  try {
    const page = await browserContext.newPage();
    
    // Listen for console errors on the page
    page.on('console', msg => {
        if (msg.type() === 'error')
            console.error(`PAGE ERROR: "${msg.text()}"`);
    });
    page.on('pageerror', error => {
        console.error(`PAGE EXCEPTION: "${error.message}"`);
    });

    console.log('Navigating to LinkedIn Jobs...');
    await page.goto('https://www.linkedin.com/jobs/', { waitUntil: 'load' });

    console.log('Page loaded. Wait a moment for dynamic elements...');
    await page.waitForTimeout(3000);

    // Removed failing page.evaluate block

    // Instead of the above, let's just evaluate the extractContext locally to see if it throws error
    // because content.js is in an isolated world, we can't easily call it. 
    // We can inject our own similar script just to test the logic.
    
    // BUT we have the background service worker!
    let [background] = browserContext.serviceWorkers();
    if (!background) {
      background = await browserContext.waitForEvent('serviceworker');
    }

    // Ask the background worker to get the context of target tab
    console.log('Asking background worker to trigger context extraction...');
    const contextStr = await background.evaluate(async () => {
        return new Promise((resolve) => {
           chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
               chrome.tabs.sendMessage(tabs[0].id, { type: 'EXTRACT_CONTEXT' }, (response) => {
                  if (chrome.runtime.lastError) {
                      resolve("Error: " + chrome.runtime.lastError.message);
                  } else {
                      resolve(response ? response.context : "No context returned");
                  }
               });
           });
        });
    });

    if (contextStr && contextStr.startsWith('Error:')) {
        console.error('Extraction failed:', contextStr);
    } else {
        console.log(`Successfully extracted ${contextStr.length} characters of context from LinkedIn!`);
        console.log('Snippet:', contextStr.substring(0, 300) + '...');
    }

  } catch (error) {
     console.error("Test failed with error:", error);
  } finally {
    console.log('Closing browser...');
    await browserContext.close();
  }
})();
