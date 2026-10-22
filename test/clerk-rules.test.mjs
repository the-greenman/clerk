// The ten clerk rules (decision 926c059f), each checked against test/clerk-rules.allowlist.json, which only shrinks:
// a violation not on the list fails, and a listed entry that no longer violates fails too, so fixed exceptions leave
// the list. Rules 4 and 9 keep a per-file ceiling (lines, writes) that may fall but never rise. Rules a machine cannot
// check yet are `todo` with the reason; heuristic checks say so and name their gaps. clerk#141.
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
const imports = (src) => [...src.matchAll(/^\s*(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/gm), ...src.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm), ...src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);

test('the allowlist names only rules 1 to 10', () => {
  assert.deepEqual(Object.keys(ALLOW).filter((k) => k !== '_' && !/^(?:[1-9]|10)$/.test(k)), []);
});

function check(rule, found) {
  const allowed = new Set(ALLOW[rule] ?? []), now = new Set(found);
  const fresh = [...now].filter((x) => !allowed.has(x)).sort(), stale = [...allowed].filter((x) => !now.has(x)).sort();
  assert.deepEqual(fresh, [], `rule ${rule}: new violations. Fix them; list one in test/clerk-rules.allowlist.json only with a reason in the PR.\n${JSON.stringify(fresh)}`);
  assert.deepEqual(stale, [], `rule ${rule}: these allowlist entries no longer violate. Remove them from test/clerk-rules.allowlist.json.\n${JSON.stringify(stale)}`);
}
// counts: {file: n} with n > 0. The allowlist holds {file: ceiling}: a count above its ceiling fails, a listed file at 0 is stale.
function checkCeiling(rule, counts) {
  const allowed = ALLOW[rule] ?? {};
  const over = Object.entries(counts).filter(([f, n]) => n > (allowed[f] ?? 0)).map(([f, n]) => `${f}: ${n} (ceiling ${allowed[f] ?? 0})`).sort();
  const stale = Object.keys(allowed).filter((f) => !counts[f]).sort();
  assert.deepEqual(over, [], `rule ${rule}: above the allowlist ceiling. Fix it; raise a ceiling in test/clerk-rules.allowlist.json only with a reason in the PR.\n${JSON.stringify(over)}`);
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
    for (const s of imports(src)) if (!s.startsWith('./') || s.includes('..')) found.push(`${f}: ${s}`);
    if (/\bnew Date\(\s*\)|\bDate\.now\(/.test(src)) found.push(`${f}: clock`);
  }
  check('2', found); // Node built-ins and process are guarded by practice-purity.test.mjs
});

test('rule 3: adapters do I/O only and never import scripts (static imports only; spawning a script, as cli.mjs and session.mjs do, is not caught)', () => {
  check('3', code('lib/adapters').flatMap((f) => imports(read(f)).filter((s) => /(^|\/)scripts\//.test(s)).map((s) => `${f}: ${s}`)));
});

test('rule 4: scripts are thin entry points (heuristic: at most 150 lines; a listed script may shrink, never grow)', () => {
  checkCeiling('4', Object.fromEntries(code('scripts').map((f) => [f, read(f).split('\n').length]).filter(([, n]) => n > 150)));
});

// What each npm-test file imports from each lib/practice module: named imports, and `X.name` through `* as X`.
function namedInTests() {
  const used = new Map(); // 'lib/practice/x.mjs' -> Set(names)
  const add = (mod, n) => { if (!used.has(mod)) used.set(mod, new Set()); used.get(mod).add(n); };
  for (const t of [...files('test', (n) => n.endsWith('.test.mjs')), ...files('scripts', (n) => n.endsWith('.test.mjs'))]) {
    const src = read(t);
    for (const [, what, spec] of src.matchAll(/^\s*import\s+([^'";]+?)\s+from\s*['"]([^'"]*lib\/practice\/[^'"]+)['"]/gm)) {
      const mod = 'lib/practice/' + spec.split('lib/practice/').pop();
      const ns = /\*\s+as\s+([A-Za-z0-9_$]+)/.exec(what)?.[1];
      if (ns) for (const [, n] of src.matchAll(new RegExp(`\\b${ns.replace(/\$/g, '\\$')}\\.([A-Za-z0-9_$]+)`, 'g'))) add(mod, n);
      for (const n of /\{([^}]*)\}/.exec(what)?.[1].split(',') ?? []) if (n.trim()) add(mod, n.trim().split(/\s+as\s+/)[0]);
    }
    for (const [, what, spec] of src.matchAll(/\{([\w$,:\s]*)\}\s*=\s*await\s+import\(\s*['"]([^'"]*lib\/practice\/[^'"]+)['"]\s*\)/g))
      for (const n of what.split(',')) if (n.trim()) add('lib/practice/' + spec.split('lib/practice/').pop(), n.trim().split(/\s*:\s*/)[0]);
  }
  return used;
}

test('rule 5: every lib/practice export is named in a test that imports its module', () => {
  const used = namedInTests(), found = [];
  for (const f of code('lib/practice')) {
    const src = read(f);
    const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z0-9_$]+)/gm)].map((m) => m[1])
      .concat([...src.matchAll(/^export\s*\{([^}]*)\}/gm)].flatMap((m) => m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean)));
    for (const n of names) if (!used.get(f)?.has(n)) found.push(`${f}: ${n}`);
  }
  check('5', found);
});

test('rule 6: each comment marker has its parser in one file (heuristic: a regex literal naming it; markers built from a variable, such as clerk-doctor, and label formats are not checked)', () => {
  const markers = ['<!-- wg-quorum', '<!-- wg-report', '<!-- actor:', '<!-- srs:answer', '```srs-decisions', '<!-- srs:review-request'];
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

test('rule 9: every GitHub write goes through lib/adapters/github.mjs, so it is signed (code, briefs, commands and workflows; a write with a variable method is not caught; a listed file may lose writes, never gain them)', () => {
  const CODE = /['"]-X['"],\s*['"](?:POST|PATCH|PUT|DELETE)['"]|['"](?:issue|pr|label)['"],\s*['"](?:create|edit|comment|merge|close|reopen|update-branch|ready)['"]/g;
  const SHELL = /\bgh api (?:-X|--method) (?:POST|PATCH|PUT|DELETE)\b|\bgh (?:pr (?:create|merge|edit|comment|close|update-branch|ready)|issue (?:create|edit|comment|close|reopen)|label create)\b/g;
  const exempt = new Set(['lib/adapters/github.mjs', 'lib/adapters/cli.mjs']); // cli.mjs is the transport github.mjs calls
  const counts = {};
  for (const f of [...code('lib'), ...code('scripts'), ...code('bin')]) if (!exempt.has(f)) counts[f] = (noComments(read(f)).match(CODE)?.length ?? 0) + (read(f).match(SHELL)?.length ?? 0);
  for (const f of [...files('routines', (n) => n.endsWith('.md')), ...files('.claude/commands', (n) => n.endsWith('.md')), ...files('.github/workflows', (n) => n.endsWith('.yml'))]) counts[f] = read(f).match(SHELL)?.length ?? 0;
  checkCeiling('9', Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0)));
});

test.todo('rule 10: a contract test against the pinned srs CLI. test/integration/serve.int.mjs (CI tier 2) drives the pinned CLI through clerk serve, but nothing yet asserts the srs payload shapes the adapters parse.');
