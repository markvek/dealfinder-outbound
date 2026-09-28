import lockfile from 'proper-lockfile';
import { credentials } from './storage.mjs';
import { Notion, provisionSettings } from './notion.mjs';
import { Researcher } from './providers.mjs';
import { configure } from './setup-service.mjs';
import { schedule, unschedule, schedulerStatus } from './scheduler.mjs';

export const configured = config => !!(config?.profile && config?.rulesPage && config?.ideasSource && config?.runsSource);

export async function status(store) {
  const config = await store.read('config.json');
  const last = await store.read('progress.json');
  return { configured: configured(config), hasConfig: !!config,
    config: config ? { provider: config.provider, model: config.model, parentPage: config.parentPage } : null,
    scheduler: await schedulerStatus(),
    lastRun: last ? { date: last.key, status: last.status, count: last.count ?? null } : null };
}

export async function withAgentLock(store, operation) {
  await store.init();
  let release;
  try { release = await lockfile.lock(store.directory, { realpath: false, stale: 120_000, update: 10_000, retries: 0 }); }
  catch (error) {
    if (error.code === 'ELOCKED') throw new Error('DealFinder is already working. Try again after the current operation finishes.');
    throw error;
  }
  try { return await operation(); } finally { await release(); }
}

export async function manage(store, command, values, { progress = () => {}, runtime } = {}) {
  if (command === 'status') return status(store);
  if (!['setup', 'check', 'schedule', 'unschedule', 'settings'].includes(command)) throw new Error('Unknown app action.');
  return withAgentLock(store, async () => {
    if (command === 'unschedule') { await unschedule(); return { message: 'Background checks stopped. Your Notion data and credentials are preserved.' }; }
    if (command === 'setup') {
      await configure(store, values, { progress });
      progress('Installing background checks…');
      try { await schedule(store, runtime); }
      catch { throw new Error('Your connections and Notion pages are saved, but background scheduling failed. Open the status screen and choose Repair background checks.'); }
      return { message: 'Connected. Open Notion to review your sourcing rules. New workspaces start paused; existing rules and schedules are preserved.' };
    }
    const config = await store.read('config.json');
    if (!configured(config)) throw new Error('Finish setup first.');
    const secrets = await credentials(config.profile);
    const notion = new Notion(secrets.notionKey, config);
    progress(command === 'settings' ? 'Updating the Notion instructions…' : 'Checking connections and sourcing rules…');
    await notion.verify();
    if (command === 'settings') {
      await provisionSettings(notion, config, c => store.write('config.json', c));
      return { message: 'Notion instructions are up to date. Open DealFinder Settings in Notion for setup, start/pause, and troubleshooting help.' };
    }
    await new Researcher(config, secrets.aiKey).verify();
    const rules = await notion.rules();
    if (command === 'schedule') await schedule(store, runtime);
    return { message: `${command === 'schedule' ? 'Background checks installed. ' : ''}Connections are healthy. Sourcing is ${rules.enabled ? 'enabled' : 'paused'} in Notion.`,
      rules: { enabled: rules.enabled, time: rules.time, timezone: rules.timezone, dailyTarget: rules.dailyTarget } };
  });
}
