#!/usr/bin/env node
// save: one pass over a registry, taking its writes to the main line (lib/adapters/registry-save.mjs, docs/registry-save.md).
//   node scripts/registry-save.mjs [--registry F] [--label L | --repo <programme>] [--srs PATH] [--json]
//   The PR label: --label, else the programme's auto-merge gate when --repo names one, else none.
//   exit 0 the pass ran (a hold is data, not a failure), 2 usage or an unreadable registry
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { savePass } from '../lib/adapters/registry-save.mjs';
import { createPR, enableAutoMerge, get, list, mergePR } from '../lib/adapters/github.mjs';
import { loadWorkflow } from '../lib/adapters/workflow.mjs';

// ponytail: the one code host the clerk knows. Another host is another forge; the save pass doesn't change.
const slugOf = (remote) => {
  const m = /github\.com[:/](.+?)(?:\.git)?$/.exec(remote);
  if (!m) throw new Error(`${remote} is not a GitHub remote`);
  return m[1];
};
const forge = {
  findOpen({ remote, head }) {
    const slug = slugOf(remote), owner = slug.split('/')[0];
    const [pr] = list(`repos/${slug}/pulls?state=open&head=${owner}:${encodeURIComponent(head)}`);
    return pr ? { url: pr.html_url, number: pr.number } : null;
  },
  create: ({ remote, base, head, title, body, label }) => createPR({ slug: slugOf(remote), base, head, title, body, labels: label ? [label] : [] }),
  merge({ remote, base, pr }) {
    const slug = slugOf(remote);
    // Merges directly only where the branch requires nothing. On a protected branch any failure to arm auto-merge is a hold:
    // falling back to a merge there could use an admin's rights to skip the checks.
    if (get(`repos/${slug}/branches/${encodeURIComponent(base)}`).protected) enableAutoMerge(slug, pr.number);
    else mergePR(slug, pr.number);
  },
};

const say = (m) => { console.error(`clerk save: ${m}`); process.exit(2); };
let a;
try {
  a = parseArgs({ options: {
    registry: { type: 'string', default: join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'srs', 'registry.json') },
    label: { type: 'string' },
    repo: { type: 'string' },
    srs: { type: 'string', default: process.env.SRS_CLI_PATH || 'srs' },
    json: { type: 'boolean' },
  } });
} catch (e) { say(e.message); }
const { registry, repo, srs, json } = a.values;
let label = a.values.label;
try { label ??= repo ? loadWorkflow(repo).gates.auto : undefined; } catch (e) { say(`${repo}: ${e.message}`); }

let rows;
try { rows = await savePass({ registry, forge, label, srs }); } catch (e) { say(`${registry}: ${e.message}`); }
if (json) console.log(JSON.stringify(rows, null, 2));
else for (const r of rows) {
  const state = [r.readOnly && 'read-only', r.uncommitted && `${r.uncommitted} uncommitted`, r.pending && `${r.pending} pending`, r.behind && `${r.behind} behind`, r.pr, r.held && `HELD: ${r.held}`].filter(Boolean).join(', ');
  console.log(`${r.path ?? r.id}: ${state || 'up to date'}`);
}
