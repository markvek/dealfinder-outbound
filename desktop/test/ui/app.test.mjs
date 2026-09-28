import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = fileURLToPath(new URL('../../', import.meta.url));
const id = '0123456789abcdef0123456789abcdef';

async function browserPage(t, existing = false, failSchedule = false) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 920, height: 780 } });
  await page.addInitScript(({ existing, failSchedule, id }) => {
    let configured = existing;
    window.calls = [];
    window.dealfinder = {
      onProgress: () => {}, onSettings: () => {},
      open: async target => { window.calls.push({ open: target }); return { ok: true }; },
      action: async (command, values) => {
        window.calls.push({ command, values });
        if (command === 'status') return { ok: true, value: { configured, hasConfig: configured,
          config: configured ? { provider: 'openai', model: 'test-model', parentPage: id } : null,
          scheduler: { installed: !failSchedule }, lastRun: null } };
        if (command === 'setup') { configured = true; if (failSchedule) return { ok: false, error: 'Background scheduling failed. Repair background checks.' }; }
        return { ok: true, value: { message: 'Connections saved.' } };
      },
    };
  }, { existing, failSchedule, id });
  await page.goto(new URL('../../renderer/index.html', import.meta.url).href);
  return page;
}

async function completeWizard(page) {
  await page.locator('#aiKey').fill('fake-ai-key');
  await page.locator('#model').fill('test-model');
  await page.locator('#next').click();
  await page.locator('#notionKey').fill('fake-notion-key');
  await page.locator('#parentPage').fill(`https://www.notion.so/${id}`);
  await page.locator('#next').click();
  await page.locator('#timezone').fill('UTC');
  await page.locator('#next').click();
  await page.locator('#dashboard').waitFor({ state: 'visible' });
}

test('wizard validates steps, submits once, clears secrets, and links back to Notion', async t => {
  const page = await browserPage(t);
  await page.locator('#wizard').waitFor({ state: 'visible' });
  await page.locator('#next').click();
  assert.equal(await page.locator('[data-step="0"]').isVisible(), true);
  await completeWizard(page);
  const calls = await page.evaluate(() => window.calls.filter(c => c.command === 'setup'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].values.aiKey, 'fake-ai-key');
  assert.equal(calls[0].values.timezone, 'UTC');
  assert.equal(await page.locator('#aiKey').inputValue(), '');
  assert.equal(await page.locator('#notionKey').inputValue(), '');
  await page.locator('#notion-link').click();
  assert.equal(await page.evaluate(() => window.calls.at(-1).open), 'workspace');
});

test('partial scheduling failure retains useful error and provides Repair', async t => {
  const page = await browserPage(t, false, true);
  await completeWizard(page);
  assert.match(await page.locator('#notice').textContent(), /scheduling failed/);
  await page.locator('#repair').click();
  await page.waitForFunction(() => window.calls.some(c => c.command === 'schedule'));
});

test('existing installation opens status and lets the user update credentials without changing workspace', async t => {
  const page = await browserPage(t, true);
  await page.locator('#dashboard').waitFor({ state: 'visible' });
  await page.locator('#reconnect').click();
  assert.equal(await page.locator('#model').inputValue(), 'test-model');
  assert.equal(await page.locator('#parentPage').getAttribute('readonly'), '');
  assert.equal(await page.locator('#aiKey').inputValue(), '');
  await page.locator('#cancel').click();
  assert.equal(await page.locator('#dashboard').isVisible(), true);
});

test('real Electron app starts with the bundled helper and isolated renderer', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dealfinder-desktop-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const instance = await electron.launch({ args: [desktop], env: { ...process.env, DEALFINDER_HOME: directory } });
  t.after(() => instance.close());
  const page = await instance.firstWindow();
  await page.locator('#wizard').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => typeof window.dealfinder.action), 'function');
  const unknown = await page.evaluate(() => window.dealfinder.action('run'));
  assert.equal(unknown.ok, false);
  const external = await page.evaluate(() => window.dealfinder.open('https://evil.example'));
  assert.equal(external.ok, false);
  await page.screenshot({ path: path.join(desktop, 'test-results/setup.png'), fullPage: true });
});
