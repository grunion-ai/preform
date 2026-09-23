import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReleases, pickRelease } from '../scripts/install-preformserver.mjs';

const page = `
<h3>3.63.0</h3><p>Sept 16, 2026. API 0.9.30</p>
<a href="https://downloads.formlabs.com/PreFormServer/Release/3.63.0/PreForm_Server_mac-arm64_3.63.0_release_releaser_651_156561.zip">mac arm</a>
<a href="https://downloads.formlabs.com/PreFormServer/Release/3.63.0/PreForm_Server_mac_3.63.0_release_releaser_651_156560.zip">mac</a>
<a href="https://downloads.formlabs.com/PreFormServer/Release/3.63.0/PreForm_Server_win_3.63.0_release_releaser_651_133718.zip">win</a>
<h3>3.62.1</h3>
<a href="https://downloads.formlabs.com/PreFormServer/Release/3.62.1/PreForm_Server_mac_3.62.1_release_releaser_648_152762.zip">mac</a>
<a href="https://evil.example/PreFormServer/Release/9.9.9/PreForm_Server_mac-arm64_9.9.9_release_releaser_1_1.zip">nope</a>
`;

test('parseReleases keeps only downloads.formlabs.com release zips, grouped by version', () => {
  const r = parseReleases(page);
  assert.deepEqual(Object.keys(r).sort(), ['3.62.1', '3.63.0']);
  assert.deepEqual(Object.keys(r['3.63.0']).sort(), ['mac', 'mac-arm64', 'win']);
  assert.equal(r['3.62.1']['mac-arm64'], undefined);
});

test('pickRelease prefers arm64 on Apple Silicon and falls back to Intel', () => {
  const r = parseReleases(page);
  assert.match(pickRelease(r, 'darwin', 'arm64').url, /mac-arm64_3\.63\.0/);
  assert.match(pickRelease(r, 'darwin', 'x64').url, /Server_mac_3\.63\.0/);
  assert.match(pickRelease(r, 'win32', 'x64').url, /Server_win_3\.63\.0/);
  assert.equal(pickRelease(r, 'darwin', 'arm64').version, '3.63.0');
});
