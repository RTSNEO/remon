const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

test('Verify Side Panel UI screenshot', async () => {
  const pathToExtension = path.join(__dirname, 'extension');
  const userDataDir = '/tmp/test-user-data-dir';

  // Launch Chromium with the extension
  const browserContext = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
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
    const extensionId = background.url().split('/')[2];

    const page = await browserContext.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    await page.locator('#goalInput').fill('Find a cool job');
    await page.locator('#startBtn').click();

    await page.waitForTimeout(1000); // Give log a moment to populate
    await page.screenshot({ path: 'screenshot.png' });

  } finally {
    await browserContext.close();
  }
});
