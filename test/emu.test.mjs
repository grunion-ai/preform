import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmulator, PRINTER_PRESETS } from '../lib/emu.mjs';

const job = (over = {}) => ({
  printer: 'Form4-EMU1', job_name: 'cube', file: '/tmp/cube.form', machine_type: 'FORM-4-0', material_code: 'FLGPBK05',
  layer_thickness_mm: 0.1, layer_count: 200, estimate: { total_print_time_s: 2000 }, material_usage: { volume_ml: 10 }, models: [{ name: 'cube' }], ...over,
});

test('presets seed printers with serials, machine types and consumables', () => {
  const emu = createEmulator({ printers: ['Form 4', 'Form 4L', 'Fuse 1+'] });
  const p = emu.printers();
  assert.deepEqual(p.map((x) => x.serial), ['Form4-EMU1', 'Form4L-EMU1', 'Fuse1P-EMU1']);
  assert.equal(p[0].machine_type, 'FORM-4-0');
  assert.equal(p[1].machine_type, 'FRML-4-0');
  assert.equal(p[2].machine_type, 'FS30-1-0');
  assert.ok(p[0].cartridge.volume_ml > 0 && p[0].tank.life_ml > 0);
  assert.ok(p[2].powder.credit_g > 0);
  assert.ok(Object.keys(PRINTER_PRESETS).includes('Form 4'));
  const two = createEmulator({ printers: ['Form 4', 'Form 4'] });
  assert.deepEqual(two.printers().map((x) => x.serial), ['Form4-EMU1', 'Form4-EMU2']);
});

test('a job queues, starts, advances by layer on the sim clock and finishes', () => {
  const emu = createEmulator({ printers: ['Form 4'] });
  const run = emu.enqueue(job());
  assert.equal(run.status, 'queued');
  emu.tick(0);
  assert.equal(emu.run(run.id).status, 'printing');
  assert.equal(emu.printer('Form4-EMU1').status, 'printing');
  emu.tick(1000);
  const mid = emu.run(run.id);
  assert.equal(mid.status, 'printing');
  assert.equal(mid.layer, 100);
  assert.equal(mid.progress, 0.5);
  emu.tick(1000);
  const done = emu.run(run.id);
  assert.equal(done.status, 'finished');
  assert.equal(done.layer, 200);
  assert.equal(done.actual_s, 2000);
  assert.equal(emu.printer('Form4-EMU1').status, 'idle');
  assert.equal(emu.printer('Form4-EMU1').cartridge.dispensed_ml, 10);
  assert.equal(emu.printer('Form4-EMU1').tank.used_ml, 10);
  assert.deepEqual(emu.events().map((e) => e.type).filter((t) => t !== 'layer'), ['queued', 'started', 'finished']);
});

test('one run per printer; the second waits in the queue', () => {
  const emu = createEmulator({ printers: ['Form 4'] });
  const a = emu.enqueue(job()), b = emu.enqueue(job({ job_name: 'second' }));
  emu.tick(0);
  assert.equal(emu.run(a.id).status, 'printing');
  assert.equal(emu.run(b.id).status, 'queued');
  emu.tick(2000);
  assert.equal(emu.run(a.id).status, 'finished');
  assert.equal(emu.run(b.id).status, 'printing');
});

test('enqueue rejects an unknown printer, a machine type mismatch and a material mismatch', () => {
  const emu = createEmulator({ printers: ['Form 4'] });
  assert.throws(() => emu.enqueue(job({ printer: 'nope' })), /PRINTER_NOT_FOUND/);
  assert.throws(() => emu.enqueue(job({ machine_type: 'FS30-1-0' })), /MACHINE_TYPE_MISMATCH/);
  assert.throws(() => emu.enqueue(job({ material_code: 'FLGPCL05' })), /MATERIAL_MISMATCH/);
});

test('fail-at-layer and fail-rate produce failed runs with a code', () => {
  const emu = createEmulator({ printers: ['Form 4'], failAtLayer: 50 });
  const r = emu.enqueue(job());
  emu.tick(0); emu.tick(600);
  const f = emu.run(r.id);
  assert.equal(f.status, 'failed');
  assert.equal(f.failure, 'FAIL_AT_LAYER');
  assert.equal(f.layer, 50);
  assert.equal(emu.printer('Form4-EMU1').status, 'idle');
  const always = createEmulator({ printers: ['Form 4'], failRate: 1, random: () => 0.5 });
  const r2 = always.enqueue(job());
  always.tick(0); always.tick(2000);
  assert.equal(always.run(r2.id).status, 'failed');
  assert.equal(always.run(r2.id).failure, 'PRINT_FAILURE');
  assert.ok(always.run(r2.id).layer > 0 && always.run(r2.id).layer < 200);
});

test('an empty cartridge fails the run where the resin runs out', () => {
  const emu = createEmulator({ printers: ['Form 4'] });
  emu.printer('Form4-EMU1').cartridge.dispensed_ml = emu.printer('Form4-EMU1').cartridge.volume_ml - 5;
  const r = emu.enqueue(job());
  emu.tick(0); emu.tick(2000);
  assert.equal(emu.run(r.id).status, 'failed');
  assert.equal(emu.run(r.id).failure, 'CARTRIDGE_EMPTY');
  assert.equal(emu.run(r.id).layer, 100);
});

test('abort stops a printing or queued run', () => {
  const emu = createEmulator({ printers: ['Form 4'] });
  const a = emu.enqueue(job()), b = emu.enqueue(job());
  emu.tick(0); emu.tick(100);
  assert.equal(emu.abort(a.id).status, 'aborted');
  assert.equal(emu.abort(b.id).status, 'aborted');
  assert.equal(emu.printer('Form4-EMU1').status, 'idle');
  assert.throws(() => emu.abort(a.id), /RUN_NOT_ACTIVE/);
});

test('fuse jobs draw powder', () => {
  const emu = createEmulator({ printers: ['Fuse 1+'] });
  const r = emu.enqueue(job({ printer: 'Fuse1P-EMU1', machine_type: 'FS30-1-0', material_code: 'FLP12B01', material_usage: { volume_ml: 100 } }));
  emu.tick(0); emu.tick(2000);
  assert.equal(emu.run(r.id).status, 'finished');
  assert.ok(emu.printer('Fuse1P-EMU1').powder.used_g > 0);
});

test('state round-trips through snapshot and restore', () => {
  const emu = createEmulator({ printers: ['Form 4'] });
  const r = emu.enqueue(job());
  emu.tick(0); emu.tick(500);
  const back = createEmulator({ snapshot: emu.snapshot() });
  assert.equal(back.run(r.id).status, 'printing');
  back.tick(1500);
  assert.equal(back.run(r.id).status, 'finished');
});
