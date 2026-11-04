// One pass that takes writes accepted by a registry server to each repository's main line, and keeps read-only copies current
// (clerk#273, SP-154, remedy d0a36858). A proof of concept for a generic tool: its only inputs are the registry file and these
// arguments, it uses only git and srs, and it knows nothing of the programme. The contract is docs/registry-save.md.
// forge is the code host, passed in: findOpen({remote, head}) -> pr|null; create({remote, base, head, title, body, label}) -> pr;
// merge({remote, base, pr}), which arms auto-merge, or merges directly where base requires nothing. A pr is {url, number}.
import { execFile } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const SERVED_BRANCH = 'served';
const QUIET_MS = 120_000, STALE_LOCK_MS = 600_000;

const execRun = (cmd, args, { cwd } = {}) => new Promise((ok, no) => {
  execFile(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (e, out, err) => (e ? no(new Error((err || e.message).trim())) : ok(out)));
});
const firstLine = (e) => String(e?.message ?? e).split('\n')[0];

// Paths with uncommitted changes, from `git status --porcelain -z --untracked-files=all`: "XY path\0". A staged rename or copy
// (a commit that failed after add) adds its old path as one more field.
export function changedPaths(porcelain) {
  const fields = porcelain.split('\0').filter(Boolean), paths = [];
  for (let i = 0; i < fields.length; i++) {
    paths.push(fields[i].slice(3));
    if (/[RC]/.test(fields[i].slice(0, 2))) i++;
  }
  return paths;
}

// A deleted path has no time of its own; the directory it left does.
function changedAt(path) {
  for (const p of [path, dirname(path)]) { try { return lstatSync(p).mtimeMs; } catch { /* look further */ } }
  return 0;
}

export async function saveEntry(entry, { forge, label, srs = 'srs', host = hostname(), quietMs = QUIET_MS, now = Date.now, run = execRun }) {
  const path = entry.locator?.path, readOnly = Boolean(entry.readOnly);
  const res = { id: entry.id, path: path ?? null, readOnly, uncommitted: 0, pending: 0, behind: 0, pr: null, held: null };
  if (entry.locator?.mode !== 'local') return { ...res, held: 'not a local locator' };

  const git = (...args) => run('git', args, { cwd: path });
  let gitDir;
  try { gitDir = (await git('rev-parse', '--git-dir')).trim(); } catch { return { ...res, held: 'not a git repository' }; }
  const lockDir = resolve(path, gitDir, 'registry-save.lock');
  // mkdir is the atomic step, so of two passes taking over a stale lock only one gets it.
  const takeLock = () => { try { mkdirSync(lockDir); return true; } catch { return false; } };
  if (!takeLock()) {
    let age = 0;
    try { age = now() - statSync(lockDir).mtimeMs; } catch { /* just released */ age = Infinity; }
    if (age >= STALE_LOCK_MS) rmSync(lockDir, { recursive: true, force: true });
    if (age < STALE_LOCK_MS || !takeLock()) return { ...res, held: 'another save pass is running' };
  }
  let base = null;
  try {
    base = (await git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD')).trim().replace(/^origin\//, '');
    if (readOnly) await git('pull', '--ff-only', '-q');
    else await saveWritable({ res, git, run, path, base, forge, label, srs, host, quietMs, now });
  } catch (e) {
    res.held = firstLine(e);
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
  if (base) {
    const count = async (range) => Number((await git('rev-list', '--count', range).catch(() => '0')).trim());
    res.pending = await count(`origin/${base}..HEAD`);
    res.behind = await count(`HEAD..origin/${base}`);
    res.uncommitted = changedPaths(await git('status', '--porcelain', '-z', '--untracked-files=all').catch(() => '')).length;
  }
  return res;
}

async function saveWritable({ res, git, run, path, base, forge, label, srs, host, quietMs, now }) {
  // Refused outright: on any other branch this would commit onto somebody's work.
  const branch = (await git('rev-parse', '--abbrev-ref', 'HEAD')).trim();
  if (branch !== SERVED_BRANCH) { res.held = `on branch ${branch}, not ${SERVED_BRANCH}`; return; }

  const paths = changedPaths(await git('status', '--porcelain', '-z', '--untracked-files=all'));
  if (paths.length) {
    // ponytail: a quiet window stands in for a per-repository lock file the server would share (SP-144). Until then a slower
    // multi-file write can be committed in two parts, and a write landing between validate and add goes in unvalidated, for the
    // repository's own checks to catch.
    const top = (await git('rev-parse', '--show-toplevel')).trim();
    const newest = Math.max(0, ...paths.map((p) => changedAt(join(top, p))));
    if (now() - newest < quietMs) { res.held = 'writes still arriving'; return; }

    const report = JSON.parse(await run(srs, ['repo', 'validate', '--repo', path], { cwd: path }));
    const errors = report.ok === false ? 1 : report.payload?.summary?.errors ?? 0;
    if (errors) { res.held = `validation found errors: ${report.ok === false ? firstLine((report.diagnostics ?? [])[0]) : errors}`; return; }

    await git('add', '-A');
    await git('commit', '-q', '-m', `save: ${paths.length} file${paths.length === 1 ? '' : 's'} written through the server (${host})`);
  }

  await git('fetch', '-q', '--prune', 'origin');
  try { await git('rebase', '-q', `origin/${base}`); } catch (e) {
    await git('rebase', '--abort').catch(() => {});
    res.held = `rebase onto origin/${base} failed: ${firstLine(e)}`;
    return;
  }
  if (!Number((await git('rev-list', '--count', `origin/${base}..HEAD`)).trim())) return;

  // This branch belongs to this machine and is rebuilt by each pass, so the push replaces it, unless it moved since the fetch.
  // Rebasing on each pass also keeps the pull request up to date under strict branch protection.
  const head = `writes/${host.replace(/[^\w.-]/g, '-')}`;
  const seen = (await git('rev-parse', '-q', '--verify', `refs/remotes/origin/${head}`).catch(() => '')).trim(); // empty: must not exist yet
  await git('push', '-q', `--force-with-lease=refs/heads/${head}:${seen}`, 'origin', `HEAD:refs/heads/${head}`);
  const remote = (await git('remote', 'get-url', 'origin')).trim();
  const pr = await forge.findOpen({ remote, head }) ?? await forge.create({ remote, base, head, label, title: `save: writes through the server (${host})`,
    body: 'Writes accepted by the registry server, taken to the main line by the save pass (docs/registry-save.md in the clerk).' });
  res.pr = pr.url;
  await forge.merge({ remote, base, pr });
}

export function savePass({ registry, ...opts }) {
  const { entries = [] } = JSON.parse(readFileSync(registry, 'utf8'));
  return Promise.all(entries.filter((e) => e.kind === 'repository').map((e) => saveEntry(e, opts)));
}
