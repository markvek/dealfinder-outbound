import { cp, mkdtemp, rm } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

// Test from a temporary directory outside the checkout: Node must not resolve
// missing packaged dependencies from the developer's node_modules ancestors.
export async function verifyPackage(resources) {
  const isolated = await mkdtemp(path.join(tmpdir(), 'dealfinder-package-check-'));
  try {
    await cp(path.join(resources, 'agent'), path.join(isolated, 'agent'), { recursive: true });
    await cp(path.join(resources, 'runtime'), path.join(isolated, 'runtime'), { recursive: true });
    const node = path.join(isolated, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
    const env = { ...process.env, DEALFINDER_HOME: path.join(isolated, 'profile') };
    delete env.NODE_PATH;
    delete env.NODE_OPTIONS;
    const { stdout } = await promisify(execFile)(node, ['--input-type=module', '-e',
      "import { Entry } from '@napi-rs/keyring'; await import('@inquirer/prompts'); console.log(typeof Entry);"],
    { cwd: path.join(isolated, 'agent'), env });
    assert.equal(stdout.trim(), 'function', 'Packaged native credential module must load');
    const response = await new Promise((resolve, reject) => {
      const child = spawn(node, [path.join(isolated, 'agent/desktop-worker.mjs')], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.resume();
      child.on('error', reject);
      child.stdin.on('error', reject);
      child.on('close', code => code === 0 ? resolve(output) : reject(new Error('Packaged helper failed outside the checkout.')));
      child.stdin.end(JSON.stringify({ command: 'status' }));
    });
    const event = JSON.parse(response.trim());
    assert.equal(event.type, 'result');
    assert.equal(event.result.hasConfig, false);
    console.log('Packaged helper and native credential module verified outside the checkout.');
  } finally { await rm(isolated, { recursive: true, force: true }); }
}
