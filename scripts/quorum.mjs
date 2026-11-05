#!/usr/bin/env node
// quorum: one group PR's quorum verdict by upkeep's rule, a carried quorum included (decision af1c9258, clerk#235). Read-only.
//   node scripts/quorum.mjs <repo#n> --repo <programme> [--json]
//   -> {pr, verdict, reason, carried, quorumSha, headSha, judgedHead}: verdict is 'ok' or why not, before budget and pause;
//      judgedHead: the latest quorum names the head, so a reviewer has already judged this commit (a rejection included)
//   exit 0 read (whatever the verdict), 1 a read failed, 2 usage
import { parseArgs } from 'node:util';
import { loadSettings, issueRef } from '../lib/adapters/settings.mjs';
import { get } from '../lib/adapters/github.mjs';
import { readQuorum } from '../lib/adapters/upkeep.mjs';

let a;
try { a = parseArgs({ allowPositionals: true, options: { repo: { type: 'string', default: process.cwd() }, json: { type: 'boolean' } } }); }
catch (e) { console.error(`clerk quorum: ${e.message}`); process.exit(2); }
const ref = a.positionals[0];
if (!/^[\w.-]+#\d+$/.test(ref ?? '')) { console.error('usage: clerk quorum <repo#n> --repo <programme> [--json]'); process.exit(2); }

try {
  const O = loadSettings(a.values.repo).githubOwner, { repo, number } = issueRef(ref, O);
  const p = get(`repos/${O}/${repo}/pulls/${number}`);
  const out = { pr: ref, ...readQuorum(O, repo, p.base.repo.default_branch, number, p.head.sha) };
  console.log(a.values.json ? JSON.stringify(out, null, 2) : `${ref}: ${out.verdict === 'ok' ? `ok: ${out.reason}` : out.verdict}${out.carried === null ? ' (compare unreadable, not carried)' : ''}${out.judgedHead ? '; this commit is already judged' : ''}`);
} catch (e) {
  console.error(`clerk quorum: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
  process.exit(1);
}
