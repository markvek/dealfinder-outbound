export const defaultControls = { enabled: false, dailyTarget: 50, time: '09:00', timezone: 'America/Los_Angeles' };

export function validateControls(value) {
  if (!value || typeof value.enabled !== 'boolean') throw new Error('Notion controls need enabled: true or false.');
  if (!Number.isInteger(value.dailyTarget) || value.dailyTarget < 1 || value.dailyTarget > 100)
    throw new Error('dailyTarget must be an integer between 1 and 100.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) throw new Error('time must use HH:MM, for example 09:00.');
  try { new Intl.DateTimeFormat('en', { timeZone: value.timezone }).format(); }
  catch { throw new Error('timezone must be an IANA timezone, for example America/New_York.'); }
  if (typeof value.timezone !== 'string' || !value.timezone) throw new Error('timezone is required.');
  return value;
}

export function parseRules(blocks) {
  const controls = blocks.filter(b => b.type === 'code' && b.code.language === 'json');
  if (controls.length !== 1) throw new Error('Sourcing Rules must contain exactly one JSON code block for controls.');
  const text = b => (b[b.type]?.rich_text || []).map(t => t.plain_text ?? t.text?.content ?? '').join('');
  let settings;
  try { settings = JSON.parse(text(controls[0])); } catch { throw new Error('The Notion controls contain invalid JSON.'); }
  validateControls(settings);
  const instructions = blocks.filter(b => b !== controls[0]).map(text).filter(Boolean).join('\n');
  if (instructions.length > 20_000) throw new Error('Keep the sourcing instructions under 20,000 characters.');
  if (!instructions.trim() || instructions.includes('[REPLACE WITH YOUR SOURCING RULES]')) {
    if (settings.enabled) throw new Error('Fill in Sourcing Rules before enabling the agent.');
  }
  return { ...settings, instructions };
}

// The most recent due calendar date: missed days collapse into one catch-up run.
// Comparison by local wall time naturally handles DST gaps and repeated hours.
export function dueDate(now, controls) {
  validateControls(controls);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: controls.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(p => [p.type, p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  if (`${parts.hour}:${parts.minute}` >= controls.time) return today;
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return yesterday.toISOString().slice(0, 10);
}

export function notionId(value) {
  const match = value.trim().split('?')[0].match(/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (!match) throw new Error('Enter a Notion page URL or page ID.');
  return match[1];
}
