// Printer emulator: virtual Formlabs printers, a print-run state machine on a
// simulation clock, consumables and an event log. Pure state; no I/O.
import { randomUUID } from 'node:crypto';

export const PRINTER_PRESETS = {
  'Form 4':  { prefix: 'Form4',  product_name: 'Form 4',  machine_type: 'FORM-4-0', firmware: '2.6.1', kind: 'sla', material_code: 'FLGPBK05' },
  'Form 4B': { prefix: 'Form4B', product_name: 'Form 4B', machine_type: 'FORM-4-0', firmware: '2.6.1', kind: 'sla', material_code: 'FLBMCL01' },
  'Form 4L': { prefix: 'Form4L', product_name: 'Form 4L', machine_type: 'FRML-4-0', firmware: '2.6.1', kind: 'sla', material_code: 'FLGPBK05' },
  'Form 3':  { prefix: 'Form3',  product_name: 'Form 3+', machine_type: 'FORM-3-1', firmware: '1.19.0', kind: 'sla', material_code: 'FLGPBK04' },
  'Fuse 1+': { prefix: 'Fuse1P', product_name: 'Fuse 1+ 30W', machine_type: 'FS30-1-0', firmware: '1.20.0', kind: 'sls', material_code: 'FLP12B01' },
};
const POWDER_G_PER_ML = 0.45; // packed nylon powder density, close enough for a simulator

export class EmuError extends Error { constructor(code, message) { super(`${code}: ${message}`); this.code = code; } }

function seedPrinter(label, n) {
  const p = PRINTER_PRESETS[label];
  if (!p) throw new EmuError('UNKNOWN_PRESET', `no printer preset "${label}"; known: ${Object.keys(PRINTER_PRESETS).join(', ')}`);
  const base = { serial: `${p.prefix}-EMU${n}`, product_name: p.product_name, machine_type: p.machine_type, firmware_version: p.firmware, kind: p.kind, status: 'idle', current_run: null, ip_address: `192.0.2.${100 + n}` };
  return p.kind === 'sls'
    ? { ...base, powder: { material_code: p.material_code, credit_g: 6000, used_g: 0 } }
    : { ...base, cartridge: { material_code: p.material_code, volume_ml: 1000, dispensed_ml: 0 }, tank: { material_code: p.material_code, life_ml: 15000, used_ml: 0 } };
}

export function createEmulator({ printers = ['Form 4'], speed = 60, failRate = 0, failAtLayer = 0, random = Math.random, snapshot } = {}) {
  const state = snapshot ?? { sim_time_s: 0, printers: [], runs: [], events: [], next_event: 1 };
  if (!snapshot) {
    const counts = {};
    for (const label of printers) state.printers.push(seedPrinter(label, (counts[label] = (counts[label] ?? 0) + 1)));
  }
  const printer = (serial) => state.printers.find((p) => p.serial === serial);
  const run = (id) => state.runs.find((r) => r.id === id);
  const emit = (type, r, extra = {}) => { state.events.push({ id: state.next_event++, sim_time_s: state.sim_time_s, at: new Date().toISOString(), type, run_id: r?.id ?? null, printer: r?.printer ?? extra.printer ?? null, ...extra }); };

  function enqueue(job) {
    const p = printer(job.printer);
    if (!p) throw new EmuError('PRINTER_NOT_FOUND', `no emulated printer "${job.printer}"`);
    if (job.machine_type && job.machine_type !== p.machine_type) throw new EmuError('MACHINE_TYPE_MISMATCH', `${p.serial} is ${p.machine_type}, job is ${job.machine_type}`);
    const loaded = p.kind === 'sls' ? p.powder.material_code : p.cartridge.material_code;
    if (job.material_code && job.material_code !== loaded) throw new EmuError('MATERIAL_MISMATCH', `${p.serial} has ${loaded} loaded, job needs ${job.material_code}`);
    const r = {
      id: randomUUID(), printer: p.serial, job_name: job.job_name ?? 'job', file: job.file ?? null, machine_type: p.machine_type, material_code: job.material_code ?? loaded,
      layer_thickness_mm: job.layer_thickness_mm ?? null, layer_count: job.layer_count ?? 0, estimate: job.estimate ?? { total_print_time_s: 0 },
      material_usage: job.material_usage ?? { volume_ml: 0 }, models: job.models ?? [], status: 'queued', progress: 0, layer: 0,
      queued_at: state.sim_time_s, started_at: null, ended_at: null, actual_s: null, failure: null, fail_layer: null, fail_code: null,
    };
    state.runs.push(r);
    emit('queued', r);
    return r;
  }

  function start(p, r, at = state.sim_time_s) {
    r.status = 'printing'; r.started_at = at; p.status = 'printing'; p.current_run = r.id;
    if (failAtLayer > 0) { r.fail_layer = failAtLayer; r.fail_code = 'FAIL_AT_LAYER'; }
    else if (failRate > 0 && random() < failRate) { r.fail_layer = Math.max(1, Math.floor(random() * Math.max(1, r.layer_count - 1))); r.fail_code = 'PRINT_FAILURE'; }
    emit('started', r);
  }

  // Draws material for a progress slice; returns null or { code, at } where `at` is
  // the fraction of the slice that could be printed before the consumable ran out.
  function consume(p, r, slice) {
    const ml = (r.material_usage.volume_ml ?? 0) * slice;
    if (ml <= 0) return null;
    if (p.kind === 'sls') {
      const g = ml * POWDER_G_PER_ML, left = p.powder.credit_g - p.powder.used_g;
      p.powder.used_g = round(Math.min(p.powder.credit_g, p.powder.used_g + g));
      return g <= left ? null : { code: 'POWDER_EMPTY', at: left / g };
    }
    const left = p.cartridge.volume_ml - p.cartridge.dispensed_ml, tankLeft = p.tank.life_ml - p.tank.used_ml;
    p.cartridge.dispensed_ml = round(Math.min(p.cartridge.volume_ml, p.cartridge.dispensed_ml + ml));
    p.tank.used_ml = round(Math.min(p.tank.life_ml, p.tank.used_ml + ml));
    if (ml > left) return { code: 'CARTRIDGE_EMPTY', at: left / ml };
    if (ml > tankLeft) return { code: 'TANK_LIFE_EXCEEDED', at: tankLeft / ml };
    return null;
  }

  function finish(p, r, status, failure = null) {
    r.status = status; r.failure = failure; r.ended_at = state.sim_time_s; r.actual_s = round(state.sim_time_s - (r.started_at ?? state.sim_time_s));
    p.status = 'idle'; p.current_run = null;
    emit(status, r, failure ? { failure } : {});
  }

  function advance(p, r) {
    const total = Math.max(1, r.estimate.total_print_time_s ?? 0);
    const prevProgress = r.progress, prevLayer = r.layer;
    let progress = Math.min(1, (state.sim_time_s - r.started_at) / total);
    if (r.fail_layer) progress = Math.min(progress, r.fail_layer / Math.max(1, r.layer_count));
    const short = consume(p, r, progress - prevProgress);
    if (short) progress = prevProgress + (progress - prevProgress) * short.at;
    r.progress = round(progress, 4); r.layer = Math.floor(progress * r.layer_count);
    if (Math.floor(progress * 10) > Math.floor(prevProgress * 10) && r.layer !== prevLayer) emit('layer', r, { layer: r.layer, progress: r.progress });
    if (short) return finish(p, r, 'failed', short.code);
    if (r.fail_layer && r.layer >= r.fail_layer) return finish(p, r, 'failed', r.fail_code);
    if (progress >= 1) finish(p, r, 'finished');
  }

  // A job queued between ticks starts at the beginning of the tick that finds it.
  function tick(seconds) {
    const before = state.sim_time_s;
    state.sim_time_s = round(before + Math.max(0, seconds));
    const startNext = (p, at) => { const next = state.runs.find((r) => r.printer === p.serial && r.status === 'queued'); if (next) start(p, next, at); };
    for (const p of state.printers) {
      if (!p.current_run) startNext(p, before);
      if (p.current_run) advance(p, run(p.current_run));
      if (!p.current_run) startNext(p, state.sim_time_s);
    }
    return state.sim_time_s;
  }

  function abort(id) {
    const r = run(id);
    if (!r) throw new EmuError('RUN_NOT_FOUND', `no run ${id}`);
    if (r.status !== 'queued' && r.status !== 'printing') throw new EmuError('RUN_NOT_ACTIVE', `run ${id} is ${r.status}`);
    const p = printer(r.printer);
    if (p.current_run === id) finish(p, r, 'aborted'); else { r.status = 'aborted'; r.ended_at = state.sim_time_s; emit('aborted', r); }
    return r;
  }

  return {
    state, enqueue, tick, abort, printer, run,
    printers: () => state.printers,
    runs: (filter = {}) => state.runs.filter((r) => (!filter.status || r.status === filter.status) && (!filter.printer || r.printer === filter.printer)),
    events: (since = 0) => state.events.filter((e) => e.id > since),
    snapshot: () => structuredClone(state),
    get simTime() { return state.sim_time_s; },
  };
}

const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
