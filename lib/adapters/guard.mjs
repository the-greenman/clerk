// The authority guard's I/O: the programme at a base commit and at the working tree, as snapshots, then practice/guard.mjs.
// The base is read from a detached worktree and removed afterwards. The srs CLI answers every read (tool-first rule).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { srs } from './cli.mjs';
import { programmeSnapshot } from './snapshot.mjs';
import { loadSettings } from './settings.mjs';
import { loadGroups } from './groups.mjs';
import { authorityActs } from '../practice/guard.mjs';

const git = (repo, args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
// Relation types whose maker matters; `relation list` carries no createdBy, so those that are new are read one by one.
const ACTED = /\/(ratifies|sets-aside|receives|authorised-by)$/;

// after's relations that are not in before, with `by` read from the CLI for the types in ACTED.
function withActors(cli, repo, before, after) {
  const had = new Set(before.relations.map((l) => l.id));
  return { ...after, relations: after.relations.map((l) => (had.has(l.id) || !ACTED.test(l.type) ? l
    : { ...l, by: srs(cli, repo, ['relation', 'get', l.id]).relation.createdBy ?? null })) };
}

export function guard({ cli, repo, base, snapshot = programmeSnapshot }) {
  const dir = join(mkdtempSync(join(tmpdir(), 'guard-')), 'base');
  git(repo, ['worktree', 'add', '--detach', dir, base]);
  try {
    const before = snapshot(cli, dir), after = withActors(cli, repo, before, snapshot(cli, repo));
    // authority comes from the base: a change cannot grant itself the owner's actor or a seat in a group
    return authorityActs(before, after, loadSettings(dir, cli), loadGroups(dir, cli));
  } finally {
    try { git(repo, ['worktree', 'remove', '--force', dir]); } catch { rmSync(dir, { recursive: true, force: true }); }
  }
}
