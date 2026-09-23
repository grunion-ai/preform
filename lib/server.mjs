// Locate and start PreFormServer, Formlabs' headless PreForm.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const candidates = () => [
  '/Applications/PreFormServer.app/Contents/MacOS/PreFormServer',
  path.join(os.homedir(), 'Applications/PreFormServer.app/Contents/MacOS/PreFormServer'),
  path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PreFormServer', 'PreFormServer.exe'),
  path.join(process.cwd(), 'PreFormServer.app/Contents/MacOS/PreFormServer'),
  path.join(process.cwd(), 'PreFormServer', 'PreFormServer.exe'),
];

export function findServer(env = process.env, exists = existsSync) {
  if (env.PREFORM_SERVER) return env.PREFORM_SERVER;
  return candidates().find(exists) ?? null;
}

// Resolves with the child once it prints READY FOR INPUT.
export function startServer(bin, port, { args = ['--port', String(port)], timeoutMs = 120_000, log } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`PreFormServer did not report READY FOR INPUT within ${timeoutMs} ms`)); }, timeoutMs);
    child.stdout.on('data', (d) => {
      buf += d;
      log?.(String(d).trimEnd());
      if (buf.includes('READY FOR INPUT')) { clearTimeout(timer); resolve(child); }
    });
    child.stderr.on('data', (d) => log?.(String(d).trimEnd()));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`PreFormServer exited with code ${code} before it was ready`)); });
  });
}

export async function reachable(baseUrl) {
  try { return (await fetch(baseUrl + '/')).ok; } catch { return false; }
}
