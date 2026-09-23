import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findServer, startServer } from '../lib/server.mjs';

test('findServer prefers PREFORM_SERVER over the platform default', () => {
  assert.equal(findServer({ PREFORM_SERVER: '/x/PreFormServer' }, () => true), '/x/PreFormServer');
  const found = findServer({}, (p) => p.includes('/Applications/PreFormServer.app'));
  assert.match(found, /PreFormServer\.app\/Contents\/MacOS\/PreFormServer$/);
  assert.equal(findServer({}, () => false), null);
});

test('startServer resolves once the child prints READY FOR INPUT', async () => {
  const fake = `setTimeout(()=>{console.log('booting');console.log('READY FOR INPUT');setInterval(()=>{},1000)},20)`;
  const child = await startServer(process.execPath, 44399, { args: ['-e', fake], timeoutMs: 5000 });
  assert.ok(child.pid);
  child.kill();
});

test('startServer rejects when the child exits first', async () => {
  await assert.rejects(startServer(process.execPath, 44399, { args: ['-e', 'process.exit(3)'], timeoutMs: 5000 }), /exited/);
});
