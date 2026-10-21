#!/usr/bin/env node
// doctor: the clerk's self-test where it runs (laptop or cloud session). Read-only probes of everything a routine needs.
//   node scripts/doctor.mjs [--repo <programme>] [--json] [--post]
//   --post: record the result on the settings digestIssue as a `clerk-doctor` marker comment (ok too: silence means it did not run)
//   exit 0 all pass, 1 a check failed
import { existsSync } from 'node:fs';
import { HAS_GH, srsCli } from '../lib/adapters/cli.mjs';
import { get, comment } from '../lib/adapters/github.mjs';
import { loadSettings, issueRef } from '../lib/adapters/settings.mjs';
import { loadGroups } from '../lib/adapters/groups.mjs';
import { groupStates } from '../lib/adapters/upkeep.mjs';
import { verdict, healthComment } from '../lib/practice/doctor.mjs';
import { repoRoot } from './lib/repo-arg.mjs';

const argv = process.argv.slice(2), repo = repoRoot();
// ponytail: cloud = Claude Code on the web's env var or its CA bundle; add a marker if either changes.
const env = process.env.CLAUDE_CODE_REMOTE === 'true' || existsSync('/root/.ccr') ? 'cloud' : 'local';
const checks = [];
const probe = (name, f) => {
  try { const d = f(); checks.push({ name, ok: true, detail: d ?? '' }); return true; }
  catch (e) { checks.push({ name, ok: false, detail: String(e.message).split('\n')[0] }); return false; }
};

probe('GitHub transport', () => `${HAS_GH ? 'gh' : 'curl fallback'}; token ${process.env.GH_TOKEN || process.env.GITHUB_TOKEN ? 'set' : 'not set'}`);
let st, cli;
probe('srs CLI', () => (cli = srsCli(repo)));
probe('settings', () => { st = loadSettings(repo, cli); return `${st.repos.length} repos`; });
if (st) {
  const O = st.githubOwner;
  // the pulls read is what group-state needs, and a private repo not attached to the session 404s here
  for (const r of st.repos) probe(`repo ${r}`, () => { get(`repos/${O}/${r}/pulls?state=all&per_page=1`); });
  for (const [k, ref] of [['report issue', st.reportIssue], ['digest issue', st.digestIssue]]) probe(`${k} ${ref}`, () => { get(`repos/${issueRef(ref, O).path}`); });
  let groups = [];
  if (probe('groups', () => `${(groups = loadGroups(repo, cli)).length} chartered`) && groups.length) {
    const states = groupStates(st, groups);
    for (const g of groups) probe(`group-state ${g.label}`, () => {
      const s = states[g.label];
      if (s.why) throw new Error(s.why);
      if (/unreadable/.test(s.pause)) throw new Error(`pause ${s.pause}`);
      return `${s.pause}; ${s.merged} merged + ${s.open} open of ${s.budget}`;
    });
  }
}
if (process.env.SRS_ACTOR) probe('SRS_ACTOR', () => {
  let a; try { a = JSON.parse(process.env.SRS_ACTOR); } catch { /* below */ }
  if (!a?.kind || !a?.id) throw new Error(`not a JSON actor {"kind","id"}: ${process.env.SRS_ACTOR}`);
  return a.id;
});
if (env === 'cloud') probe('/tmp/clerk', () => { if (!existsSync('/tmp/clerk/bin/clerk.mjs')) throw new Error('missing: ln -sfn /home/user/clerk /tmp/clerk'); });

const status = verdict(checks), at = new Date().toISOString();
if (argv.includes('--json')) console.log(JSON.stringify({ status, env, at, checks }, null, 2));
else for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? `: ${c.detail}` : ''}`);
if (argv.includes('--post')) {
  if (!st) { console.error('clerk doctor: no settings, nothing to post to'); process.exit(1); }
  const D = issueRef(st.digestIssue, st.githubOwner);
  comment(`${st.githubOwner}/${D.repo}`, D.number, healthComment({ status, env, at }, checks));
}
process.exit(status === 'ok' ? 0 : 1);
