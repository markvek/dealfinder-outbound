const path = require('node:path');
module.exports = async context => {
  const { verifyPackage } = await import('./verify-package.mjs');
  const resources = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, 'DealFinder.app', 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  await verifyPackage(resources);
};
