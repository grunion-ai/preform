import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startEmulatorServer } from '../lib/emu-server.mjs';
import { createClient } from '../lib/client.mjs';
import { commands } from '../lib/commands.mjs';
import { fakeServer } from './fake-server.mjs';

const tmpDb = () => path.join(mkdtempSync(path.join(os.tmpdir(), 'preform-emu-')), 'emu.db');
const j = async (url, init) => { const r = await fetch(url, init); return { status: r.status, body: await r.json() }; };
const post = (url, body) => j(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('the emulator serves printers, accepts jobs, ticks and reports runs and events', async () => {
  const srv = await startEmulatorServer({ port: 0, db: tmpDb(), printers: ['Form 4'], speed: 0 });
  const u = srv.url;
  assert.equal((await j(u + '/')).body.emulator, 'preform');
  assert.equal((await j(u + '/printers')).body.printers[0].serial, 'Form4-EMU1');
  const jobBody = { printer: 'Form4-EMU1', job_name: 'cube', file: '/tmp/cube.form', machine_type: 'FORM-4-0', material_code: 'FLGPBK05', layer_thickness_mm: 0.1, layer_count: 100, estimate: { total_print_time_s: 1000 }, material_usage: { volume_ml: 5 }, models: [] };
  const acc = await post(u + '/jobs', jobBody);
  assert.equal(acc.status, 202);
  const id = acc.body.run_id;
  assert.equal((await post(u + '/tick', { seconds: 500 })).body.sim_time_s, 500);
  const run = (await j(`${u}/runs/${id}`)).body;
  assert.equal(run.status, 'printing');
  assert.equal(run.layer, 50);
  assert.equal((await j(u + '/runs?status=printing')).body.runs.length, 1);
  const bad = await post(u + '/jobs', { ...jobBody, printer: 'nope' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'PRINTER_NOT_FOUND');
  const ev = (await j(u + '/events')).body.events;
  assert.ok(ev.some((e) => e.type === 'started'));
  assert.equal((await post(`${u}/runs/${id}/abort`, {})).body.status, 'aborted');
  assert.equal((await j(u + '/runs/missing')).status, 404);
  await srv.close();
});

test('state survives a restart from the same db', async () => {
  const db = tmpDb();
  let srv = await startEmulatorServer({ port: 0, db, printers: ['Form 4'], speed: 0 });
  const acc = await post(srv.url + '/jobs', { printer: 'Form4-EMU1', job_name: 'x', file: '/x.form', machine_type: 'FORM-4-0', material_code: 'FLGPBK05', layer_thickness_mm: 0.1, layer_count: 10, estimate: { total_print_time_s: 100 }, material_usage: { volume_ml: 1 }, models: [] });
  await post(srv.url + '/tick', { seconds: 50 });
  await srv.close();
  srv = await startEmulatorServer({ port: 0, db, speed: 0 });
  assert.equal((await j(`${srv.url}/runs/${acc.body.run_id}`)).body.status, 'printing');
  await srv.close();
});

test('print --printer emu:<serial> gathers the scene, saves the form and enqueues on the emulator', async () => {
  const emu = await startEmulatorServer({ port: 0, db: tmpDb(), printers: ['Form 4'], speed: 0 });
  const pf = await fakeServer({
    'GET /scene/s1/': () => [200, { id: 's1', layer_count: 120, material_usage: { volume_ml: 7 }, scene_settings: { machine_type: 'FORM-4-0', material_code: 'FLGPBK05', layer_thickness_mm: 0.1 }, models: [{ id: 'm1', name: 'cube' }] }],
    'POST /scene/s1/estimate-print-time/': () => [200, { total_print_time_s: 1200 }],
    'POST /scene/s1/save-form/': ({ body }) => [200, { file: body.file }],
  });
  const ctx = { api: createClient(pf.url, { pollMs: 1 }), flags: { printer: 'Form4-EMU1', name: 'Cube', 'emu-url': emu.url, out: '/tmp/cube-emu.form' }, onProgress() {}, log() {} };
  ctx.flags.printer = 'emu:Form4-EMU1';
  const out = await commands.print(ctx, ['s1']);
  assert.ok(out.run_id);
  assert.equal(out.printer, 'Form4-EMU1');
  assert.ok(pf.calls.some((c) => c.path === '/scene/s1/save-form/' && c.body.file.endsWith('/cube-emu.form')));
  const run = (await j(`${emu.url}/runs/${out.run_id}`)).body;
  assert.equal(run.job_name, 'Cube');
  assert.equal(run.layer_count, 120);
  assert.equal(run.estimate.total_print_time_s, 1200);
  await pf.close(); await emu.close();
});

test('emu query commands read the emulator', async () => {
  const emu = await startEmulatorServer({ port: 0, db: tmpDb(), printers: ['Form 4'], speed: 0 });
  const ctx = { api: null, flags: { 'emu-url': emu.url }, onProgress() {}, log() {} };
  assert.equal((await commands['emu printers'](ctx, [])).printers.length, 1);
  assert.equal((await commands['emu tick'](ctx, ['30'])).sim_time_s, 30);
  assert.deepEqual((await commands['emu runs'](ctx, [])).runs, []);
  await emu.close();
});
