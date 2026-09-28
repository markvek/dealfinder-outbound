const $ = id => document.getElementById(id);
let step = 0;
let current;
let busy = false;
const fields = [...document.querySelectorAll('[data-step]')];
const form = $('setup-form');

function notify(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
  $('notice').hidden = !message;
}
function lock(value) {
  busy = value;
  document.querySelectorAll('button, input, select').forEach(el => { el.disabled = value; });
  form.setAttribute('aria-busy', String(value));
}
function showStep(value) {
  step = value;
  fields.forEach((el, index) => { el.hidden = index !== value; });
  document.querySelectorAll('.steps li').forEach((el, index) => {
    el.classList.toggle('active', index === value);
    if (index === value) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
  });
  $('back').hidden = value === 0;
  $('next').textContent = value === 2 ? 'Connect workspace' : 'Continue →';
}
function showWizard() {
  $('loading').hidden = true;
  $('dashboard').hidden = true;
  $('wizard').hidden = false;
  $('cancel').hidden = !current?.configured;
  $('wizard-title').textContent = current?.hasConfig ? 'Update your connections.' : 'Connect your workspace.';
  $('provider').value = current?.config?.provider || 'openai';
  $('model').value = current?.config?.model || '';
  $('parentPage').value = current?.config?.parentPage || '';
  $('parentPage').readOnly = !!current?.hasConfig;
  $('aiKey').value = '';
  $('notionKey').value = '';
  showStep(0);
}
function showDashboard() {
  $('loading').hidden = true;
  $('wizard').hidden = true;
  $('dashboard').hidden = false;
  $('aiKey').value = '';
  $('notionKey').value = '';
  $('provider-status').textContent = `${current.config.provider === 'openai' ? 'OpenAI' : 'Claude'} · ${current.config.model}`;
  $('schedule-status').textContent = current.scheduler.installed ? 'Installed · every 15 minutes' : 'Not installed';
  $('stop').hidden = !current.scheduler.installed;
  $('run-status').textContent = current.lastRun ? `${current.lastRun.date} · ${current.lastRun.status}` : 'No runs on this computer yet';
}
async function refresh() {
  const result = await window.dealfinder.action('status');
  if (!result.ok) throw new Error(result.error);
  current = result.value;
  $('notion-link').hidden = !current?.config?.parentPage;
  if (current.configured) showDashboard(); else showWizard();
}
async function operation(command, values) {
  if (busy) return;
  lock(true);
  notify(command === 'setup' ? 'Connecting your workspace…' : 'Working…');
  try {
    const result = await window.dealfinder.action(command, values);
    if (!result.ok) throw new Error(result.error);
    if (result.value.rules) {
      const rules = result.value.rules;
      $('health-status').textContent = `Healthy · ${rules.enabled ? 'enabled' : 'paused'} · ${rules.time} ${rules.timezone}`;
    } else if (command === 'setup') $('health-status').textContent = 'Connections verified during setup';
    await refresh();
    notify(result.value.message);
  } catch (error) {
    if (['check', 'schedule', 'settings'].includes(command)) $('health-status').textContent = 'Needs attention — see message above';
    // Setup may have saved the workspace before scheduling failed. Show status
    // so Repair is available; partially provisioned workspaces stay in the wizard.
    if (command === 'setup') { try { await refresh(); } catch { /* Keep the actionable setup error. */ } }
    notify(error.message, true);
  } finally { lock(false); }
}
async function open(destination) {
  const result = await window.dealfinder.open(destination);
  if (!result.ok) notify(result.error, true);
}
// Validate only the visible fieldset; hidden required fields belong to later steps.
form.noValidate = true;
form.addEventListener('submit', event => {
  event.preventDefault();
  if (busy) return;
  for (const input of fields[step].querySelectorAll('input, select')) { if (!input.reportValidity()) return; }
  if (step === 1 && !/([0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.test($('parentPage').value.trim().split('?')[0])) {
    notify('Paste a complete Notion page link or its page ID.', true); return;
  }
  notify('');
  if (step < 2) { showStep(step + 1); fields[step].querySelector('input, select')?.focus(); return; }
  try { new Intl.DateTimeFormat('en', { timeZone: $('timezone').value }); }
  catch { notify('Enter an IANA timezone, for example America/New_York.', true); return; }
  const values = Object.fromEntries(new FormData(form));
  operation('setup', values);
});
$('back').onclick = () => { notify(''); showStep(step - 1); };
$('cancel').onclick = () => { notify(''); showDashboard(); };
$('reconnect').onclick = () => { notify(''); showWizard(); };
$('provider').onchange = () => { $('model').value = ''; $('aiKey').value = ''; };
$('provider-help').onclick = () => open($('provider').value);
$('notion-link').onclick = () => open('workspace');
document.querySelectorAll('[data-open]').forEach(button => { button.onclick = () => open(button.dataset.open); });
for (const [id, command] of Object.entries({ check: 'check', repair: 'schedule', stop: 'unschedule', 'add-settings': 'settings' }))
  $(id).onclick = () => operation(command);
async function load() {
  if (busy) return;
  lock(true);
  try { await refresh(); notify(''); $('retry-load').hidden = true; }
  catch (error) { notify(error.message, true); $('retry-load').hidden = false; }
  finally { lock(false); }
}
$('refresh').onclick = load;
$('retry-load').onclick = load;
window.dealfinder.onProgress(message => notify(message));
window.dealfinder.onSettings(() => { if (!busy && current?.configured) showDashboard(); });
$('timezone').value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
load();
