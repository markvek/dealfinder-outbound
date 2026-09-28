import { randomUUID } from 'node:crypto';
import { credentials } from './storage.mjs';
import { Notion, provision, provisionSettings } from './notion.mjs';
import { Researcher } from './providers.mjs';
import { defaultControls, notionId, validateControls } from './rules.mjs';

// Shared by the desktop wizard and CLI. The caller holds the agent's process lock.
export function validateSetup(values, previous) {
  if (!values || !['openai', 'anthropic'].includes(values.provider)) throw new Error('Choose an AI provider.');
  const model = String(values.model || '').trim();
  if (!/^[a-zA-Z0-9._:-]{1,200}$/.test(model)) throw new Error('Enter a valid model ID from your provider.');
  const parentPage = notionId(String(values.parentPage || ''));
  if (previous && previous.parentPage.replaceAll('-', '').toLowerCase() !== parentPage.replaceAll('-', '').toLowerCase())
    throw new Error('This computer is already connected to another Notion parent page. Keep that page to preserve your existing workspace.');
  const controls = validateControls({ ...defaultControls, time: values.time, timezone: values.timezone });
  for (const name of ['aiKey', 'notionKey']) {
    if (typeof values[name] !== 'string' || !values[name].trim() || values[name].length > 4096)
      throw new Error(name === 'aiKey' ? 'Enter your AI API key.' : 'Enter your Notion connection token.');
  }
  return { config: { ...previous, version: 1, profile: previous?.profile || randomUUID(), provider: values.provider, model, parentPage },
    secrets: { aiKey: values.aiKey.trim(), notionKey: values.notionKey.trim() }, controls };
}

export async function configure(store, values, { progress = () => {}, saveCredentials = credentials,
  createNotion = (key, config) => new Notion(key, config), createResearcher = (config, key) => new Researcher(config, key),
  provisionWorkspace = provision, provisionSettingsPage = provisionSettings } = {}) {
  const previous = await store.read('config.json');
  const { config, secrets, controls } = validateSetup(values, previous);
  const notion = createNotion(secrets.notionKey, config);
  progress('Checking AI model access…');
  await createResearcher(config, secrets.aiKey).verify();
  progress('Checking Notion access…');
  await notion.verify();
  // Validate both connections before replacing working credentials. Persist each
  // provisioned ID so an interrupted setup can resume without duplicate pages.
  await saveCredentials(config.profile, secrets);
  await store.write('config.json', config);
  progress('Preparing your Notion workspace…');
  const save = c => store.write('config.json', c);
  await provisionWorkspace(notion, config, controls, save);
  progress('Adding the settings link in Notion…');
  await provisionSettingsPage(notion, config, save);
  return config;
}
