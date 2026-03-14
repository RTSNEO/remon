const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const pathToExtension = path.join(__dirname, '../extension');
  const userDataDir = '/tmp/test-user-data-dir-linkedin';

  const browserContext = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: [
      `--disable-extensions-except=${pathToExtension}`,
      `--load-extension=${pathToExtension}`,
    ],
  });

  try {
    let [background] = browserContext.serviceWorkers();
    if (!background) {
      background = await browserContext.waitForEvent('serviceworker');
    }

    const storage = await background.evaluate(async () => {
        return new Promise((resolve) => {
           chrome.storage.local.get(null, (data) => {
               resolve(data);
           });
        });
    });

    console.log('--- Extension Storage ---');
    console.log(JSON.stringify(storage, null, 2));

  } catch (error) {
     console.error("Failed to read storage:", error);
  } finally {
    await browserContext.close();
  }
})();
