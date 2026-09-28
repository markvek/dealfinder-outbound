import { writeFile, mkdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
export const LABEL = 'com.dealfinder.sourcing';
export const TASK = 'DealFinder Sourcing';
const xml = value => String(value).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
const ps = value => `'${String(value).replace(/'/g, "''")}'`;
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));

export function launchAgent(node, script, directory) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(script)}</string><string>tick</string></array>
<key>EnvironmentVariables</key><dict><key>DEALFINDER_HOME</key><string>${xml(directory)}</string></dict>
<key>RunAtLoad</key><true/><key>StartInterval</key><integer>900</integer>
<key>ProcessType</key><string>Background</string>
</dict></plist>\n`;
}

export function windowsLauncher(node, script, directory) {
  return `$ErrorActionPreference = 'Stop'\n$env:DEALFINDER_HOME = ${ps(directory)}\n& ${ps(node)} ${ps(script)} tick\nexit $LASTEXITCODE\n`;
}
export function windowsRegistration(launcher) {
  // PowerShell's task cmdlets handle XML escaping. Script literals escape single
  // quotes; the action argument quotes a Windows filename (which cannot contain ").
  return `$ErrorActionPreference = 'Stop'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Argument ${ps(`-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${launcher}"`)}
$periodic = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15)
$login = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 3)
Register-ScheduledTask -TaskName '${TASK}' -Action $action -Trigger @($periodic, $login) -Principal $principal -Settings $settings -Force | Out-Null
`;
}

function supported() {
  if (!['darwin', 'win32'].includes(process.platform)) throw new Error('Native scheduling supports macOS and Windows only.');
}
export async function schedule(store, runtime = { node: process.execPath, cli }) {
  supported();
  await store.init();
  if (process.platform === 'darwin') {
    const dir = path.join(homedir(), 'Library', 'LaunchAgents');
    const file = path.join(dir, `${LABEL}.plist`);
    await mkdir(dir, { recursive: true });
    const domain = `gui/${process.getuid()}`;
    try { await exec('launchctl', ['bootout', `${domain}/${LABEL}`]); } catch { /* First installation. */ }
    await writeFile(file, launchAgent(runtime.node, runtime.cli, store.directory), { mode: 0o600 });
    await exec('launchctl', ['bootstrap', domain, file]);
  } else {
    const launcher = store.file('scheduled-run.ps1');
    const installer = store.file('register-task.ps1');
    await writeFile(launcher, '\ufeff' + windowsLauncher(runtime.node, runtime.cli, store.directory));
    await writeFile(installer, '\ufeff' + windowsRegistration(launcher));
    await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', installer]);
  }
}
export async function unschedule() {
  supported();
  if (process.platform === 'darwin') {
    try { await exec('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`]); }
    catch (error) { if ((await schedulerStatus()).installed) throw error; }
    await rm(path.join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`), { force: true });
  } else {
    await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-ScheduledTask -TaskName '${TASK}' -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false`]);
  }
}
export async function schedulerStatus() {
  try {
    if (process.platform === 'darwin') await exec('launchctl', ['print', `gui/${process.getuid()}/${LABEL}`]);
    else if (process.platform === 'win32') await exec('schtasks.exe', ['/Query', '/TN', TASK]);
    else return { installed: false, supported: false };
    return { installed: true };
  } catch { return { installed: false }; }
}
