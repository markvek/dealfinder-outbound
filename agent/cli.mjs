#!/usr/bin/env node
import { Store, credentials } from './lib/storage.mjs';
import { Notion } from './lib/notion.mjs';
import { Researcher } from './lib/providers.mjs';
import { run } from './lib/runner.mjs';
import { schedule, unschedule, schedulerStatus } from './lib/scheduler.mjs';
import lockfile from 'proper-lockfile';

const store = new Store();
const command = process.argv[2] || 'help';
async function main() {
  if (command === 'help') {
    console.log('DealFinder: setup | doctor | run | test-run | tick | status | schedule | unschedule\nUse: node agent/cli.mjs <command>\nrun: source now, respecting pause and daily quota. test-run: publish up to 3 sample companies even while paused. tick: check the Notion schedule.');
    return;
  }
  await store.init();
  if (command === 'status') {
    const config = await store.read('config.json');
    const progress = await store.read('progress.json');
    console.log(JSON.stringify({ configured: !!config, scheduler: await schedulerStatus(), directory: store.directory,
      lastRun: progress ? { date: progress.key, status: progress.status, calls: progress.calls, attempts: progress.attempts } : null }, null, 2));
    return;
  }
  if (command === 'unschedule') { await unschedule(); console.log('Background scheduling removed. Notion data and credentials are retained.'); return; }
  let release;
  try {
    release = await lockfile.lock(store.directory, { realpath: false, stale: 120_000, update: 10_000, retries: 0 });
  } catch (error) {
    if (error.code === 'ELOCKED') { if (command !== 'tick') console.log('Another DealFinder operation is running. Try again when it finishes.'); return; }
    throw error;
  }
  try {
    if (command === 'setup') { const { setup } = await import('./lib/setup.mjs'); await setup(store); return; }
    const config = await store.read('config.json');
    if (!config) throw new Error('Run the installer first.');
    if (!['openai', 'anthropic'].includes(config.provider) || !config.model || !config.rulesPage || !config.ideasSource || !config.runsSource)
      throw new Error('Setup is incomplete. Run setup again.');
    const secrets = await credentials(config.profile);
    const notion = new Notion(secrets.notionKey, config);
    const researcher = new Researcher(config, secrets.aiKey);
    if (command === 'doctor' || command === 'schedule') {
      await notion.verify();
      const rules = await notion.rules();
      await researcher.verify();
      console.log(`Connections OK. Target: ${rules.dailyTarget}; time: ${rules.time} ${rules.timezone}; ${rules.enabled ? 'enabled' : 'paused'}.\nWeb search generation is checked on the first research run and may incur provider charges.`);
      if (command === 'schedule') { await schedule(store); console.log('Background checks installed for every 15 minutes and sign-in.'); }
    } else if (command === 'run' || command === 'tick' || command === 'test-run') {
      const result = await run({ notion, researcher, store, manual: command === 'run', testRun: command === 'test-run' });
      if (command !== 'tick') console.log(JSON.stringify(result));
    } else throw new Error('Unknown command. Run node agent/cli.mjs help.');
  } finally { await release(); }
}
main().catch(async error => {
  const message = error.name === 'ExitPromptError' ? 'Setup cancelled.' : error.message;
  console.error(message);
  try { await store.log('command-failed', { command, message }); } catch { /* Keep the original failure. */ }
  process.exitCode = 1;
});
