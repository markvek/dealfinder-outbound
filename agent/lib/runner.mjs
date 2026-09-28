import { createHash } from 'node:crypto';
import { dueDate } from './rules.mjs';

export const MAX_ATTEMPTS = 3;
export const MAX_CALLS = 25;
const terminal = new Set(['Complete', 'Shortfall', 'Stopped']);
const fingerprint = rules => createHash('sha256').update(JSON.stringify(rules)).digest('hex');

// Dependencies are injected to exercise interruption and ambiguous-write recovery
// against deterministic Notion/provider fakes without spending API credits.
export async function run({ notion, researcher, store, now = new Date(), manual = false, testRun = false }) {
  const configuredRules = await notion.rules();
  if (!configuredRules.enabled && !testRun) return { status: 'Paused' };
  if (testRun && (!configuredRules.instructions.trim() || configuredRules.instructions.includes('[REPLACE WITH YOUR SOURCING RULES]')))
    throw new Error('Fill in Sourcing Rules before running a test.');
  const rules = testRun ? { ...configuredRules, dailyTarget: Math.min(3, configuredRules.dailyTarget) } : configuredRules;
  const stateFile = testRun ? 'test-progress.json' : 'progress.json';
  const key = dueDate(now, rules);
  // Manual runs bypass the time of day, but still share the day's quota.
  const runKey = testRun ? `Test ${now.toISOString()}` : manual ? new Intl.DateTimeFormat('en-CA', { timeZone: rules.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(now) : key;
  // A manual run before today's scheduled time, clock rollback, or timezone
  // change must not cause the scheduler to start an older date afterward.
  const latest = testRun ? null : await notion.latestRunKey();
  if (latest && latest > runKey) return { status: 'Not due', skipped: true };
  let remote = await notion.findRun(runKey);
  if (remote && terminal.has(remote.status)) return { status: remote.status, count: remote.count, skipped: true };
  if (remote?.attempts >= MAX_ATTEMPTS) return { status: 'Stopped', note: 'Daily retry limit reached. See Run History.' };

  let state = await store.read(stateFile);
  if (state?.key !== runKey || state?.source !== notion.config.ideasSource) {
    if (state?.runId && state.source === notion.config.ideasSource && !terminal.has(state.status)) {
      await notion.updateRun(state.runId, { status: 'Stopped', count: state.count || 0,
        calls: state.calls, attempts: state.attempts, note: 'Interrupted run superseded by the next due date.' });
    }
    state = null;
  }
  if (state?.attempts >= MAX_ATTEMPTS) return { status: 'Stopped', note: 'Daily retry limit reached. See local logs.' };
  if (!remote) {
    const page = await notion.createRun(runKey, rules);
    remote = { id: page.id, calls: 0, attempts: 0 };
  }
  state ||= { key: runKey, source: notion.config.ideasSource, rules, fingerprint: fingerprint(rules), pending: [], calls: remote.calls || 0 };
  state.calls = Math.max(state.calls, remote.calls || 0);
  state.attempts = Math.max(state.attempts || 0, remote.attempts || 0) + 1;
  state.runId = remote.id;
  // Resume with the rules captured when the run started. If moving machines
  // mid-run, current rules apply; already-published companies remain deduplicated.
  const snapshot = state.rules;
  const callLimit = Math.min(MAX_CALLS, Math.ceil(snapshot.dailyTarget / 5) + 5);
  let count = remote.count || 0;
  const sync = async (status, note = '') => {
    state.status = status;
    state.count = count;
    await store.write(stateFile, state);
    await notion.updateRun(state.runId, { status, count, calls: state.calls, attempts: state.attempts, note });
  };
  try {
    const existing = await notion.companies();
    const excluded = new Set(existing.map(c => c.domain).filter(Boolean));
    count = existing.filter(c => c.run === runKey).length;
    await sync('Running', 'Research in progress.');
    while (count < snapshot.dailyTarget) {
      if (!state.pending.length) {
        if (state.calls >= callLimit) break;
        // Persist the charge budget before issuing a potentially billable request.
        state.calls++;
        await sync('Running', `Model request ${state.calls} of at most ${callLimit}.`);
        const batch = await researcher.research(snapshot, excluded, Math.min(5, snapshot.dailyTarget - count), async () => {
          if (state.calls >= callLimit) throw new Error('Daily model request limit reached during research.');
          state.calls++;
          await sync('Running', `Continuing research; model request ${state.calls} of at most ${callLimit}.`);
        });
        state.pending = batch.companies;
        state.note = batch.note;
        await store.write(stateFile, state);
        if (!state.pending.length) break;
      }
      while (state.pending.length && count < snapshot.dailyTarget) {
        const company = state.pending[0];
        if (!excluded.has(company.domain)) {
          await notion.addCompany(company, runKey);
          excluded.add(company.domain);
          count++;
        }
        // If an insert succeeded but its response was lost, next run reconciles
        // against Notion before attempting this saved candidate again.
        state.pending.shift();
        await store.write(stateFile, state);
      }
      await sync('Running', `${count} companies published.`);
    }
    const status = count >= snapshot.dailyTarget ? 'Complete' : 'Shortfall';
    state.pending = [];
    await sync(status, status === 'Shortfall' ? `${count}/${snapshot.dailyTarget} qualified companies. ${state.note || 'Research limit reached.'}` : 'Daily target reached.');
    await store.log('run-finished', { key: runKey, status, count });
    return { status, count };
  } catch (error) {
    const status = state.attempts >= MAX_ATTEMPTS ? 'Stopped' : 'Error';
    // API errors are sanitized by the transport; never persist full provider responses.
    try { await sync(status, error.message); } catch { /* Local progress is authoritative until Notion is reachable. */ }
    await store.log('run-failed', { key: runKey, status, message: error.message });
    throw error;
  }
}
