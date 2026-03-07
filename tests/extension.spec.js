const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

test('Extension loads and Side Panel works', async () => {
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
    // 1. Check if the Service Worker started
    let [background] = browserContext.serviceWorkers();
    if (!background) {
      background = await browserContext.waitForEvent('serviceworker');
    }
    expect(background).toBeTruthy();

    // 2. Open the Side Panel by navigating to its exact URL.
    // First, we need to find the extension ID.
    const extensionId = background.url().split('/')[2];

    const page = await browserContext.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    // 3. Verify the Side Panel UI
    await expect(page.locator('h2')).toHaveText('Gemini Auto Browser');

    const goalInput = page.locator('#goalInput');
    await expect(goalInput).toBeVisible();

    // Type a goal and start
    await goalInput.fill('Find a cool job');
    const startBtn = page.locator('#startBtn');
    await expect(startBtn).toBeEnabled();
    await startBtn.click();

    // Verify State Change
    const stopBtn = page.locator('#stopBtn');
    await expect(stopBtn).toBeEnabled();
    await expect(goalInput).toBeDisabled();
    await expect(startBtn).toBeDisabled();

    // Verify logs
    const logArea = page.locator('#logArea');
    await expect(logArea).toContainText('Starting agent with goal: "Find a cool job"');

    // Take a screenshot
    await page.screenshot({ path: '/tmp/verification.png' });

  } finally {
    // Teardown
    await browserContext.close();
  }
});