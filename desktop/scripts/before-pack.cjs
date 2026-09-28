const { readFile } = require('node:fs/promises');
const path = require('node:path');
module.exports = async context => {
  const runtime = JSON.parse(await readFile(path.join(__dirname, '../runtime/build.json'), 'utf8'));
  const targetArch = ['ia32', 'x64', 'arm', 'arm64', 'universal'][context.arch];
  if (runtime.platform !== context.electronPlatformName || runtime.arch !== targetArch)
    throw new Error('Build on the target OS and architecture so the background runtime and native credential module match.');
};
