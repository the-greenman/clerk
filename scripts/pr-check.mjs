#!/usr/bin/env node
// pr-check: a PR's decisions against the standard (clerk#77, docs/pr-decisions.md). Exit 1 on any error, 0 otherwise.
//   node scripts/pr-check.mjs <repo#n> [--repo <programme>] [--merging] [--json]   (the GitHub owner comes from the settings record)
import { get, list } from '../lib/adapters/github.mjs';
import { repoRoot } from './lib/repo-arg.mjs';
import { srsCli } from '../lib/adapters/cli.mjs';
import { loadSettings } from '../lib/adapters/settings.mjs';
import { loadWorkflow } from '../lib/adapters/workflow.mjs';
import { parseDecisions, checkDecisions, answersFrom } from '../lib/practice/pr-decisions.mjs';

const argv = process.argv.slice(2);
try {
  const ref = argv.find((a) => /^[\w.-]+#\d+$/.test(a));
  if (!ref) throw new Error('give <repo#n>');
  const [repo, n] = ref.split('#'), programme = repoRoot(), cli = srsCli(programme), owner = loadSettings(programme, cli).githubOwner;
  const { gates } = loadWorkflow(programme, cli);
  const pr = get(`repos/${owner}/${repo}/pulls/${n}`);
  const comments = list(`repos/${owner}/${repo}/issues/${n}/comments?per_page=100`).map((c) => c.body ?? '');
  const files = list(`repos/${owner}/${repo}/pulls/${n}/files?per_page=100`);
  const recordsInDiff = files.filter((f) => /records\/.*decision-[0-9a-f]{8}\.json$/.test(f.filename)).length;
  const d = parseDecisions(pr.body ?? '');
  const findings = checkDecisions(d, { body: pr.body ?? '', merging: argv.includes('--merging'), answered: answersFrom(comments), recordsInDiff, labels: pr.labels ?? [], gates, draft: Boolean(pr.draft) });
  if (argv.includes('--json')) console.log(JSON.stringify({ ref, by: d.by, answers: d.answers, made: d.made, asks: d.asks, findings }, null, 2));
  else for (const f of findings) console.log(`${f.level.padEnd(5)} ${f.text}`);
  process.exit(findings.some((f) => f.level === 'error') ? 1 : 0);
} catch (e) { console.error('clerk pr-check: ' + e.message); process.exit(2); }
