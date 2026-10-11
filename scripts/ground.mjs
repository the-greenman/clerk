#!/usr/bin/env node
// ground: advisory PR grounding check and indicator I1 (clerk#22). Always exits 0 unless an input is wrong.
//   node scripts/ground.mjs [--repo <programme>] (--pr <repo#n> | --since YYYY-MM-DD) [--json]
import { derive } from "./roadmap.mjs";
import { repoRoot } from "./lib/repo-arg.mjs";
import { srsCli } from "../lib/adapters/cli.mjs";
import { loadSettings } from "../lib/adapters/settings.mjs";
import { loadGroups } from "../lib/adapters/groups.mjs";
import { fetchPR, mergedSince, loadProgramme } from "../lib/adapters/ground.mjs";
import { groundPR, problemsFrom, i1 } from "../lib/practice/grounding-check.mjs";

const argv = process.argv.slice(2), arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
try {
  const pct = (x) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
  const since = arg("--since"), one = arg("--pr");
  if (!one && !/^\d{4}-\d{2}-\d{2}$/.test(since ?? "")) throw new Error("give --pr <repo#n> or --since YYYY-MM-DD");
  const repo = repoRoot(), cli = srsCli(repo), st = loadSettings(repo, cli);
  const { records, relations, affirmed } = loadProgramme(cli, repo);
  let roadmap; // an inactive period must not stop the check: epics are then read from the records
  try { roadmap = derive(records, relations, new Date().toISOString().slice(0, 10), affirmed); }
  catch { roadmap = { epics: records.filter((r) => r.record.typeName === "epic").map((r) => ({ refs: r.record.fieldValues.issue_ref })) }; }
  const problems = problemsFrom(records, relations, affirmed), groups = loadGroups(repo, cli);
  const refs = one ? [one] : mergedSince(st.githubOwner, st.repos, since);
  const rows = refs.map((ref) => { const f = fetchPR(st.githubOwner, ref); return { ref, title: f.pr.title, ...groundPR({ pr: f.pr, issue: f.issue, problems, roadmap, groups }) }; });
  const stats = i1(rows);
  if (argv.includes("--json")) console.log(JSON.stringify({ i1: stats, prs: rows }, null, 2));
  else {
    for (const r of rows) console.log(`${r.ref.padEnd(26)} ${r.level.padEnd(24)} ${r.sp ?? "-"}  ${r.reasons[0] ?? ""}`);
    console.log(`\nI1 (${since ? `merged since ${since}` : one}): ${stats.grounded}/${stats.total} grounded to a problem (${pct(stats.share)}); ${stats.full}/${stats.total} with affirmed persona and domain (${pct(stats.fullShare)})`);
    console.log("by level: " + Object.entries(stats.byLevel).map(([l, n]) => `${l} ${n}`).join(", "));
  }
} catch (e) { console.error("clerk ground: " + e.message); process.exit(1); }
