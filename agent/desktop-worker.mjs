import { Store } from './lib/storage.mjs';
import { manage } from './lib/management.mjs';

// One request over stdin, structured results over stdout. No keys in command
// arguments, environment variables, logs, or IPC responses to the UI.
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);
let raw = '';
try {
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > 32_768) throw new Error('Setup request is too large.');
  }
  const { command, values } = JSON.parse(raw);
  const result = await manage(new Store(), command, values, { progress: message => emit({ type: 'progress', message }) });
  emit({ type: 'result', result });
} catch (error) {
  // Avoid echoing malformed input (JSON.parse can include the submitted text).
  let message = error instanceof SyntaxError ? 'Invalid app request.' : error.message;
  try {
    const values = JSON.parse(raw).values;
    for (const secret of [values?.aiKey, values?.notionKey]) {
      if (typeof secret === 'string' && secret.trim()) message = message.replaceAll(secret.trim(), '[redacted]');
    }
  } catch { /* Invalid request, already replaced with a generic message. */ }
  emit({ type: 'error', message });
  process.exitCode = 1;
}
