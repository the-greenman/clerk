// The clerk's runtime imports nothing outside Node's standard library: srs-programme's workflows and the cloud routines run
// `node bin/clerk.mjs` from a bare checkout with no `npm install`. Dependencies (ajv) are for tests only. Ruling c04d8164.
import test from 'node:test';
import assert from 'node:assert/strict';
import { builtinModules } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILTIN = new Set(builtinModules);
const files = (dir) => readdirSync(join(ROOT, dir)).flatMap((n) => {
  const p = join(dir, n);
  return statSync(join(ROOT, p)).isDirectory() ? files(p) : n.endsWith('.mjs') && !n.endsWith('.test.mjs') ? [p] : [];
});

test('bin, lib and scripts import only Node built-ins and relative modules', () => {
  const bad = [];
  for (const f of ['bin', 'lib', 'scripts'].flatMap(files)) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    // static `import … from 'x'`, `export … from 'x'`, bare `import 'x'`, and literal dynamic `import('x')`
    const specs = [...src.matchAll(/^\s*(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/gm), ...src.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm), ...src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)];
    for (const [, spec] of specs) {
      if (spec.startsWith('.') || spec.startsWith('node:') || BUILTIN.has(spec)) continue;
      bad.push(`${f}: ${spec}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('package.json has no runtime dependencies', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), []);
});
