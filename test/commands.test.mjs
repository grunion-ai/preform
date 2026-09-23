import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../lib/client.mjs';
import { commands } from '../lib/commands.mjs';
import { fakeServer } from './fake-server.mjs';

const quiet = { onProgress() {}, log() {} };
const ctx = (s, flags = {}) => ({ api: createClient(s.url, { pollMs: 1 }), flags, ...quiet });

test('scene new builds a Manual scene body', async () => {
  const s = await fakeServer({ 'POST /scene/': ({ body }) => [200, { id: 's1', ...body }] });
  const out = await commands['scene new'](ctx(s, { printer: 'FORM-4-0', material: 'FLGPBK05', layer: '0.1' }), []);
  assert.equal(out.id, 's1');
  assert.deepEqual(s.calls[0].body, { machine_type: 'FORM-4-0', material_code: 'FLGPBK05', layer_thickness_mm: 0.1 });
  await s.close();
});

test('scene new defaults the layer to ADAPTIVE and accepts an FPS file', async () => {
  const s = await fakeServer({ 'POST /scene/': ({ body }) => [200, { id: 's1', ...body }] });
  await commands['scene new'](ctx(s, { printer: 'FORM-4-0', material: 'FLGPBK05' }), []);
  assert.equal(s.calls[0].body.layer_thickness_mm, 'ADAPTIVE');
  await commands['scene new'](ctx(s, { fps: '/tmp/x.fps' }), []);
  assert.deepEqual(s.calls[1].body, { fps_file: '/tmp/x.fps' });
  await s.close();
});

test('import resolves the file to an absolute path', async () => {
  const s = await fakeServer({ 'POST /scene/s1/import-model/': ({ body }) => [200, { id: 'm1', name: body.file }] });
  await commands.import(ctx(s, { name: 'Bracket' }), ['s1', 'part.stl']);
  assert.equal(s.calls[0].query.async, 'true');
  assert.ok(s.calls[0].body.file.startsWith('/'));
  assert.ok(s.calls[0].body.file.endsWith('/part.stl'));
  assert.equal(s.calls[0].body.name, 'Bracket');
  await s.close();
});

test('orient, support and layout hit their endpoints with model selection', async () => {
  const s = await fakeServer({
    'POST /scene/s1/auto-orient/': () => [200, {}],
    'POST /scene/s1/auto-support/': () => [200, {}],
    'POST /scene/s1/auto-layout/': () => [200, { models: [] }],
  });
  await commands.orient(ctx(s, { models: ['m1', 'm2'] }), ['s1']);
  await commands.support(ctx(s, { raft: 'MINI_RAFT' }), ['s1']);
  await commands.layout(ctx(s, {}), ['s1']);
  assert.deepEqual(s.calls[0].body, { models: ['m1', 'm2'] });
  assert.deepEqual(s.calls[1].body, { models: 'ALL', raft_type: 'MINI_RAFT' });
  assert.deepEqual(s.calls[2].body, { models: 'ALL' });
  await s.close();
});

test('print requires a printer and a job name', async () => {
  const s = await fakeServer({ 'POST /scene/s1/print/': ({ body }) => [200, { job_id: 'j1', ...body }] });
  await assert.rejects(commands.print(ctx(s, {}), ['s1']), /--printer/);
  const out = await commands.print(ctx(s, { printer: 'Form4-ABC', name: 'Bracket', now: true }), ['s1']);
  assert.equal(out.job_id, 'j1');
  assert.deepEqual(s.calls[0].body, { printer: 'Form4-ABC', job_name: 'Bracket', print_now: true });
  await s.close();
});

test('api passes any method, path and JSON through', async () => {
  const s = await fakeServer({ 'DELETE /scene/s1/': () => [200, { deleted: true }], 'GET /devices/': () => [200, { count: 0, devices: [] }] });
  assert.deepEqual(await commands.api(ctx(s), ['DELETE', '/scene/s1/']), { deleted: true });
  assert.deepEqual(await commands.api(ctx(s), ['get', 'devices']), { count: 0, devices: [] });
  assert.equal(s.calls[1].path, '/devices/');
  await s.close();
});

test('prep runs the whole pipeline in order and saves the job', async () => {
  const s = await fakeServer({
    'POST /scene/': () => [200, { id: 's9' }],
    'POST /scene/s9/import-model/': () => [200, { id: 'm1', name: 'part' }],
    'POST /scene/s9/auto-orient/': () => [200, {}],
    'POST /scene/s9/auto-support/': () => [200, {}],
    'POST /scene/s9/auto-layout/': () => [200, {}],
    'GET /scene/s9/print-validation/': () => [200, { per_model_results: { m1: { ok: true } } }],
    'POST /scene/s9/estimate-print-time/': () => [200, { total_print_time_s: 3600 }],
    'POST /scene/s9/save-form/': ({ body }) => [200, { file: body.file }],
    'DELETE /scene/s9/': () => [200, {}],
  });
  const out = await commands.prep(ctx(s, { printer: 'FORM-4-0', material: 'FLGPBK05', out: 'job.form' }), ['part.stl']);
  assert.deepEqual(s.calls.map((c) => `${c.method} ${c.path}`), [
    'POST /scene/', 'POST /scene/s9/import-model/', 'POST /scene/s9/auto-orient/', 'POST /scene/s9/auto-support/',
    'POST /scene/s9/auto-layout/', 'GET /scene/s9/print-validation/', 'POST /scene/s9/estimate-print-time/', 'POST /scene/s9/save-form/', 'DELETE /scene/s9/',
  ]);
  assert.equal(out.scene, 's9');
  assert.equal(out.estimate.total_print_time_s, 3600);
  assert.ok(out.file.endsWith('/job.form'));
  await s.close();
});

test('prep keeps the scene and skips supports when asked', async () => {
  const s = await fakeServer({
    'POST /scene/': () => [200, { id: 's9' }],
    'POST /scene/s9/import-model/': () => [200, { id: 'm1' }],
    'POST /scene/s9/auto-orient/': () => [200, {}],
    'POST /scene/s9/auto-layout/': () => [200, {}],
    'GET /scene/s9/print-validation/': () => [200, {}],
    'POST /scene/s9/estimate-print-time/': () => [200, { total_print_time_s: 1 }],
  });
  const out = await commands.prep(ctx(s, { printer: 'FORM-4-0', material: 'FLGPBK05', 'no-support': true, keep: true }), ['a.stl', 'b.stl']);
  const paths = s.calls.map((c) => c.path);
  assert.ok(!paths.includes('/scene/s9/auto-support/'));
  assert.ok(!paths.includes('/scene/s9/save-form/'));
  assert.equal(s.calls.filter((c) => c.path === '/scene/s9/import-model/').length, 2);
  assert.equal(out.models.length, 2);
  await s.close();
});
