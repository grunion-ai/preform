// HTTP front for the emulator. State lives in one SQLite file (node:sqlite) as a
// JSON snapshot; ponytail: normalise into tables when reporting needs joins.
import http from 'node:http';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createEmulator, EmuError } from './emu.mjs';

export const EMU_VERSION = '0.1.0';

function openStore(file) {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, saved_at TEXT NOT NULL)');
  const get = db.prepare('SELECT json FROM state WHERE id = 1');
  const put = db.prepare('INSERT INTO state (id, json, saved_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, saved_at = excluded.saved_at');
  return {
    load: () => { const row = get.get(); return row ? JSON.parse(row.json) : null; },
    save: (state) => put.run(JSON.stringify(state), new Date().toISOString()),
    close: () => db.close(),
  };
}

export async function startEmulatorServer({ port = 44389, host = '127.0.0.1', db = path.join(process.env.HOME ?? '.', '.preform', 'emu.db'), printers, speed = 60, failRate = 0, failAtLayer = 0, tickMs = 1000, log = () => {} } = {}) {
  const store = openStore(db);
  const snapshot = printers ? null : store.load();
  const emu = createEmulator({ printers: printers ?? ['Form 4'], speed, failRate, failAtLayer, snapshot: snapshot ?? undefined });
  const persist = () => store.save(emu.state);
  persist();

  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const routes = [
    ['GET', /^\/$/, () => [200, { emulator: 'preform', version: EMU_VERSION, sim_time_s: emu.simTime, speed, printers: emu.printers().length }]],
    ['GET', /^\/printers$/, () => [200, { printers: emu.printers() }]],
    ['GET', /^\/printers\/([^/]+)$/, ([serial]) => { const p = emu.printer(serial); return p ? [200, p] : [404, err('PRINTER_NOT_FOUND', serial)]; }],
    ['POST', /^\/jobs$/, (_, body) => { const r = emu.enqueue(body ?? {}); return [202, { run_id: r.id, status: r.status, printer: r.printer }]; }],
    ['GET', /^\/runs$/, (_, __, q) => [200, { runs: emu.runs({ status: q.get('status') ?? undefined, printer: q.get('printer') ?? undefined }) }]],
    ['GET', /^\/runs\/([^/]+)$/, ([id]) => { const r = emu.run(id); return r ? [200, r] : [404, err('RUN_NOT_FOUND', id)]; }],
    ['POST', /^\/runs\/([^/]+)\/abort$/, ([id]) => [200, emu.abort(id)]],
    ['GET', /^\/events$/, (_, __, q) => [200, { events: emu.events(Number(q.get('since') ?? 0)) }]],
    ['POST', /^\/tick$/, (_, body) => [200, { sim_time_s: emu.tick(Number(body?.seconds ?? 0)) }]],
  ];
  const err = (code, message) => ({ error: { code, message } });

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const route = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
      if (!route) return json(res, 404, err('NOT_FOUND', `${req.method} ${url.pathname}`));
      try {
        const body = raw ? JSON.parse(raw) : undefined;
        const [status, out] = route[2](url.pathname.match(route[1]).slice(1), body, url.searchParams);
        if (req.method === 'POST') persist();
        json(res, status, out);
      } catch (e) {
        json(res, e instanceof EmuError ? 400 : 500, err(e.code ?? 'INTERNAL', e.message));
      }
    });
  });
  await new Promise((r) => server.listen(port, host, r));
  let last = Date.now();
  const timer = speed > 0 ? setInterval(() => { const now = Date.now(); emu.tick(((now - last) / 1000) * speed); last = now; persist(); }, tickMs) : null;
  timer?.unref();
  const url = `http://${host}:${server.address().port}`;
  log(`emulator ready at ${url} (speed ${speed}x, ${emu.printers().length} printers, db ${db})`);
  return { url, emu, close: async () => { if (timer) clearInterval(timer); persist(); server.closeAllConnections(); await new Promise((r) => server.close(r)); store.close(); } };
}
