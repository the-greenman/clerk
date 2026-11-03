// scripts/wt prune on a scratch repo (clerk#148): a fresh worktree is kept, merged work is removed, unmerged work is kept.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WT = resolve(import.meta.dirname, '../scripts/wt');
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();

function scratch() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wt-')));
  const origin = join(root, 'origin.git'), dev = join(root, 'dev'), repo = join(dev, 'proj');
  execFileSync('mkdir', ['-p', dev]);
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, repo);
  writeFileSync(join(repo, 'a'), '1');
  git(repo, 'add', 'a'); git(repo, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'one'); git(repo, 'push', '-q', 'origin', 'HEAD:main');
  git(repo, 'remote', 'set-head', 'origin', 'main');
  const env = { ...process.env, DEV: dev, WT_ROOT: join(root, 'wt'), WT_REPOS: 'proj', PATH: '/nonexistent-gh:' + process.env.PATH };
  const wt = (...a) => execFileSync(WT, a, { encoding: 'utf8', env });
  return { repo, wt, root };
}

test('wt prune keeps a fresh worktree whose branch has no commits yet', () => {
  const { wt } = scratch();
  const dest = wt('new', 'proj', 'fresh').trim().split('\n').pop();
  assert.match(wt('prune', '-n'), new RegExp(`kept\\s+${dest}`));
  assert.ok(!/would remove/.test(wt('prune', '-n')));
});

test('wt prune removes a worktree whose commits are in origin/<default>, keeps one with unmerged commits', () => {
  const { repo, wt } = scratch();
  const merged = wt('new', 'proj', 'done').trim().split('\n').pop();
  const open = wt('new', 'proj', 'open').trim().split('\n').pop();
  for (const [d, f] of [[merged, 'm'], [open, 'o']]) {
    writeFileSync(join(d, f), f); git(d, 'add', f); git(d, '-c', 'commit.gpgsign=false', 'commit', '-qm', f);
  }
  git(merged, 'push', '-q', 'origin', 'HEAD:main');
  const out = wt('prune', '-n');
  assert.match(out, new RegExp(`would remove ${merged}`));
  assert.match(out, new RegExp(`kept\\s+${open}`));
});
