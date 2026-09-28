const HELP_LINKS = Object.freeze({
  notion: 'https://www.notion.so/profile/integrations',
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
});

function isSettingsLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'dealfinder:' && url.hostname === 'settings' &&
      ['', '/'].includes(url.pathname) && !url.username && !url.password && !url.port && !url.search && !url.hash;
  } catch { return false; }
}

function notionURL(id) {
  if (typeof id !== 'string' || !/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(id))
    throw new Error('Finish connecting your Notion page first.');
  return `https://www.notion.so/${id.replaceAll('-', '')}`;
}

module.exports = { HELP_LINKS, isSettingsLink, notionURL };
