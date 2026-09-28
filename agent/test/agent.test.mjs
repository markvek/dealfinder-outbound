import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { Store } from '../lib/storage.mjs';
import { dueDate, defaultControls, parseRules, notionId } from '../lib/rules.mjs';
import { Notion, block, rich, provision, ideaProperties, runProperties } from '../lib/notion.mjs';
import { Researcher, validateCompanies, domain } from '../lib/providers.mjs';
import { run, MAX_ATTEMPTS } from '../lib/runner.mjs';
import { request } from '../lib/http.mjs';
import { launchAgent, windowsLauncher, windowsRegistration } from '../lib/scheduler.mjs';

const rules = { ...defaultControls, enabled: true, dailyTarget: 2, timezone: 'UTC', instructions: 'Find accounting software companies.' };
const now = new Date('2026-09-27T12:00:00Z');
const candidate = name => ({ name, website: `https://${name}.com`, domain: `${name}.com`, description: 'Accounting software', fit: 'Serves accountants',
  sources: [{ url: `https://${name}.com/about`, title: 'About', evidence: 'Accounting product' }] });

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dealfinder-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  const rows = [], runs = new Map();
  let researchCalls = 0;
  const notion = {
    config: { ideasSource: 'ideas' }, rules: async () => rules, companies: async () => rows,
    latestRunKey: async () => [...runs.keys()].filter(k => !k.startsWith('Test ')).sort().at(-1),
    findRun: async key => runs.get(key),
    createRun: async key => { const value = { id: key, attempts: 0, calls: 0 }; runs.set(key, value); return value; },
    updateRun: async (id, value) => { Object.assign(runs.get(id), value); },
    addCompany: async (c, key) => { rows.push({ domain: c.domain, run: key }); },
  };
  const researcher = { research: async () => { researchCalls++; return { companies: [candidate('alpha'), candidate('beta')], note: '' }; } };
  return { store, notion, researcher, now, rows, runs, calls: () => researchCalls };
}

test('schedule handles timezones, DST jump, repeated hour, and catch-up', () => {
  const control = { ...rules, time: '02:30', timezone: 'America/New_York' };
  assert.equal(dueDate(new Date('2026-03-08T06:59:00Z'), control), '2026-03-07');
  assert.equal(dueDate(new Date('2026-03-08T07:00:00Z'), control), '2026-03-08');
  const fall = { ...control, time: '01:30' };
  assert.equal(dueDate(new Date('2026-11-01T05:45:00Z'), fall), '2026-11-01');
  assert.equal(dueDate(new Date('2026-11-01T06:45:00Z'), fall), '2026-11-01');
  assert.equal(dueDate(new Date('2026-01-01T01:00:00Z'), rules), '2025-12-31');
});

test('rules fail closed for malformed controls, placeholders and duplicate blocks', () => {
  const code = value => ({ type: 'code', code: { language: 'json', rich_text: rich(JSON.stringify(value)) } });
  assert.throws(() => parseRules([code({ ...rules, time: '25:00' })]), /HH:MM/);
  assert.throws(() => parseRules([code({ ...rules, timezone: 'NotATimeZone' })]), /timezone/);
  assert.throws(() => parseRules([code(rules), block('[REPLACE WITH YOUR SOURCING RULES]')]), /Fill in/);
  assert.throws(() => parseRules([code(rules), code(rules)]), /exactly one/);
  assert.equal(parseRules([code(rules), block('Only B2B accounting companies')]).instructions, 'Only B2B accounting companies');
  assert.equal(notionId('https://www.notion.so/Rules-0123456789abcdef0123456789abcdef?view=x'), '0123456789abcdef0123456789abcdef');
});

test('runner publishes once and survives a second invocation without another charge', async t => {
  const f = await fixture(t);
  assert.deepEqual(await run(f), { status: 'Complete', count: 2 });
  assert.equal((await run(f)).skipped, true);
  assert.equal(f.rows.length, 2);
  assert.equal(f.calls(), 1);
});

test('ambiguous insert reconciles against Notion and resumes saved candidates', async t => {
  const f = await fixture(t);
  const original = f.notion.addCompany;
  let fail = true;
  f.notion.addCompany = async (...args) => { await original(...args); if (fail) { fail = false; throw new Error('Lost response after insert'); } };
  await assert.rejects(run(f), /Lost response/);
  assert.equal(f.rows.length, 1);
  assert.deepEqual(await run(f), { status: 'Complete', count: 2 });
  assert.deepEqual(f.rows.map(r => r.domain), ['alpha.com', 'beta.com']);
  assert.equal(f.calls(), 1);
});

test('pause prevents generation and writes', async t => {
  const f = await fixture(t);
  f.notion.rules = async () => ({ ...rules, enabled: false });
  assert.equal((await run(f)).status, 'Paused');
  assert.equal(f.runs.size, 0);
  assert.equal(f.calls(), 0);
});

test('explicit live test can run while paused without changing daily state or quota', async t => {
  const f = await fixture(t);
  f.notion.rules = async () => ({ ...rules, enabled: false, dailyTarget: 50 });
  f.researcher.research = async () => ({ companies: [candidate('alpha'), candidate('beta'), candidate('gamma')], note: '' });
  assert.deepEqual(await run({ ...f, testRun: true }), { status: 'Complete', count: 3 });
  assert.equal(await f.store.read('progress.json'), null);
  assert.equal((await f.notion.rules()).enabled, false);
  assert.equal(await f.notion.latestRunKey(), undefined);
  assert.equal((await f.store.read('test-progress.json')).rules.dailyTarget, 3);
  assert.equal(f.runs.size, 1);
});

test('manual run before schedule does not produce a second catch-up batch', async t => {
  const f = await fixture(t);
  f.now = new Date('2026-09-27T07:00:00Z');
  await run({ ...f, manual: true });
  assert.equal((await run(f)).status, 'Not due');
  assert.equal(f.calls(), 1);
});

test('failed requests are bounded across restarts', async t => {
  const f = await fixture(t);
  let calls = 0;
  f.researcher.research = async () => { calls++; throw new Error('AI unavailable'); };
  for (let n = 0; n < MAX_ATTEMPTS; n++) await assert.rejects(run(f), /unavailable/);
  assert.equal((await run(f)).status, 'Stopped');
  assert.equal(calls, MAX_ATTEMPTS);
  assert.equal(f.runs.get('2026-09-27').status, 'Stopped');
});

test('new machine uses existing Notion domains and daily quota', async t => {
  const f = await fixture(t);
  f.rows.push({ domain: 'alpha.com', run: '2026-09-26' });
  f.researcher.research = async () => ({ companies: [candidate('alpha'), candidate('beta')], note: '' });
  const result = await run(f);
  assert.equal(result.status, 'Shortfall');
  assert.equal(result.count, 1);
  assert.equal(f.rows.length, 2);
});

test('shortfall is recorded without inventing companies', async t => {
  const f = await fixture(t);
  f.researcher.research = async () => ({ companies: [], note: 'No evidence-backed matches.' });
  const result = await run(f);
  assert.equal(result.status, 'Shortfall');
  assert.match(f.runs.get('2026-09-27').note, /No evidence/);
});

test('lost connection after publishing all rows finishes by reconciling without AI', async t => {
  const f = await fixture(t);
  f.rows.push({ domain: 'alpha.com', run: '2026-09-27' }, { domain: 'beta.com', run: '2026-09-27' });
  f.runs.set('2026-09-27', { id: '2026-09-27', status: 'Error', attempts: 1, calls: 1 });
  assert.equal((await run(f)).status, 'Complete');
  assert.equal(f.calls(), 0);
});

test('candidate validation rejects invented citations, malformed URLs and duplicate websites', () => {
  const a = candidate('alpha'), b = candidate('beta');
  const output = JSON.stringify({ companies: [a, { ...a, website: 'https://www.alpha.com/' }, b] });
  assert.equal(validateCompanies(output, [a.sources[0].url], 5).companies.length, 1);
  assert.equal(validateCompanies(output, [a.sources[0].url], 5, new Set(['alpha.com'])).companies.length, 0);
  assert.throws(() => domain('javascript:alert(1)'));
  assert.throws(() => validateCompanies('nonsense', [], 5), /invalid JSON/);
});

test('OpenAI adapter sends web search and consumes actual response source URLs', async () => {
  const a = candidate('alpha');
  const transport = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.body.tools[0].type, 'web_search');
    assert.equal(options.body.tool_choice, 'required');
    return { status: 'completed', output: [
      { type: 'web_search_call', action: { sources: [{ url: a.sources[0].url }] } },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ companies: [a] }) }] },
    ] };
  };
  const ai = new Researcher({ provider: 'openai', model: 'test-model' }, 'not-a-real-key', transport);
  assert.equal((await ai.research(rules, new Set(), 5)).companies.length, 1);
});

test('Claude adapter parses search results; incomplete turns do not publish', async () => {
  const a = candidate('alpha');
  const response = { stop_reason: 'end_turn', content: [
    { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: a.sources[0].url }] },
    { type: 'text', text: JSON.stringify({ companies: [a] }) },
  ] };
  const ai = new Researcher({ provider: 'anthropic', model: 'test-model' }, 'not-a-real-key', async (url, options) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(options.headers['anthropic-version'], '2023-06-01');
    return response;
  });
  assert.equal((await ai.research(rules, new Set(), 5)).companies.length, 1);
  response.stop_reason = 'max_tokens';
  await assert.rejects(ai.research(rules, new Set(), 5), /before completion/);
});

test('HTTP retries rate limits, never retries ambiguous creations or prints API bodies', async () => {
  let calls = 0;
  const fail = async () => { calls++; return new Response('{"secret":"do-not-log"}', { status: 500 }); };
  await assert.rejects(request('https://test.invalid', { service: 'Test', method: 'POST', fetchImpl: fail }), /HTTP 500/);
  assert.equal(calls, 1);
  calls = 0;
  const data = await request('https://test.invalid', { service: 'Test', wait: async () => {}, fetchImpl: async () => {
    calls++;
    return calls === 1 ? new Response('{}', { status: 429, headers: { 'retry-after': '1' } }) : Response.json({ ok: true });
  } });
  assert.equal(data.ok, true);
  assert.equal(calls, 2);
});

test('Notion reads paginated and nested rules completely', async () => {
  const seen = [];
  const notion = new Notion('fake', {}, async url => {
    seen.push(url);
    if (url.includes('/nested/')) return { results: [block('Nested requirement')], has_more: false };
    if (url.includes('start_cursor')) return { results: [block('Last requirement')], has_more: false };
    return { results: [{ ...block('First requirement'), id: 'nested', has_children: true }], has_more: true, next_cursor: 'next' };
  });
  assert.equal((await notion.blocks('rules')).length, 3);
  assert.equal(seen.length, 3);
});

test('setup reuses existing pages and databases without duplicate creation', async () => {
  const config = { parentPage: 'parent' };
  const children = [
    { id: 'rules', type: 'child_page', child_page: { title: 'Sourcing Rules' } },
    { id: 'ideas', type: 'child_database', child_database: { title: 'Company Ideas' } },
    { id: 'runs', type: 'child_database', child_database: { title: 'Run History' } },
  ];
  const notion = new Notion('fake', config, async (url, options) => {
    assert.equal(options.method, 'GET');
    if (url.includes('/children')) return { results: children, has_more: false };
    if (url.includes('/databases/')) return { data_sources: [{ id: url.endsWith('/ideas') ? 'ideasSource' : 'runsSource' }] };
    if (url.includes('/views?')) return { results: [{ object: 'view', id: 'gallery-view' }], has_more: false };
    if (url.endsWith('/views/gallery-view')) return { type: 'gallery' };
    if (url.includes('/data_sources/')) {
      const schema = url.endsWith('ideasSource') ? ideaProperties : runProperties;
      return { properties: Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, { type: Object.keys(v)[0] }])) };
    }
    return {};
  });
  await provision(notion, config, defaultControls, async () => {});
  assert.equal(config.rulesPage, 'rules');
  assert.equal(config.ideasSource, 'ideasSource');
  assert.equal(config.galleryCreated, true);
});

test('fresh setup creates paused rules, two schemas, and the gallery as the first view', async () => {
  const config = { parentPage: 'parent' };
  const created = [];
  const notion = new Notion('fake', config, async (url, options) => {
    if (options.method === 'POST') {
      created.push(options.body);
      if (url.endsWith('/pages')) return { id: 'rules' };
      if (url.endsWith('/databases')) return { id: options.body.title[0].text.content === 'Company Ideas' ? 'ideas' : 'runs' };
      if (url.endsWith('/views')) return { id: 'gallery', type: 'gallery' };
      assert.fail(`Unexpected creation ${url}`);
    }
    if (url.includes('/children') || url.includes('/views?')) return { results: [], has_more: false };
    if (url.includes('/databases/')) return { data_sources: [{ id: url.endsWith('ideas') ? 'ideasSource' : 'runsSource' }] };
    if (url.includes('/data_sources/')) {
      const schema = url.endsWith('ideasSource') ? ideaProperties : runProperties;
      return { properties: Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, { type: Object.keys(v)[0] }])) };
    }
    return {};
  });
  await provision(notion, config, defaultControls, async () => {});
  assert.equal(created.length, 4);
  const controls = created[0].children.find(b => b.type === 'code');
  assert.equal(JSON.parse(controls.code.rich_text[0].text.content).enabled, false);
  assert.equal(created[1].initial_data_source.properties.Website.url !== undefined, true);
  assert.equal(created[3].position.type, 'start');
});

test('native scheduler builders escape paths, run on sign-in and prevent overlap', () => {
  const mac = launchAgent('/opt/My Node/node', '/Users/A&B/agent.mjs', '/Users/A&B/data');
  assert.match(mac, /A&amp;B/);
  assert.match(mac, /StartInterval.*900/);
  assert.match(mac, /RunAtLoad/);
  const win = windowsLauncher('C:\\Program Files\\nodejs\\node.exe', "C:\\O'Brien\\agent.mjs", 'C:\\data');
  assert.match(win, /O''Brien/);
  assert.match(win, /exit \$LASTEXITCODE/);
  const registration = windowsRegistration('C:\\My Data\\scheduled-run.ps1');
  assert.match(registration, /LogonType Interactive/);
  assert.match(registration, /MultipleInstances IgnoreNew/);
  assert.match(registration, /AtLogOn/);
});

test('filesystem lock rejects simultaneous runners; state writes are complete JSON', async t => {
  const f = await fixture(t);
  const release = await lockfile.lock(f.store.directory, { realpath: false });
  try { await assert.rejects(lockfile.lock(f.store.directory, { realpath: false, retries: 0 }), { code: 'ELOCKED' }); }
  finally { await release(); }
  await f.store.write('progress.json', { calls: 1 });
  await f.store.write('progress.json', { calls: 2 });
  assert.equal(JSON.parse(await readFile(f.store.file('progress.json'), 'utf8')).calls, 2);
});

test('Claude paused turns preserve search evidence and reserve each additional charge', async () => {
  const a = candidate('alpha');
  let calls = 0, reserved = 0;
  const ai = new Researcher({ provider: 'anthropic', model: 'test' }, 'fake', async (_url, options) => {
    calls++;
    if (calls === 1) return { stop_reason: 'pause_turn', content: [
      { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: a.sources[0].url }] },
    ] };
    assert.equal(options.body.messages[1].role, 'assistant');
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ companies: [a] }) }] };
  });
  const result = await ai.research(rules, new Set(), 5, async () => { reserved++; });
  assert.equal(result.companies.length, 1);
  assert.equal(reserved, 1);
});

test('Notion incomplete query fails closed instead of losing duplicate history', async () => {
  const notion = new Notion('fake', { ideasSource: 'ideas' }, async () => ({ results: [], has_more: false, request_status: { type: 'incomplete' } }));
  await assert.rejects(notion.companies(), /incomplete/);
});

test('abandoned run is marked stopped when the next due day replaces it', async t => {
  const f = await fixture(t);
  f.researcher.research = async () => { throw new Error('offline'); };
  await assert.rejects(run(f));
  f.researcher.research = async () => ({ companies: [], note: 'No matches' });
  await run({ ...f, now: new Date('2026-09-28T12:00:00Z') });
  assert.equal(f.runs.get('2026-09-27').status, 'Stopped');
  assert.match(f.runs.get('2026-09-27').note, /superseded/);
});

test('OS credential module loads without accessing any credentials', async () => {
  const { Entry } = await import('@napi-rs/keyring');
  assert.equal(typeof Entry, 'function');
});

test('native OS parser accepts scheduler definitions with spaces and Unicode paths', async t => {
  const f = await fixture(t);
  const exec = promisify(execFile);
  if (process.platform === 'darwin') {
    const file = f.store.file('scheduler.plist');
    await writeFile(file, launchAgent('/Node With Spaces/node', '/Users/José & Co/cli.mjs', '/Users/José & Co/data'));
    await exec('plutil', ['-lint', file]);
  } else if (process.platform === 'win32') {
    const launcher = f.store.file('scheduled-run.ps1');
    const installer = f.store.file('register.ps1');
    await writeFile(launcher, '\ufeff' + windowsLauncher('C:\\Program Files\\nodejs\\node.exe', "C:\\José O'Brien\\cli.mjs", 'C:\\Data & Files'));
    await writeFile(installer, '\ufeff' + windowsRegistration(launcher));
    // Parse only: unit tests must never register tasks on a developer's machine.
    for (const file of [launcher, installer]) {
      const script = `$tokens=$null; $issues=$null; [System.Management.Automation.Language.Parser]::ParseFile('${file.replaceAll("'", "''")}', [ref]$tokens, [ref]$issues) | Out-Null; if ($issues.Count) { throw ($issues | Out-String) }`;
      await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    }
  } else t.skip('Native parser requires macOS or Windows');
});
