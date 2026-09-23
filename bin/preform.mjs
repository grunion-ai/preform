#!/usr/bin/env node
import { parse, usage } from '../lib/cli.mjs';
import { createClient, PreFormError } from '../lib/client.mjs';
import { commands } from '../lib/commands.mjs';
import { findServer, startServer, reachable } from '../lib/server.mjs';

process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') console.error(w); });

const { cmd, args, flags } = parse(process.argv.slice(2));
const url = flags.url ?? process.env.PREFORM_URL ?? 'http://localhost:44388';
const log = (s) => process.stderr.write(s + '\n');

if (cmd === 'help' || flags.help) { console.log(usage()); process.exit(0); }

if (cmd === 'serve') {
  const bin = flags.server ?? findServer();
  if (!bin) { log('PreFormServer not found: set PREFORM_SERVER or pass --server. Download: https://support.formlabs.com/s/article/Formlabs-API'); process.exit(2); }
  const child = await startServer(bin, Number(flags.port ?? 44388), { log });
  log(`PreFormServer ready on port ${flags.port ?? 44388} (pid ${child.pid})`);
  const stop = () => child.kill();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  child.on('exit', (c) => process.exit(c ?? 0));
} else if (cmd === 'emu serve') {
  const { startEmulatorServer } = await import('../lib/emu-server.mjs');
  const srv = await startEmulatorServer({
    port: Number(flags.port ?? 44389), db: flags.db, speed: Number(flags.speed ?? 60), failRate: Number(flags['fail-rate'] ?? 0), failAtLayer: Number(flags['fail-at-layer'] ?? 0),
    printers: flags.printers ? String(flags.printers).split(',').map((s) => s.trim()) : (flags.db || !flags.printers ? undefined : ['Form 4']), log,
  });
  const stop = async () => { await srv.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  await new Promise(() => {});
} else if (cmd.startsWith('emu ') && commands[cmd]) {
  try { console.log(JSON.stringify(await commands[cmd]({ flags, log }, args), null, flags.json ? 0 : 2)); }
  catch (e) { log(e.code ? `${e.code}: ${e.message}` : e.message); process.exitCode = 1; }
} else if (!commands[cmd]) {
  log(`unknown command: ${cmd}\n\n${usage()}`);
  process.exit(2);
} else {
  let child;
  if (!(await reachable(url))) {
    const bin = flags.server ?? findServer();
    if (!bin) { log(`nothing answers at ${url} and PreFormServer was not found. Run "preform serve" or set PREFORM_SERVER.`); process.exit(2); }
    const port = new URL(url).port || 44388;
    log(`starting PreFormServer on port ${port}`);
    child = await startServer(bin, Number(port));
  }
  let last = '';
  const onProgress = (op) => {
    const line = `${op.status} ${Math.round((op.progress ?? 0) * 100)}%`;
    if (line !== last && process.stderr.isTTY) { process.stderr.write(`\r${line}   `); last = line; }
  };
  try {
    const out = await commands[cmd]({ api: createClient(url), flags, onProgress, log }, args);
    if (last) process.stderr.write('\n');
    if (out !== undefined) console.log(JSON.stringify(out, null, flags.json ? 0 : 2));
  } catch (e) {
    if (last) process.stderr.write('\n');
    if (e instanceof PreFormError) log(`${e.code}: ${e.message}`);
    else log(e.message);
    process.exitCode = 1;
  } finally {
    child?.kill();
  }
}
