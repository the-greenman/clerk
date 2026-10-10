// lib/practice is the practice srs-web will import: no Node built-ins, no process, no I/O.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../lib/practice/', import.meta.url);
const BUILTINS = /\b(?:from|import)\s*\(?\s*['"](?:node:[^'"]+|child_process|fs|fs\/promises|os|path|crypto|url|util|readline|http|https|net|stream|zlib)['"]|\brequire\s*\(/;

for (const f of readdirSync(dir).filter((n) => n.endsWith('.mjs'))) {
  test(`lib/practice/${f} is pure`, () => {
    const src = readFileSync(new URL(f, dir), 'utf8').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(src, BUILTINS, 'imports a Node built-in');
    assert.doesNotMatch(src, /\bprocess\./, 'uses process.');
  });
}
