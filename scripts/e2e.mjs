/**
 * End-to-end check in a real browser (Playwright + Chromium).
 *
 * Verifies the built app: engraving, tab navigation, live playback, the audio
 * analysis worker, and offline reload from the service worker cache.
 *
 * Usage: npm run build && npx vite preview --port 4173 & node scripts/e2e.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.E2E_URL ?? 'http://localhost:4173/';
const results = [];
const errors = [];

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

await page.goto(BASE, { waitUntil: 'networkidle' });
check('page loads', (await page.title()).includes('QuanDMusic'));

await page.getByRole('button', { name: /demo chorale/i }).click();
await page.waitForSelector('.score-canvas svg', { timeout: 20000 });
const paths = await page.locator('.score-canvas svg path').count();
const svgTexts = await page.locator('.score-canvas svg text').allTextContents();
check('score is engraved', paths > 50, `${paths} paths`);
check('solfege labels under notes', svgTexts.includes('m') && svgTexts.includes('d'));
check('four part names in the staves', ['Soprano', 'Alto', 'Tenor', 'Bass'].every((name) => svgTexts.includes(name)));

mkdirSync('docs', { recursive: true });
await page.screenshot({ path: 'docs/score.png', fullPage: true });

// Playback: the transport position must advance.
await page.getByRole('button', { name: 'Play', exact: true }).click();
await page.waitForTimeout(1200);
const positionText = await page.locator('.transport .position').textContent();
check('playback advances the cursor', !/bar 1 · 0 beats/.test(positionText ?? ''), positionText ?? '');
await page.screenshot({ path: 'docs/playing.png', fullPage: true });
await page.getByRole('button', { name: 'Stop', exact: true }).click();

// Transposition updates the printed key.
const keyBefore = await page.locator('.controls .value').first().textContent();
await page.locator('select[aria-label="Transpose to a key"]').selectOption('D major');
await page.waitForTimeout(300);
const keyAfter = await page.locator('.controls .value').first().textContent();
check('transposition changes the key', keyAfter === 'D major', `${keyBefore} -> ${keyAfter}`);
await page.getByRole('button', { name: '+1', exact: true }).click();
const keyUpOne = await page.locator('.controls .value').first().textContent();
check('single semitone transposition', keyUpOne === 'Eb major', String(keyUpOne));
await page.locator('select[aria-label="Transpose to a key"]').selectOption('C major');
await page.waitForTimeout(200);

// Practice tab.
await page.getByRole('button', { name: 'Practice', exact: true }).click();
check('practice tab renders', await page.getByText('Practice room').isVisible());
check('practice guide shows the sounding note', await page.getByText(/Now:/).isVisible());
await page.getByRole('button', { name: 'Alto', exact: false }).first().click();
await page.screenshot({ path: 'docs/practice.png', fullPage: true });

// Instrument tab: the trumpet scale must carry computed fingerings.
await page.getByRole('button', { name: 'Instrument', exact: true }).click();
const instrumentText = await page.locator('.scale-table').first().innerText();
check('instrument scale has fingerings', /open|1·2|1·3|2·3/.test(instrumentText), instrumentText.split('\n').slice(0, 6).join(' / '));
const flatsText = await page.locator('.scale-table').nth(1).innerText();
check('flats drill lists flat notes', /♭[\s\S]*b/.test(flatsText), flatsText.split('\n').slice(0, 6).join(' / '));
await page.screenshot({ path: 'docs/instrument.png', fullPage: true });

// Switch instruments: trombone shows slide positions, guitar shows frets.
await page.locator('.field select').first().selectOption('trombone');
const slideText = await page.locator('.scale-table').first().innerText();
check('trombone shows slide positions', /1st position|2nd position|3rd position/.test(slideText), slideText.split('\n').slice(0, 4).join(' / '));
await page.locator('.field select').first().selectOption('guitar');
const guitarText = await page.locator('.scale-table').first().innerText();
check('guitar shows fret positions', /fret|open/.test(guitarText), guitarText.split('\n').slice(0, 4).join(' / '));
await page.screenshot({ path: 'docs/guitar.png', fullPage: true });
await page.locator('.field select').first().selectOption('trumpet');

// Audio analysis in the worker, from a synthesized performance.
await page.getByRole('button', { name: 'Upload', exact: true }).click();
const started = Date.now();
await page.getByRole('button', { name: /Analyse a synthesized performance/i }).click();
await page.waitForFunction(
  () => document.body.innerText.includes('Analysed the demo audio'),
  undefined,
  { timeout: 180000 },
);
const notice = await page.locator('.banner.notice').innerText();
const seconds = ((Date.now() - started) / 1000).toFixed(1);
check('worker audio analysis finishes', /notes/.test(notice), `${notice.replace(/\s+/g, ' ')} (${seconds}s)`);
const analysedLabels = await page.locator('.score-canvas svg text').allTextContents();
check('analysed score has notes', analysedLabels.filter((text) => /^[drmafslte,']+$/.test(text)).length > 8);
await page.screenshot({ path: 'docs/analysed.png', fullPage: true });

// Offline: the service worker must serve the app after a reload with no network.
await page.evaluate(async () => {
  await navigator.serviceWorker.ready;
});
await page.reload({ waitUntil: 'networkidle' });
await context.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' });
const offlineBrand = await page.locator('.brand strong').textContent();
check('app reloads offline from cache', offlineBrand === 'QuanDMusic', offlineBrand ?? '');
await context.setOffline(false);

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
