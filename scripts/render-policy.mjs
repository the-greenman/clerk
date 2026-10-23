#!/usr/bin/env node
// Render a programme's Confidence and care policy: the records in the container its settings name (care_policy_container)
// are the source of truth; docs/confidence-and-care.md in the programme repo is their `confidence-and-care` Composition,
// rendered, plus the clerk's signal catalogue (what each signal key a grade names means). Never edit the markdown.
//
//   node scripts/render-policy.mjs --repo <programme>           # check the policy, then write docs/confidence-and-care.md
//   node scripts/render-policy.mjs --repo <programme> --check   # exit 1 if the file differs from the records
//
// Uses SRS_CLI_PATH, else fetches the programme's pinned CLI.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { srsCli, srs } from '../lib/adapters/cli.mjs';
import { loadSettings } from '../lib/adapters/settings.mjs';
import { loadPolicy } from '../lib/adapters/care-policy.mjs';
import { SIGNALS } from '../lib/practice/care-policy.mjs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const REPO = resolve(arg('--repo') ?? '.');
const OUT = join(REPO, 'docs', 'confidence-and-care.md');
const fail = (msg) => { console.error(`render-policy: ${msg}`); process.exit(1); };

let text;
try {
  const cli = srsCli(REPO), settings = loadSettings(REPO, cli), policy = loadPolicy(REPO, cli, settings);
  const composition = srs(cli, REPO, ['composition', 'list']).compositions.find((c) => c.name === 'confidence-and-care');
  if (!composition) fail('no composition named confidence-and-care installed (the clerk methodology package, packages/programme)');
  const { rendered, diagnostics } = srs(cli, REPO, ['render', 'composition', '--view', composition.id, '--container', policy.containerId, '--view-format', 'markdown']);
  if (diagnostics.length) fail(`render diagnostics: ${JSON.stringify(diagnostics)}`);
  const container = srs(cli, REPO, ['container', 'get', policy.containerId]).container;
  const used = new Set(policy.grades.flatMap((g) => g.signals).concat(policy.rules.flatMap((r) => [...r.allOf, ...r.anyOf]).filter((c) => c.startsWith('signal:')).map((c) => c.slice(7))));
  text = [
    `<!-- Rendered from the ${settings.title ?? 'programme'} Confidence and care policy records (container ${policy.containerId}) by the clerk's scripts/render-policy.mjs. Do not edit: change the records. -->`,
    '',
    rendered.trimEnd().replace(/^# .*\n/, (h) => `${h}\n${container.description ?? ''}\n\nHow to read it: every work item is graded on each axis below (the highest grade whose signals hold; none if no grade's do). The rules are then tried in order, and the first that matches chooses the care mode the work is done in. Nothing here refuses work: low confidence means more care, not no action. \`clerk care --explain <repo#n>\` shows the grades, signals and rule for one item.\n`),
    '',
    '### Signal catalogue',
    '',
    'The signals a grade or rule may name. Their meaning is the clerk\'s code (lib/practice/care-policy.mjs); which grade or rule they feed is the records above. A record naming a signal not listed here stops the clerk.',
    '',
    ...Object.entries(SIGNALS).map(([k, s]) => `- \`${k}\`${used.has(k) ? '' : ' (not used by this policy)'}: ${s.means}`),
    '',
    '### Changing the policy',
    '',
    'The owner changes the records, with the pinned srs CLI, the MCP server or the editor; a change that alters how workers behave is recorded as a decision in a session. Agents never edit these records: they propose a change as a comment on the record (com.semanticops.comments, comments-on), with the evidence, such as which items a rule sent to which mode and how they went. Then run `node scripts/render-policy.mjs --repo <programme>` from the clerk and commit the records and this file together.',
    '',
  ].join('\n');
} catch (e) { fail(e.message); }

if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(OUT, 'utf8'); } catch {}
  if (current !== text) fail('docs/confidence-and-care.md differs from the policy records. Edit the records, then run node scripts/render-policy.mjs --repo <programme> from the clerk.');
  console.log('docs/confidence-and-care.md matches the policy records');
} else {
  mkdirSync(join(REPO, 'docs'), { recursive: true });
  writeFileSync(OUT, text);
  console.log(`wrote ${OUT}`);
}
