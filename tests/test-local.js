const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const contentJsPath = path.join(__dirname, '../extension/content.js');
  const testPageUrl = 'file://' + path.join(__dirname, 'test-page.html');

  console.log('Launching browser...');
  const browserContext = await chromium.launchPersistentContext('/tmp/test-local-dir', {
    headless: true
  });

  try {
    const page = await browserContext.newPage();
    
    console.log(`Navigating to ${testPageUrl}...`);
    await page.goto(testPageUrl, { waitUntil: 'load' });
    
    console.log('Injecting content.js...');
    await page.addScriptTag({ path: contentJsPath });

    console.log('Step 1: Testing Context Extraction (Active State Detection)...');
    
    const contextResult = await page.evaluate(async () => {
        return new Promise((resolve) => {
           window.geminiMessageListener(
               { type: 'EXTRACT_CONTEXT' }, 
               {}, 
               (response) => resolve(response.context)
           );
        });
    });

    console.log('--- Context Result ---');
    console.log(contextResult);
    
    if (contextResult && contextResult.includes('Jobs (Active)') && contextResult.includes('(ACTIVE)')) {
        console.log('✅ Active state detection WORKING! (button marked ACTIVE)');
    } else {
        console.log('❌ Active state detection FAILED.');
    }

    console.log('\nStep 2: Testing new "key" action on input form...');
    
    const match = contextResult ? contextResult.match(/\[(\d+)\] <input> "Type here"/) : null;
    if (!match) throw new Error('Could not find the input element ID in the context text.');
    
    const inputId = parseInt(match[1], 10);
    console.log(`Found input element ID: ${inputId}. Sending 'key' Enter action...`);

    const actionResult = await page.evaluate(async (id) => {
        return new Promise((resolve) => {
           window.geminiMessageListener(
               { type: 'EXECUTE_ACTION', action: { action: 'key', id: id, key: 'Enter' } }, 
               {}, 
               (response) => resolve(response)
           );
        });
    }, inputId);

    console.log('Response from execute_action:', actionResult);

    await page.waitForTimeout(500);
    const resultText = await page.evaluate(() => document.getElementById('form-result').innerText);
    console.log(`Page Form Result Text: "${resultText}"`);

    if (resultText && resultText.includes('Submitted') && resultText.includes('Enter Key Pressed')) {
        console.log('✅ Key action WORKING! Both event listener AND form submission triggered.');
    } else {
        console.log('❌ Key action FAILED or incomplete.');
    }

  } catch (error) {
     console.error("Test failed with error:", error);
  } finally {
    console.log('\nClosing browser...');
    await browserContext.close();
  }
})();
