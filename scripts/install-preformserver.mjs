#!/usr/bin/env node
// Download, verify and install the newest PreFormServer for this machine.
// Usage: node scripts/install-preformserver.mjs [--dest /Applications] [--version 3.63.0] [--force]
import { execFileSync, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdtempSync, rmSync, renameSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export const PAGE = 'https://formlabs.com/support/Formlabs-API-downloads-and-release-notes';
const RELEASE = /https:\/\/downloads\.formlabs\.com\/PreFormServer\/Release\/(\d+\.\d+\.\d+)\/PreForm_Server_(mac-arm64|mac|win)_\1_[A-Za-z0-9._-]+\.zip/g;

export function parseReleases(html) {
  const out = {};
  for (const m of html.matchAll(RELEASE)) (out[m[1]] ??= {})[m[2]] = m[0];
  return out;
}

const byVersion = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; };

export function pickRelease(releases, platform = process.platform, arch = process.arch, wanted) {
  const kinds = platform === 'darwin' ? (arch === 'arm64' ? ['mac-arm64', 'mac'] : ['mac', 'mac-arm64']) : ['win'];
  for (const version of Object.keys(releases).sort(byVersion)) {
    if (wanted && version !== wanted) continue;
    for (const kind of kinds) if (releases[version][kind]) return { version, kind, url: releases[version][kind] };
  }
  throw new Error(`no PreFormServer build for ${platform}/${arch}${wanted ? ` at ${wanted}` : ''}`);
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (k) => { const i = args.indexOf(k); return i === -1 ? undefined : args[i + 1]; };
  const dest = flag('--dest') ?? (process.platform === 'darwin' ? '/Applications' : path.join(process.env.ProgramFiles ?? 'C:\\Program Files'));
  const appName = process.platform === 'darwin' ? 'PreFormServer.app' : 'PreFormServer';
  const target = path.join(dest, appName);
  if (existsSync(target) && !args.includes('--force')) { console.log(`already installed: ${target} (use --force to replace)`); return; }

  const html = await (await fetch(PAGE)).text();
  const pick = pickRelease(parseReleases(html), process.platform, process.arch, flag('--version'));
  console.log(`downloading PreFormServer ${pick.version} (${pick.kind})\n${pick.url}`);
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'preformserver-'));
  const zip = path.join(tmp, 'PreFormServer.zip');
  const res = await fetch(pick.url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));

  console.log('unzipping');
  if (process.platform === 'darwin') execFileSync('ditto', ['-x', '-k', zip, tmp]);
  else execFileSync('tar', ['-xf', zip, '-C', tmp]);
  // The zip nests the app one level down: PreFormServer/PreFormServer.app plus COPYRIGHT.txt.
  const unpacked = [path.join(tmp, appName), path.join(tmp, 'PreFormServer', appName)].find(existsSync);
  if (!unpacked) throw new Error(`zip did not contain ${appName}; contents: ${execFileSync('ls', ['-R', tmp]).toString().trim()}`);

  if (process.platform === 'darwin') {
    console.log('verifying code signature');
    execFileSync('codesign', ['--verify', '--deep', '--strict', unpacked], { stdio: 'inherit' });
    // codesign -dvv prints to stderr; pin the Formlabs team id.
    const who = execFileSync('codesign', ['-dvv', unpacked], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }) + '';
    const detail = spawnSync('codesign', ['-dvv', unpacked], { encoding: 'utf8' });
    if (!/TeamIdentifier=KVPE3R79SR/.test(detail.stderr + detail.stdout + who)) throw new Error(`unexpected signer:\n${detail.stderr}`);
    execFileSync('xattr', ['-dr', 'com.apple.quarantine', unpacked]);
  }
  if (existsSync(target)) rmSync(target, { recursive: true });
  renameSync(unpacked, target);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`installed ${target}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch((e) => { console.error(e.message); process.exit(1); });
