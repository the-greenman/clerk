#!/usr/bin/env node
// groups: print the working groups chartered in the programme repo (governance/role records with a group_label).
//   node scripts/groups.mjs [--repo <programme path>] [--json]      bash: clerk groups --json | jq -r '.[].label'
//   node scripts/groups.mjs --env <wg:label> [--repo ...]           prints the charter as exports for pr-upkeep.sh: eval "$(clerk groups --env wg:x)"
import { loadGroups } from "../lib/adapters/groups.mjs";
import { repoRoot } from "./lib/repo-arg.mjs";

try {
  const gs = loadGroups(repoRoot());
  const env = process.argv[process.argv.indexOf("--env") + 1];
  if (process.argv.includes("--env")) {
    const g = gs.find((x) => x.label === env);
    if (!g) throw new Error(`no chartered group labelled "${env}" (known: ${gs.map((x) => x.label).join(", ")})`);
    console.log([["WG_LABEL", g.label], ["WG_BUDGET", g.budget], ["WG_CYCLE_CLOSE", g.cycleClose], ["WG_MAX_UNACKED", g.maxUnacked]].map(([k, v]) => `export ${k}='${v}'`).join("\n"));
  } else if (process.argv.includes("--json")) console.log(JSON.stringify(gs, null, 2));
  else for (const g of gs) console.log(`${g.title.padEnd(24)} ${g.label}  budget ${g.budget}/cycle, closes ${g.cycleClose} UTC, pauses after ${g.maxUnacked} unacked reports, ${g.members.length} members, repos ${g.repos.join(", ")}`);
} catch (e) { console.error("clerk groups: " + e.message); process.exit(1); }
