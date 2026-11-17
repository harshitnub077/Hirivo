// scripts/site-assets.js
// Regenerates the website's images: the four side-panel captures in web/public/shots (2x, from the
// demo panel) and the 1200×630 social preview web/public/og.png (from web/og.template.html).
// Needs Playwright with Chromium (npx playwright install chromium) and two dev servers:
//   npm run preview:panel    (port 5199)      npm run site:dev    (port 5200)
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Install Playwright first: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const browser = await chromium.launch();
const panel = await browser.newPage({ viewport: { width: 380, height: 720 }, deviceScaleFactor: 2 });
for (const view of ['now', 'radar', 'pipeline', 'you']) {
  await panel.goto(`http://localhost:5199/sidepanel.html?demo&view=${view}`);
  await panel.waitForTimeout(2500); // the demo seeds, then the verdicts animate in
  await panel.screenshot({ path: path.join(root, `web/public/shots/${view}.png`) });
  console.log(`web/public/shots/${view}.png`);
}

const og = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await og.goto('http://localhost:5200/og.template.html');
await og.waitForTimeout(800);
await og.screenshot({ path: path.join(root, 'web/public/og.png') });
console.log('web/public/og.png');
await browser.close();
