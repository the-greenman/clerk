import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { workflowFrom, labelDescription } from '../lib/practice/workflow.mjs';
import { planLabels } from '../lib/practice/labels.mjs';

const W = workflowFrom(JSON.parse(readFileSync(new URL('./workflow.fixture.json', import.meta.url), 'utf8')));
const live = (except = []) => W.labels.filter((l) => !except.includes(l.name)).map((l) => ({ name: l.name, description: labelDescription(l.description) }));

test('planLabels: a repo carrying every bound label with its meaning is in line', () => {
  assert.deepEqual(planLabels(W, live(), {}, ['wg:x']), { missing: [], stale: [], retired: [], unknown: [] });
});

test('planLabels: missing, stale, retired (with successor and open count) and unknown labels are each reported', () => {
  const have = [...live(['status: in review']), { name: 'needs-input', description: 'old words' }, { name: 'in-progress', description: '' },
    { name: 'gate:pool', description: '' }, { name: 'wg:x', description: '' }, { name: 'enhancement', description: '' }, { name: 'shiny', description: '' }]
    .filter((l, i, xs) => xs.findIndex((y) => y.name === l.name) === i || l.description === 'old words');
  const p = planLabels(W, have.filter((l) => !(l.name === 'needs-input' && l.description !== 'old words')), { 'in-progress': 2, 'gate:pool': 0 }, ['wg:x']);
  assert.deepEqual(p.missing.map((l) => l.name), ['status: in review']);
  assert.deepEqual(p.stale.map((l) => [l.name, l.have]), [['needs-input', 'old words']]);
  assert.deepEqual(p.retired, [{ name: 'gate:pool', successor: null, open: 0 }, { name: 'in-progress', successor: 'status: in progress', open: 2 }]);
  assert.deepEqual(p.unknown, ['shiny']);
});

// The labels whose text is not also a definition key: executable code takes them from the bindings, never a literal.
// Retired labels may appear nowhere the clerk tells an agent or a script what to do.
const read = (dir, ext) => readdirSync(new URL(dir, import.meta.url), { recursive: true }).filter((f) => f.endsWith(ext)).map((f) => [`${dir}${f}`, readFileSync(new URL(`${dir}${f}`, import.meta.url), 'utf8')]);
const code = [...read('../lib/', '.mjs'), ...read('../scripts/', '.mjs'), ...read('../bin/', '.mjs')].filter(([f]) => !f.endsWith('.test.mjs'));
const briefs = [...read('../routines/', '.md'), ...read('../.claude/commands/', '.md')];

test('lint: no status or gate label literal in executable code (comments aside)', () => {
  const keys = new Set([...JSON.parse(readFileSync(new URL('./workflow.fixture.json', import.meta.url), 'utf8')).lifecycles[0].states.map((s) => s.key)]);
  const literals = W.labels.map((l) => l.name).filter((n) => /[: ]/.test(n) && !/^priority: |^size: /.test(n) && !keys.has(n));
  const hits = code.flatMap(([f, src]) => {
    const live = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    return literals.filter((l) => new RegExp(`['"\`]${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`).test(live)).map((l) => `${f}: ${l}`);
  });
  assert.deepEqual(hits, []);
});

test('lint: no retired label in code (as a literal) or in briefs (as a `label`)', () => {
  const esc = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const inCode = code.flatMap(([f, src]) => { const live = src.replace(/\/\/.*$/gm, '');
    return W.retired.map((r) => r.name).filter((n) => new RegExp(`['"]${esc(n)}['"]`).test(live)).map((n) => `${f}: ${n}`); });
  const inBriefs = briefs.flatMap(([f, src]) => W.retired.map((r) => r.name).filter((n) => src.includes(`\`${n}\``)).map((n) => `${f}: ${n}`));
  assert.deepEqual([...inCode, ...inBriefs], []);
});
