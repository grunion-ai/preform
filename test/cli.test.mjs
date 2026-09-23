import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, usage } from '../lib/cli.mjs';

test('parse splits command, positionals and flags', () => {
  const p = parse(['scene', 'new', '--printer', 'FORM-4-0', '--material', 'FLGPBK05', '--json']);
  assert.equal(p.cmd, 'scene new');
  assert.deepEqual(p.args, []);
  assert.equal(p.flags.printer, 'FORM-4-0');
  assert.equal(p.flags.json, true);
});

test('parse keeps positionals after the command', () => {
  const p = parse(['import', 's1', 'part.stl', '--name', 'Part']);
  assert.equal(p.cmd, 'import');
  assert.deepEqual(p.args, ['s1', 'part.stl']);
  assert.equal(p.flags.name, 'Part');
});

test('parse takes "api" with method, path and inline JSON', () => {
  const p = parse(['api', 'POST', '/scene/', '{"machine_type":"FORM-4-0"}']);
  assert.equal(p.cmd, 'api');
  assert.deepEqual(p.args, ['POST', '/scene/', '{"machine_type":"FORM-4-0"}']);
});

test('parse reads --key=value and repeated flags', () => {
  const p = parse(['orient', 's1', '--models=m1', '--models=m2']);
  assert.deepEqual(p.flags.models, ['m1', 'm2']);
});

test('usage lists every command', () => {
  const u = usage();
  for (const c of ['prep', 'scene new', 'import', 'orient', 'support', 'layout', 'validate', 'estimate', 'save', 'print', 'devices', 'materials', 'api', 'serve']) assert.match(u, new RegExp(`\\b${c}\\b`));
});
