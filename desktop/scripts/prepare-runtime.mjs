import { mkdir, copyFile, chmod, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

if (!['darwin', 'win32'].includes(process.platform)) throw new Error('Build DealFinder on macOS or Windows.');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) throw new Error('Build with Node 22.13 or newer.');
if (process.platform === 'darwin') {
  const { stdout } = await promisify(execFile)('otool', ['-L', process.execPath]);
  const libraries = stdout.split('\n').slice(1).map(line => line.trim().split(' ')[0]).filter(Boolean);
  if (libraries.some(library => !library.startsWith('/usr/lib/') && !library.startsWith('/System/Library/')))
    throw new Error('Use an official standalone Node distribution (nodejs.org or nvm). This Node depends on libraries outside macOS.');
}
const directory = fileURLToPath(new URL('../runtime/', import.meta.url));
await mkdir(directory, { recursive: true });
const target = path.join(directory, process.platform === 'win32' ? 'node.exe' : 'node');
await copyFile(process.execPath, target);
await chmod(target, 0o755);
const license = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
if (!license.ok) throw new Error('Could not retrieve the bundled Node license. Retry the build.');
await writeFile(path.join(directory, 'NODE-LICENSE'), await license.text());
const launcherURL = process.env.DEALFINDER_LAUNCHER_URL || null;
if (launcherURL) {
  const url = new URL(launcherURL);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('DEALFINDER_LAUNCHER_URL must be a public HTTPS URL without credentials, query, or fragment.');
}
await writeFile(path.join(directory, 'build.json'), JSON.stringify({ platform: process.platform, arch: process.arch, node: process.version, launcherURL }));
console.log(`Bundled Node ${process.version} for ${process.platform}/${process.arch}. Build on each target OS and architecture.`);
