#!/usr/bin/env node
// groups: print the working groups chartered in the programme repo (governance/role records with a group_label).
//   node scripts/groups.mjs [--repo <programme path>] [--json]      bash: clerk groups --json | jq -r '.[].label'
import { loadGroups } from "../lib/adapters/groups.mjs";
import { repoRoot } from "./lib/repo-arg.mjs";

try {
  const gs = loadGroups(repoRoot());
  if (process.argv.includes("--json")) console.log(JSON.stringify(gs, null, 2));
  else for (const g of gs) console.log(`${g.title.padEnd(24)} ${g.label}  budget ${g.budget}/cycle, closes ${g.cycleClose} UTC, pauses after ${g.maxUnacked} unacked reports, ${g.members.length} members, repos ${g.repos.join(", ")}`);
} catch (e) { console.error("clerk groups: " + e.message); process.exit(1); }
