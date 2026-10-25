#!/usr/bin/env node
// flow: the dots a work item needs before work can flow (clerk#126), and which of them an agent can join by rule.
//   clerk flow --chain <repo#n> [--repo <programme>] [--json]   one item: each dot, its gap and its fix
//   clerk flow --open <repo> [--repo <programme>] [--json]      every open issue in a repository, gaps first
// Read-only: it says which fixes are mechanical (auto, with the rule); it never writes them.
import { parseArgs } from 'node:util';
import { repoRoot } from './lib/repo-arg.mjs';
import { careContext, careFor } from './lib/care.mjs';
import { srsCli } from '../lib/adapters/cli.mjs';
import { loadSettings } from '../lib/adapters/settings.mjs';
import { loadWorkflow } from '../lib/adapters/workflow.mjs';
import { list } from '../lib/adapters/github.mjs';
import { dotsFor, flowState } from '../lib/practice/flow.mjs';

let a;
try { a = parseArgs({ options: { chain: { type: 'string' }, open: { type: 'string' }, repo: { type: 'string' }, json: { type: 'boolean' } } }); }
catch (e) { console.error(`clerk flow: ${e.message}`); process.exit(2); }
const m = /^([\w.-]+)#(\d+)$/.exec(a.values.chain ?? '');
if (!m && !a.values.open) { console.error('usage: clerk flow --chain <repo#n> | --open <repo> [--repo <programme>] [--json]'); process.exit(2); }

let repo, cli, st, wf, ctx;
try { repo = repoRoot(); cli = srsCli(repo); st = loadSettings(repo, cli); wf = loadWorkflow(repo, cli); ctx = careContext(repo, cli, st); }
catch (e) { console.error(`clerk flow: ${e.message}`); process.exit(1); }
// a read that fails is unknown, never "no blockers"
const blockedBy = (r, n, listed) => { if (listed?.issue_dependencies_summary?.total_blocked_by === 0) return []; try { return list(`repos/${st.githubOwner}/${r}/issues/${n}/dependencies/blocked_by?per_page=100`).map((b) => ({ ref: `${b.repository_url.split('/').pop()}#${b.number}`, open: b.state === 'open' })); }
  catch (e) { return { unknown: String(e.message).split('\n')[0].slice(0, 120) }; } };

function read(r, n, listed = null) {
  const { issue, facts, parents, parentsUnknown, result } = careFor(repo, cli, st, r, n, ctx, listed);
  const item = { ref: `${r}#${n}`, body: issue.body, labels: issue.labels, subIssues: issue.sub_issues_summary?.total ?? 0, assigned: Boolean(issue.assignees?.length), parents, parentsUnknown, blockedBy: blockedBy(r, n, listed) };
  const dots = dotsFor({ item, facts, epics: ctx.epics, groups: ctx.groups, wf, care: result });
  return { ref: item.ref, title: issue.title, ...flowState(dots), dots };
}
const line = (x) => `${x.ref}: ${x.title}\n  ${x.error ? `unreadable: ${x.error}` : x.flows ? 'flows' : `${x.gaps} gap${x.gaps > 1 ? 's' : ''}${x.auto ? `, ${x.auto} an agent can join` : ''}`}`;
const detail = (x) => x.dots.map((d) => (d.ok ? `  ✓ ${d.dot}${d.note ? `: ${d.note}` : ''}` : `  ✗ ${d.dot}: ${d.gap} → ${d.fix}${d.auto ? ` [auto: ${d.rule}]` : ''}`)).join('\n');

try {
  if (m) {
    const x = read(m[1], Number(m[2]));
    console.log(a.values.json ? JSON.stringify(x, null, 2) : `${line(x)}\n${detail(x)}`);
  } else {
    const r = a.values.open;
    // one unreadable issue is reported, never the end of the sweep
    const items = list(`repos/${st.githubOwner}/${r}/issues?state=open&per_page=100`).filter((i) => !i.pull_request).map((i) => {
      try { return read(r, i.number, i); } catch (e) { return { ref: `${r}#${i.number}`, title: i.title, error: String(e.message).split('\n')[0], flows: false, gaps: 0, auto: 0, dots: [] }; }
    }).sort((p, q) => q.gaps - p.gaps || p.ref.localeCompare(q.ref, undefined, { numeric: true }));
    if (a.values.json) console.log(JSON.stringify(items, null, 2)); // no exit after it: a large write to a pipe must drain
    else {
      const by = {}; // issues missing each dot (an issue counts once per dot)
      for (const x of items) for (const d of new Set(x.dots.filter((y) => !y.ok).map((y) => y.dot))) by[d] = (by[d] ?? 0) + 1;
      console.log(`${r}: ${items.length} open issues, ${items.filter((x) => x.flows).length} flow, ${items.reduce((s, x) => s + x.auto, 0)} gaps an agent can join`);
      console.log(`missing: ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing'}\n`);
      for (const x of items.filter((y) => !y.flows)) console.log(`${line(x)}\n${detail(x)}\n`);
    }
  }
} catch (e) { console.error(`clerk flow: ${e.message}`); process.exit(1); }
