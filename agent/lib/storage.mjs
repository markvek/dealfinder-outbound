import { mkdir, readFile, writeFile, rename, appendFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function dataDirectory(platform = process.platform, env = process.env) {
  if (env.DEALFINDER_HOME) return path.resolve(env.DEALFINDER_HOME);
  return platform === 'win32'
    ? path.join(env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'), 'DealFinder')
    : path.join(homedir(), 'Library', 'Application Support', 'DealFinder');
}

export class Store {
  constructor(directory = dataDirectory()) { this.directory = directory; }
  file(name) { return path.join(this.directory, name); }
  async init() { await mkdir(this.directory, { recursive: true, mode: 0o700 }); }
  async read(name, fallback = null) {
    try { return JSON.parse(await readFile(this.file(name), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
  }
  async write(name, value) {
    await this.init();
    const temp = this.file(`${name}.${randomUUID()}.tmp`);
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, this.file(name));
  }
  async log(event, details = {}) {
    await this.init();
    const file = this.file('agent.log');
    try { if ((await stat(file)).size > 2_000_000) await rename(file, `${file}.1`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await appendFile(file, `${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`, { mode: 0o600 });
  }
}

export async function credentials(profile, values) {
  const { Entry } = await import('@napi-rs/keyring');
  const entry = new Entry('dealfinder-local', profile);
  if (values) entry.setPassword(JSON.stringify(values));
  const saved = entry.getPassword();
  if (!saved) throw new Error('Credentials missing. Run the installer or setup again.');
  return JSON.parse(saved);
}
