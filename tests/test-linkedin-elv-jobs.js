const { chromium } = require('playwright');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

(async () => {
  const pathToExtension = path.join(__dirname, '../extension');
  // Use a permanent user data directory so sessions persist between runs
  const userDataDir = path.join(__dirname, '../.test-user-data');

  console.log('Launching browser with extension in headed mode...');
  const browserContext = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // MUST BE FALSE to allow manual login and visual verification
    viewport: null, // use default window size
    args: [
      `--disable-extensions-except=${pathToExtension}`,
      `--load-extension=${pathToExtension}`,
      '--start-maximized'
    ],
  });

  try {
    // 1. Ensure Background Service Worker is running
    let [background] = browserContext.serviceWorkers();
    if (!background) {
      background = await browserContext.waitForEvent('serviceworker');
    }
    const extensionId = background.url().split('/')[2];
    console.log(`Extension Loaded! ID: ${extensionId}`);

    // 2. Give the user an opportunity to log into Gemini
    const geminiPage = await browserContext.newPage();
    await geminiPage.goto('https://gemini.google.com/', { waitUntil: 'domcontentloaded' });

    console.log('\n--- ACTION REQUIRED ---');
    console.log('1. A new browser window has opened.');
    console.log('2. Please ensure you are logged into Google and can access Gemini (https://gemini.google.com/).');
    await askQuestion('Press ENTER here in the terminal when you are fully logged into Gemini...');

    // 3. Give the user an opportunity to log into LinkedIn
    const linkedinPage = await browserContext.newPage();
    await linkedinPage.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

    console.log('\n--- ACTION REQUIRED ---');
    console.log('1. Please log into LinkedIn in the browser window.');
    console.log('2. Navigate past any security checks or CAPTCHAs.');
    await askQuestion('Press ENTER here in the terminal when you are fully logged into LinkedIn and on the main feed/jobs page...');

    // 4. Open the Extension Side Panel
    console.log('\nOpening the Extension Side Panel...');
    const sidePanelPage = await browserContext.newPage();
    await sidePanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    // 5. Navigate LinkedIn to the starting point (Jobs page)
    console.log('Navigating LinkedIn to the Jobs page as a starting point...');
    await linkedinPage.bringToFront(); // Ensure LinkedIn is active tab for the extension
    await linkedinPage.goto('https://www.linkedin.com/jobs/', { waitUntil: 'load' });
    await linkedinPage.waitForTimeout(2000); // Give it a moment to settle

    // 6. Enter the goal and start the agent
    console.log('Entering goal into the Side Panel...');
    await sidePanelPage.bringToFront();
    const goalInput = sidePanelPage.locator('#goalInput');
    const startBtn = sidePanelPage.locator('#startBtn');

    await goalInput.fill('Find 10 ELV (Extra Low Voltage) jobs in UAE on LinkedIn');
    await startBtn.click();
    console.log('Agent Started! Switch to the LinkedIn tab to watch it work.');

    await linkedinPage.bringToFront();

    console.log('\n--- THE AGENT IS RUNNING ---');
    console.log('Watch the terminal or the Side Panel logs to see what Gemini is doing.');
    console.log('The test will run indefinitely to allow the agent to work.');
    await askQuestion('When you are satisfied with the test, press ENTER to close the browser and end the test...');

  } catch (error) {
     console.error("Test failed with error:", error);
  } finally {
    console.log('Closing browser...');
    await browserContext.close();
    rl.close();
  }
})();
