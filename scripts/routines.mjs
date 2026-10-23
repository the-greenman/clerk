#!/usr/bin/env node
// routines: drift between cloud triggers (a dump), standing-job records and briefs in this repo.
//   node scripts/routines.mjs --check <dump.json> [--repo <programme>] [--json]    exit 1 on any drift but stale-check-in
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { srsCli, srs } from '../lib/adapters/cli.mjs';
import { checkRoutines } from '../lib/practice/routines.mjs';
import { loadSettings } from '../lib/adapters/settings.mjs';
import { repoRoot } from './lib/repo-arg.mjs';

const argv = process.argv.slice(2);
const dump = argv[argv.indexOf('--check') + 1];
if (!argv.includes('--check') || !dump) { console.error('usage: clerk routines --check <dump.json> [--repo <programme>] [--json]'); process.exit(2); }
const raw = JSON.parse(readFileSync(dump, 'utf8'));
// The RemoteTrigger API keeps the prompt under derived_state; flat dumps carry it at the top.
const triggers = (Array.isArray(raw) ? raw : raw.triggers ?? raw.data ?? []).map((t) => ({ ...t, prompt: t.prompt ?? t.derived_state?.prompt,
  sources: (t.sources ?? t.job_config?.ccr?.session_context?.sources)?.map((x) => String(x.git_repository?.url ?? x.url ?? x).split('/').pop()) }));
const repo = repoRoot();
const cli = srsCli(repo);
const jobs = srs(cli, repo, ['record', 'list', '--type', 'com.mudemocracy.stewardship/standing-job']).records
  .map(({ instanceId, record: { fieldValues: f } }) => ({ id: instanceId, title: f.title, routine_id: f.routine_id, brief: f.brief_path }));
const clerk = fileURLToPath(new URL('..', import.meta.url));
const briefs = new Set(execFileSync('git', ['ls-files', 'routines/*.md'], { cwd: clerk, encoding: 'utf8' }).split('\n').filter(Boolean));

// The clerk's commands, as their script text (flags are checked against it): the TOOLS table in bin/clerk.mjs, plus what bin handles itself.
const bin = readFileSync(`${clerk}bin/clerk.mjs`, 'utf8'), commands = { desk: bin, session: bin, comment: bin, help: bin };
for (const [, cmd, file] of bin.matchAll(/^ {2}'?([\w-]+)'?: \['([\w.-]+)'/gm)) if (existsSync(`${clerk}scripts/${file}`)) commands[cmd] = readFileSync(`${clerk}scripts/${file}`, 'utf8');
const drift = checkRoutines({ triggers, jobs, briefs, repos: loadSettings(repo, cli).repos, commands });
if (argv.includes('--json')) console.log(JSON.stringify(drift, null, 2));
else {
  for (const kind of [...new Set(drift.map((d) => d.kind))]) {
    console.log(kind);
    for (const d of drift.filter((x) => x.kind === kind)) console.log(`  ${d.subject}  ${d.detail}`);
  }
  console.log(`${drift.length} drift (${drift.filter((d) => d.kind !== 'stale-check-in').length} blocking)`);
}
process.exit(drift.some((d) => d.kind !== 'stale-check-in') ? 1 : 0);
