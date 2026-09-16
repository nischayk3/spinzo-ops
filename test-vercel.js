const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log(`BROWSER CONSOLE: ${msg.type()} - ${msg.text()}`));
  page.on('pageerror', error => console.log(`BROWSER ERROR: ${error.message}`));
  
  console.log("Navigating...");
  await page.goto('https://spinzo-opsnosync.vercel.app/', { waitUntil: 'networkidle' });
  console.log("Loaded.");
  
  await browser.close();
})();
