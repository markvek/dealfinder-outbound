import { randomUUID } from 'node:crypto';
import { input, password, select } from '@inquirer/prompts';
import { credentials } from './storage.mjs';
import { Notion, provision } from './notion.mjs';
import { Researcher } from './providers.mjs';
import { defaultControls, notionId, validateControls } from './rules.mjs';

export async function setup(store) {
  const previous = await store.read('config.json');
  console.log('DealFinder local setup. Credentials go in your OS credential store.\nUse a Notion connection with read, insert and update content access.\nShare your parent page with that connection before continuing.');
  const provider = await select({ message: 'AI provider', default: previous?.provider, choices: [
    { name: 'OpenAI API', value: 'openai' }, { name: 'Claude API', value: 'anthropic' },
  ] });
  const model = await input({ message: 'Model ID (must support web search)', default: previous?.provider === provider ? previous.model : undefined,
    validate: value => /^[a-zA-Z0-9._:-]+$/.test(value) || 'Enter a model ID from your provider’s API console.' });
  const aiKey = await password({ message: 'AI API key', mask: '*', validate: v => !!v.trim() || 'API key is required.' });
  const notionKey = await password({ message: 'Notion connection token', mask: '*', validate: v => !!v.trim() || 'Token is required.' });
  const parentPage = notionId(await input({ message: 'Notion parent page URL or ID', default: previous?.parentPage,
    validate: value => { try { notionId(value); return true; } catch (error) { return error.message; } } }));
  if (previous && previous.parentPage.replaceAll('-', '') !== parentPage.replaceAll('-', ''))
    throw new Error('This computer is already configured for another parent page. Use a separate DEALFINDER_HOME directory for a different workspace.');
  const time = await input({ message: 'Daily time (24-hour HH:MM)', default: '09:00', validate: v => /^([01]\d|2[0-3]):[0-5]\d$/.test(v) || 'Use HH:MM.' });
  const timezone = await input({ message: 'Timezone', default: Intl.DateTimeFormat().resolvedOptions().timeZone,
    validate: v => { try { validateControls({ ...defaultControls, timezone: v }); return true; } catch (e) { return e.message; } } });
  const config = { ...previous, version: 1, profile: previous?.profile || randomUUID(), provider, model, parentPage };
  const secrets = { aiKey: aiKey.trim(), notionKey: notionKey.trim() };
  const notion = new Notion(secrets.notionKey, config);
  console.log('Checking model and Notion access (no paid generation yet)…');
  await new Researcher(config, secrets.aiKey).verify();
  await notion.verify();
  await credentials(config.profile, secrets);
  await store.write('config.json', config);
  await provision(notion, config, { ...defaultControls, time, timezone }, c => store.write('config.json', c));
  console.log(`Setup complete. Open https://www.notion.so/${config.parentPage.replaceAll('-', '')}\nFill in Sourcing Rules, then set enabled to true. Existing Notion rules and schedules are preserved on repeat setup.\nRun "npm --prefix agent run doctor" to check the completed setup.\nRun "npm --prefix agent run schedule" to enable background checks.`);
}
