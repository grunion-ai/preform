import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, PreFormError } from '../lib/client.mjs';
import { fakeServer } from './fake-server.mjs';

test('request parses JSON and sends bodies', async () => {
  const s = await fakeServer({ 'POST /scene/': ({ body }) => [200, { id: 's1', echo: body }] });
  const api = createClient(s.url);
  const out = await api.request('POST', '/scene/', { machine_type: 'FORM-4-0' });
  assert.equal(out.id, 's1');
  assert.deepEqual(s.calls[0].body, { machine_type: 'FORM-4-0' });
  await s.close();
});

test('errors carry the Formlabs code and message', async () => {
  const s = await fakeServer({ 'GET /scene/nope/': () => [404, { error: { code: 'SCENE_NOT_FOUND', message: 'no scene' } }] });
  const api = createClient(s.url);
  await assert.rejects(api.request('GET', '/scene/nope/'), (e) => e instanceof PreFormError && e.code === 'SCENE_NOT_FOUND' && e.status === 404 && /no scene/.test(e.message));
  await s.close();
});

test('run submits async, polls the operation and returns its result', async () => {
  let polls = 0;
  const s = await fakeServer({
    'POST /scene/s1/auto-orient/': ({ query }) => [query.get('async') === 'true' ? 202 : 500, { operationId: 'op1' }],
    'GET /operations/op1/': () => [200, ++polls < 3 ? { id: 'op1', status: 'IN_PROGRESS', progress: polls / 3 } : { id: 'op1', status: 'SUCCEEDED', progress: 1, result: { done: true } }],
  });
  const api = createClient(s.url, { pollMs: 1 });
  const progress = [];
  const out = await api.run('POST', '/scene/s1/auto-orient/', {}, { onProgress: (p) => progress.push(p) });
  assert.deepEqual(out, { done: true });
  assert.equal(polls, 3);
  assert.ok(progress.length >= 2);
  await s.close();
});

test('run surfaces a FAILED operation as an error', async () => {
  const s = await fakeServer({
    'POST /scene/s1/auto-support/': () => [202, { operationId: 'op2' }],
    'GET /operations/op2/': () => [200, { id: 'op2', status: 'FAILED', result: { error: { code: 'SUPPORT_FAILED', message: 'unsupportable' } } }],
  });
  const api = createClient(s.url, { pollMs: 1 });
  await assert.rejects(api.run('POST', '/scene/s1/auto-support/', {}), (e) => e.code === 'SUPPORT_FAILED');
  await s.close();
});

test('run with wait:false returns the operation id', async () => {
  const s = await fakeServer({ 'POST /scene/s1/auto-layout/': () => [202, { operationId: 'op3' }] });
  const api = createClient(s.url);
  assert.deepEqual(await api.run('POST', '/scene/s1/auto-layout/', {}, { wait: false }), { operationId: 'op3' });
  await s.close();
});

test('run accepts a synchronous 200 as the result', async () => {
  const s = await fakeServer({ 'POST /scene/s1/estimate-print-time/': () => [200, { total_print_time_s: 60 }] });
  const api = createClient(s.url);
  assert.deepEqual(await api.run('POST', '/scene/s1/estimate-print-time/'), { total_print_time_s: 60 });
  await s.close();
});
