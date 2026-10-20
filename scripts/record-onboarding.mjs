// Records the real onboarding walkthrough (Settings > App walkthrough) to artifacts/onboarding-demo.webm.
// Usage: bun run dev server first (`bun run start`), then `node scripts/record-onboarding.mjs`.
// Prerequisites: install Playwright's Chromium and FFmpeg with
// `node ./node_modules/playwright-core/cli.js install chromium`. Set CHROME_BIN to use a system
// Chromium instead of the cached browser; the FFmpeg installation is still required.
// Env: APP_URL (default http://localhost:4200), CHROME_BIN (optional Chromium path).
import { chromium } from 'playwright-core';
import { mkdirSync, renameSync, rmSync } from 'node:fs';

const APP_URL = process.env.APP_URL ?? 'http://localhost:4200';
const OUT_DIR = 'artifacts';
const OUT_FILE = `${OUT_DIR}/onboarding-demo.webm`;
const VIEWPORT = { width: 390, height: 844 };
const STEP_PAUSE_MS = 2600;

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
mkdirSync(OUT_DIR, { recursive: true });
rmSync(`${OUT_DIR}/.tmp-video`, { recursive: true, force: true });

// Setup (not recorded): sign in via the existing "Use without account" flow and
// dismiss the automatic first-run tour so the recording starts from a returning user.
const setup = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
const setupPage = await setup.newPage();
await setupPage.goto(APP_URL);
await setupPage.getByRole('button', { name: 'Use without account' }).click();
await setupPage.waitForURL('**/dashboard');
await setupPage.locator('.ob-skip').click();
await setupPage.locator('.ob-root').waitFor({ state: 'detached' });
const state = await setup.storageState({ indexedDB: true });
await setup.close();

// Recorded session.
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  storageState: state,
  recordVideo: { dir: `${OUT_DIR}/.tmp-video`, size: VIEWPORT },
});
const page = await context.newPage();
await page.goto(`${APP_URL}/settings`);
await page.getByText('App walkthrough').waitFor();
await page.waitForTimeout(800);
await page.getByText('App walkthrough').click();

const titles = ['Welcome to Salapi', 'Your money at a glance', 'Record your spending', 'Save with purpose', 'You’re all set!'];
for (let i = 0; i < titles.length; i++) {
  await page.locator('.ob-card h2', { hasText: titles[i] }).waitFor();
  console.log(`Step ${i + 1}/5 visible: ${titles[i]}`);
  if (i === 1 || i === 2 || i === 3) await page.locator('.ob-spot').waitFor();
  if (i === 3) await page.locator('.ob-types li').nth(2).waitFor();
  await page.waitForTimeout(STEP_PAUSE_MS);
  if (i < titles.length - 1) await page.locator('.ob-next').click();
}
await page.locator('.ob-start').click();
await page.locator('.ob-root').waitFor({ state: 'detached' });
await page.waitForTimeout(800);

const video = page.video();
await context.close();
renameSync(await video.path(), OUT_FILE);
rmSync(`${OUT_DIR}/.tmp-video`, { recursive: true, force: true });
await browser.close();
console.log(`Saved ${OUT_FILE}`);
