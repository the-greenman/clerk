// The ten clerk rules (decision 926c059f), each checked against test/clerk-rules.allowlist.json, which only shrinks:
// a violation not on the list fails, and a listed entry that no longer violates fails too, so fixed exceptions leave
// the list. Rules a machine cannot check yet are `todo` with the reason. Heuristic checks say so. clerk#141.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ALLOW = JSON.parse(readFileSync(join(ROOT, 'test/clerk-rules.allowlist.json'), 'utf8'));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const files = (dir, keep) => (existsSync(join(ROOT, dir)) ? readdirSync(join(ROOT, dir)) : []).flatMap((n) => {
  const p = join(dir, n);
  return statSync(join(ROOT, p)).isDirectory() ? files(p, keep) : keep(n) ? [p] : [];
});
const code = (dir) => files(dir, (n) => n.endsWith('.mjs') && !n.endsWith('.test.mjs'));
const noComments = (src) => src.replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const imports = (src) => [...src.matchAll(/^\s*(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/gm), ...src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);

function check(rule, found) {
  const allowed = new Set(ALLOW[rule] ?? []), now = new Set(found);
  const fresh = [...now].filter((x) => !allowed.has(x)).sort(), stale = [...allowed].filter((x) => !now.has(x)).sort();
  assert.deepEqual(fresh, [], `rule ${rule}: new violations. Fix them; list one in test/clerk-rules.allowlist.json only with a reason in the PR.\n${JSON.stringify(fresh)}`);
  assert.deepEqual(stale, [], `rule ${rule}: these allowlist entries no longer violate. Remove them from test/clerk-rules.allowlist.json.\n${JSON.stringify(stale)}`);
}

test('rule 1: workflows, briefs and commands call `clerk <cmd>`, never a script or lib module directly (heuristic: `node …scripts/|lib/`)', () => {
  const docs = [...files('.github/workflows', (n) => n.endsWith('.yml')), ...files('routines', (n) => n.endsWith('.md')), ...files('.claude/commands', (n) => n.endsWith('.md'))];
  check('1', docs.filter((f) => /\bnode\s+\S*\b(?:scripts|lib)\/\S+\.mjs/.test(read(f))));
});

test('rule 2: lib/practice imports only lib/practice and reads no clock', () => {
  const found = [];
  for (const f of code('lib/practice')) {
    const src = noComments(read(f));
    for (const s of imports(src)) if (!s.startsWith('./')) found.push(`${f}: ${s}`);
    if (/\bnew Date\(\s*\)|\bDate\.now\(/.test(src)) found.push(`${f}: clock`);
  }
  check('2', found); // Node built-ins and process are guarded by practice-purity.test.mjs
});

test('rule 3: adapters do I/O only and never import scripts', () => {
  check('3', code('lib/adapters').flatMap((f) => imports(read(f)).filter((s) => /(^|\/)scripts\//.test(s)).map((s) => `${f}: ${s}`)));
});

test('rule 4: scripts are thin entry points (heuristic: at most 150 lines)', () => {
  check('4', code('scripts').filter((f) => read(f).split('\n').length > 150));
});

test('rule 5: every lib/practice export is named in a test', () => {
  const tests = [...files('test', (n) => n.endsWith('.mjs')), ...files('scripts', (n) => n.endsWith('.test.mjs'))].map(read).join('\n');
  const found = [];
  for (const f of code('lib/practice')) {
    const src = read(f);
    const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z0-9_$]+)/gm), ...[...src.matchAll(/^export\s*\{([^}]*)\}/gm)].flatMap((m) => m[1].split(',').map((x) => [null, x.trim().split(/\s+as\s+/).pop()]))].map((m) => m[1]).filter(Boolean);
    for (const n of names) if (!new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`).test(tests)) found.push(`${f}: ${n}`);
  }
  check('5', found);
});

test('rule 6: each comment marker or block format has its parser in one file (heuristic: a regex naming it)', () => {
  const markers = ['<!-- wg-quorum', '<!-- wg-report', '<!-- actor:', '<!-- srs:answer', '```srs-decisions', '<!-- clerk-doctor'];
  const src = [...code('lib'), ...code('scripts'), ...code('bin')].map((f) => [f, noComments(read(f)).split('\n')]);
  const found = [];
  for (const m of markers) {
    const parsers = src.filter(([, ls]) => ls.some((l) => l.includes(m) && /[=(,:[]\s*\/[^/*\s]|RegExp\(/.test(l))).map(([f]) => f);
    if (parsers.length > 1) found.push(`${m}: ${parsers.sort().join(', ')}`);
  }
  check('6', found);
});

test.todo('rule 7: one command contract (dry run by default, one --apply, --json on reads, exit 0/1/2). Not machine-checkable yet: needs each command to declare its kind (read or write) so a test can assert the contract per kind.');

test('rule 8: consumers use only `clerk <cmd>` or a package exports map (checked here: package.json declares `exports`; consumers live in other repos)', () => {
  check('8', JSON.parse(read('package.json')).exports ? [] : ['package.json: no exports map']);
});

test('rule 9: every GitHub write goes through lib/adapters/github.mjs, so it is signed (cli.mjs is the transport under it)', () => {
  const WRITE = /['"]-X['"],\s*['"](?:POST|PATCH|PUT|DELETE)['"]|gh api -X (?:POST|PATCH|PUT|DELETE)|['"](?:issue|pr)['"],\s*['"](?:create|edit|comment|merge|close|reopen)['"]/;
  const exempt = new Set(['lib/adapters/github.mjs', 'lib/adapters/cli.mjs']);
  check('9', [...code('lib'), ...code('scripts'), ...code('bin')].filter((f) => !exempt.has(f) && WRITE.test(noComments(read(f)))));
});

test.todo('rule 10: a contract test against the pinned srs CLI. test/integration/serve.int.mjs (CI tier 2) drives the pinned CLI through clerk serve, but nothing yet asserts the srs payload shapes the adapters parse.');
