const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const userDataDir = path.join(__dirname, 'user_data');

async function login() {
  console.log('Starting Playwright in non-headless mode for manual login...');

  // Create user data directory if it doesn't exist
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  // Launch browser with persistent context
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: null, // Maximize window
  });

  const page = context.pages()[0] || await context.newPage();

  console.log('Navigating to Google Sign-In...');
  await page.goto('https://accounts.google.com/', { waitUntil: 'domcontentloaded' });

  console.log('----------------------------------------------------');
  console.log('IMPORTANT: Please manually log into your Google account in the opened browser window.');
  console.log('Once you are successfully logged in, navigate to gemini.google.com to verify access.');
  console.log('Close the browser window when you are finished to save the session.');
  console.log('----------------------------------------------------');

  // Wait for the context to close manually by the user
  await new Promise(resolve => {
    context.on('close', resolve);
  });

  console.log('Session saved successfully to:', userDataDir);
  console.log('You can now run the automated document generation agent.');
}

login().catch(console.error);
