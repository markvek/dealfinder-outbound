import test from 'node:test';
import assert from 'node:assert/strict';
import links from '../links.cjs';

test('deep links open settings only; never accept commands, secrets, or other destinations', () => {
  assert.equal(links.isSettingsLink('dealfinder://settings'), true);
  assert.equal(links.isSettingsLink('dealfinder://settings/'), true);
  for (const url of ['https://settings', 'dealfinder://run', 'dealfinder://settings?command=run', 'dealfinder://settings/path',
    'dealfinder://user@settings', 'dealfinder://settings#token', 'dealfinder://settings:123', 'invalid'])
    assert.equal(links.isSettingsLink(url), false, url);
});

test('workspace links are generated from validated IDs, never arbitrary external URLs', () => {
  assert.equal(links.notionURL('01234567-89ab-cdef-0123-456789abcdef'), 'https://www.notion.so/0123456789abcdef0123456789abcdef');
  for (const value of [undefined, 'https://evil.example', 'javascript:alert(1)', 'invalid']) assert.throws(() => links.notionURL(value));
});
