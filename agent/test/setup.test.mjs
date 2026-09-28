import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../lib/storage.mjs';
import { configure, validateSetup } from '../lib/setup-service.mjs';
import { provisionSettings, settingsLink, settingsEntryURL, ensureSourcingGuide, sourcingGuideHeading } from '../lib/notion.mjs';
import { withAgentLock, status } from '../lib/management.mjs';

const values = { provider: 'openai', model: 'test-model', aiKey: ' fake-ai-key ', notionKey: ' fake-notion-key ',
  parentPage: '0123456789abcdef0123456789abcdef', time: '09:00', timezone: 'UTC' };
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'dealfinder-setup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new Store(directory);
}

test('setup validates all inputs before any side effects and preserves the existing profile', () => {
  for (const invalid of [{ provider: 'other' }, { model: 'bad model' }, { parentPage: 'invalid' }, { time: '25:00' },
    { timezone: 'invalid' }, { aiKey: '' }, { notionKey: ' ' }]) assert.throws(() => validateSetup({ ...values, ...invalid }));
  const previous = { profile: 'saved', parentPage: values.parentPage.toUpperCase(), rulesPage: 'rules' };
  const result = validateSetup(values, previous);
  assert.equal(result.config.profile, 'saved');
  assert.equal(result.config.rulesPage, 'rules');
  assert.equal(result.secrets.aiKey, 'fake-ai-key');
  assert.throws(() => validateSetup({ ...values, parentPage: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, previous), /another Notion/);
});

test('failed verification never overwrites working credentials or configuration', async t => {
  const store = await fixture(t);
  const original = { profile: 'saved', parentPage: values.parentPage, model: 'old-model' };
  await store.write('config.json', original);
  let saved = false;
  await assert.rejects(configure(store, values, {
    createResearcher: () => ({ verify: async () => {} }),
    createNotion: () => ({ verify: async () => { throw new Error('Notion unavailable'); } }),
    saveCredentials: async () => { saved = true; },
  }), /unavailable/);
  assert.equal(saved, false);
  assert.deepEqual(await store.read('config.json'), original);
});

test('setup resumes persisted IDs after interruption and never writes keys to config', async t => {
  const store = await fixture(t);
  let fail = true;
  const options = {
    createResearcher: () => ({ verify: async () => {} }), createNotion: () => ({ verify: async () => {} }),
    saveCredentials: async (_profile, secrets) => assert.equal(secrets.notionKey, 'fake-notion-key'),
    provisionWorkspace: async (_notion, config, controls, save) => {
      assert.equal(controls.enabled, false);
      if (!fail) assert.equal(config.rulesPage, 'persisted-rules');
      config.rulesPage = 'persisted-rules'; await save(config);
      if (fail) { fail = false; throw new Error('Interrupted'); }
    },
    provisionSettingsPage: async (_notion, config, save) => { config.settingsPage = 'settings'; await save(config); },
  };
  await assert.rejects(configure(store, values, options), /Interrupted/);
  const profile = (await store.read('config.json')).profile;
  await configure(store, values, options);
  const config = await store.read('config.json');
  assert.equal(config.profile, profile);
  assert.equal(config.settingsPage, 'settings');
  assert.doesNotMatch(JSON.stringify(config), /fake-ai-key|fake-notion-key/);
});

test('settings page recovers an unacknowledged creation without duplicating or changing existing content', async () => {
  const config = { parentPage: values.parentPage, rulesPage: values.parentPage };
  let created;
  let calls = 0;
  const notion = {
    list: async route => route.includes('/settings/') ? created.children :
      created ? [{ id: 'settings', type: 'child_page', child_page: { title: 'DealFinder Settings' } }] : [],
    api: async (route, body) => {
      if (route === 'pages') { calls++; created = body; throw new Error('Lost response'); }
      return {};
    },
  };
  await assert.rejects(provisionSettings(notion, config, async () => {}), /Lost response/);
  assert.equal(created.children[1].paragraph.rich_text[0].text.link, undefined);
  assert.match(created.children[1].paragraph.rich_text[0].text.content, /Applications/);
  await provisionSettings(notion, config, async () => {});
  await provisionSettings(notion, config, async () => {});
  assert.equal(config.settingsPage, 'settings');
  assert.equal(calls, 1);
});

test('settings refuses ambiguous duplicate pages', async () => {
  const child = { type: 'child_page', child_page: { title: 'DealFinder Settings' } };
  await assert.rejects(provisionSettings({ list: async () => [child, child] }, { parentPage: 'parent' }, async () => {}), /Multiple/);
});

test('existing settings page gains start/pause instructions once without changing sourcing controls', async () => {
  const children = [{ type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'Keep my notes' } }] } }];
  const config = { settingsPage: 'settings', rulesPage: values.parentPage };
  let writes = 0;
  const notion = {
    list: async route => { assert.equal(route, 'blocks/settings/children'); return children; },
    api: async (route, body, method) => {
      assert.equal(route, 'blocks/settings/children'); assert.equal(method, 'PATCH');
      children.push(...body.children); writes++;
      throw new Error('Lost append response');
    },
  };
  await assert.rejects(ensureSourcingGuide(notion, config), /Lost append/);
  await ensureSourcingGuide(notion, config);
  assert.equal(writes, 1);
  assert.equal(children[0].paragraph.rich_text[0].text.content, 'Keep my notes');
  assert.equal(children[1].heading_2.rich_text[0].text.content, sourcingGuideHeading);
});

test('optional browser launcher permits only HTTPS links without secrets', () => {
  assert.equal(settingsEntryURL(''), settingsLink);
  assert.equal(settingsEntryURL('https://example.com/dealfinder-settings.html'), 'https://example.com/dealfinder-settings.html');
  for (const url of ['javascript:alert(1)', 'http://example.com', 'https://user:secret@example.com', 'https://example.com?key=secret'])
    assert.throws(() => settingsEntryURL(url));
});

test('desktop operations share the runner lock and release it on failure', async t => {
  const store = await fixture(t);
  await withAgentLock(store, async () => {
    await assert.rejects(withAgentLock(store, async () => assert.fail('overlap')), /already working/);
  });
  await assert.rejects(withAgentLock(store, async () => { throw new Error('failure'); }), /failure/);
  await withAgentLock(store, async () => {});
});

test('status exposes only display fields and recognizes incomplete setup', async t => {
  const store = await fixture(t);
  await store.write('config.json', { profile: 'private-profile', parentPage: values.parentPage, provider: 'openai', model: 'test', unknown: 'private' });
  const result = await status(store);
  assert.equal(result.configured, false);
  assert.equal(result.hasConfig, true);
  assert.equal(result.config.profile, undefined);
  assert.equal(result.config.unknown, undefined);
});

test('worker never echoes malformed JSON containing credentials', async t => {
  const store = await fixture(t);
  const result = await new Promise(resolve => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../desktop-worker.mjs', import.meta.url))], {
      env: { ...process.env, DEALFINDER_HOME: store.directory }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.on('close', code => resolve({ code, output }));
    child.stdin.end('{"aiKey":"TOP-SECRET",broken');
  });
  assert.equal(result.code, 1);
  assert.doesNotMatch(result.output, /TOP-SECRET/);
  assert.match(result.output, /Invalid app request/);
});
