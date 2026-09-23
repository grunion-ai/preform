// One function per command. ctx = { api, flags, onProgress, log }.
import path from 'node:path';
import os from 'node:os';
import { mkdirSync } from 'node:fs';

const abs = (p) => path.resolve(p);
const models = (flags) => (flags.models ? { models: [].concat(flags.models).flatMap((m) => m.split(',')) } : { models: 'ALL' });
const need = (flags, key, hint) => { if (flags[key] === undefined || flags[key] === true) throw new Error(`--${key} is required${hint ? ` (${hint})` : ''}`); return flags[key]; };
const opts = (ctx) => ({ wait: !ctx.flags['no-wait'], onProgress: ctx.onProgress });
const layer = (v) => (v === undefined || String(v).toUpperCase() === 'ADAPTIVE' ? 'ADAPTIVE' : Number(v));

function sceneBody(flags) {
  if (flags.fps) return { fps_file: abs(flags.fps) };
  const body = { machine_type: need(flags, 'printer', 'e.g. FORM-4-0, FS30-1-0'), material_code: need(flags, 'material', 'see: preform materials'), layer_thickness_mm: layer(flags.layer) };
  if (flags.setting) body.print_setting = flags.setting;
  return body;
}

export const emuUrl = (flags) => (flags['emu-url'] ?? process.env.PREFORM_EMU_URL ?? 'http://127.0.0.1:44389').replace(/\/$/, '');

async function emuRequest(ctx, method, p, body) {
  const res = await fetch(emuUrl(ctx.flags) + p, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { const e = new Error(data?.error?.message ?? `${method} ${p} failed with ${res.status}`); e.code = data?.error?.code ?? `HTTP_${res.status}`; throw e; }
  return data;
}

// The emulator print seam: PreFormServer stays the geometry engine, the emulator gets the job record.
async function printToEmulator(ctx, sceneId, serial) {
  const { api, flags } = ctx;
  const scene = await api.request('GET', `/scene/${sceneId}/`);
  const estimate = await api.run('POST', `/scene/${sceneId}/estimate-print-time/`, undefined, opts(ctx));
  const file = abs(flags.out ?? path.join(os.homedir(), '.preform', 'jobs', `${sceneId}.form`));
  mkdirSync(path.dirname(file), { recursive: true });
  await api.run('POST', `/scene/${sceneId}/save-form/`, { file }, opts(ctx));
  const s = scene.scene_settings ?? {};
  const job = {
    printer: serial, job_name: flags.name ?? scene.models?.[0]?.name ?? sceneId, file, machine_type: s.machine_type, material_code: s.material_code,
    layer_thickness_mm: Number(s.layer_thickness_mm) || s.layer_thickness_mm, layer_count: scene.layer_count ?? 0, estimate, material_usage: scene.material_usage ?? {},
    models: (scene.models ?? []).map((m) => ({ id: m.id, name: m.name, bounding_box: m.bounding_box })), scene_id: sceneId,
  };
  const out = await emuRequest(ctx, 'POST', '/jobs', job);
  return { ...out, file, estimate };
}

export const commands = {
  version: ({ api }) => api.request('GET', '/'),

  'scene new': ({ api, flags }) => api.request('POST', '/scene/', sceneBody(flags)),
  'scene list': ({ api }) => api.request('GET', '/scenes/'),
  'scene get': ({ api }, [id]) => api.request('GET', `/scene/${id}/`),
  'scene rm': ({ api }, [id]) => api.request('DELETE', `/scene/${id}/`),
  load: (ctx, [file]) => ctx.api.run('POST', '/load-form/', { file: abs(file) }, opts(ctx)),
  save: (ctx, [id, file]) => ctx.api.run('POST', `/scene/${id}/save-form/`, { file: abs(file) }, opts(ctx)),
  screenshot: (ctx, [id, file]) => ctx.api.run('POST', `/scene/${id}/save-screenshot/`, { file: abs(file) }, opts(ctx)),

  import: (ctx, [id, file]) => ctx.api.run('POST', `/scene/${id}/import-model/`, { file: abs(file), ...(ctx.flags.name ? { name: ctx.flags.name } : {}) }, opts(ctx)),
  orient: (ctx, [id]) => ctx.api.run('POST', `/scene/${id}/auto-orient/`, models(ctx.flags), opts(ctx)),
  support: (ctx, [id]) => ctx.api.run('POST', `/scene/${id}/auto-support/`, { ...models(ctx.flags), ...(ctx.flags.raft ? { raft_type: ctx.flags.raft } : {}) }, opts(ctx)),
  layout: (ctx, [id]) => ctx.api.run('POST', `/scene/${id}/auto-layout/`, models(ctx.flags), opts(ctx)),
  validate: (ctx, [id]) => ctx.api.run('GET', `/scene/${id}/print-validation/`, undefined, opts(ctx)),
  estimate: (ctx, [id]) => ctx.api.run('POST', `/scene/${id}/estimate-print-time/`, undefined, opts(ctx)),

  devices: ({ api }) => api.request('GET', '/devices/'),
  device: ({ api }, [id]) => api.request('GET', `/devices/${id}/`),
  discover: (ctx) => ctx.api.run('POST', '/discover-devices/', { timeout_seconds: Number(ctx.flags.timeout ?? 10) }, opts(ctx)),
  materials: async ({ api, flags }) => {
    const all = await api.request('GET', '/list-materials/');
    if (!flags.printer) return all;
    return { printer_types: all.printer_types.filter((p) => p.supported_machine_type_ids?.includes(flags.printer) || p.label === flags.printer) };
  },
  print: async (ctx, [id]) => {
    const printer = need(ctx.flags, 'printer', 'printer name, serial or IP, or emu:<serial>');
    if (printer.startsWith('emu:')) return printToEmulator(ctx, id, printer.slice(4));
    return ctx.api.run('POST', `/scene/${id}/print/`, {
      printer, job_name: need(ctx.flags, 'name', 'job name'), ...(ctx.flags.now ? { print_now: true } : {}),
    }, opts(ctx));
  },

  'emu printers': (ctx) => emuRequest(ctx, 'GET', '/printers'),
  'emu printer': (ctx, [serial]) => emuRequest(ctx, 'GET', `/printers/${serial}`),
  'emu runs': (ctx) => emuRequest(ctx, 'GET', `/runs${ctx.flags.status ? `?status=${ctx.flags.status}` : ''}`),
  'emu run': (ctx, [id]) => emuRequest(ctx, 'GET', `/runs/${id}`),
  'emu abort': (ctx, [id]) => emuRequest(ctx, 'POST', `/runs/${id}/abort`, {}),
  'emu events': (ctx) => emuRequest(ctx, 'GET', `/events?since=${ctx.flags.since ?? 0}`),
  'emu tick': (ctx, [seconds]) => emuRequest(ctx, 'POST', '/tick', { seconds: Number(seconds ?? 0) }),

  'op list': ({ api }) => api.request('GET', '/operations/'),
  'op get': ({ api }, [id]) => api.request('GET', `/operations/${id}/`),

  api: ({ api }, [method, p, json]) => {
    if (!method || !p) throw new Error('usage: preform api <METHOD> <path> [json]');
    const norm = '/' + p.replace(/^\/|\/$/g, '') + '/';
    return api.request(method.toUpperCase(), p === '/' ? '/' : norm, json === undefined ? undefined : JSON.parse(json));
  },

  // The whole job in one go: scene -> import -> orient -> support -> layout -> validate -> estimate -> save.
  async prep(ctx, files) {
    if (!files.length) throw new Error('usage: preform prep <model...> --printer <type> --material <code> [--out job.form]');
    const { api, flags, log = () => {} } = ctx;
    const scene = (await api.request('POST', '/scene/', sceneBody(flags))).id;
    log(`scene ${scene}`);
    const imported = [];
    for (const f of files) {
      const m = await api.run('POST', `/scene/${scene}/import-model/`, { file: abs(f) }, opts(ctx));
      imported.push(m);
      log(`imported ${f} as ${m?.id ?? '?'}`);
    }
    const step = async (name, method, p) => { log(name); return api.run(method, p, method === 'GET' ? undefined : { models: 'ALL' }, opts(ctx)); };
    await step('orient', 'POST', `/scene/${scene}/auto-orient/`);
    if (!flags['no-support']) await step('support', 'POST', `/scene/${scene}/auto-support/`);
    await step('layout', 'POST', `/scene/${scene}/auto-layout/`);
    const validation = await step('validate', 'GET', `/scene/${scene}/print-validation/`);
    const estimate = await step('estimate', 'POST', `/scene/${scene}/estimate-print-time/`);
    const out = { scene, models: imported, validation, estimate };
    if (flags.out) {
      out.file = abs(flags.out);
      await api.run('POST', `/scene/${scene}/save-form/`, { file: out.file }, opts(ctx));
      log(`saved ${out.file}`);
    }
    if (flags.out && !flags.keep) await api.request('DELETE', `/scene/${scene}/`);
    return out;
  },
};
