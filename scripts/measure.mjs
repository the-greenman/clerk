#!/usr/bin/env node
// measure: indicator I1 for a cycle as an argument/measurement-result record (clerk#25). Dry run unless --write.
//   node scripts/measure.mjs [--repo <programme>] (--group <wg:label> | --since YYYY-MM-DD [--until YYYY-MM-DD]) [--write] [--json]
// --group takes the group's cycle from `group-state` (cycleStart to now). --write creates the record in the Suggestions
// container as the session actor (SRS_ACTOR) and an `evidences` relation to the I1 indicator record. Idempotent per period.
import { derive } from "./roadmap.mjs";
import { repoRoot } from "./lib/repo-arg.mjs";
import { srsCli, srs } from "../lib/adapters/cli.mjs";
import { loadSettings } from "../lib/adapters/settings.mjs";
import { loadGroups } from "../lib/adapters/groups.mjs";
import { groupStates } from "../lib/adapters/upkeep.mjs";
import { loadWorkflow } from "../lib/adapters/workflow.mjs";
import { fetchPR, mergedSince, loadProgramme } from "../lib/adapters/ground.mjs";
import { groundPR, problemsFrom, i1 } from "../lib/practice/grounding-check.mjs";
import { i1Result, PENDING_INDICATORS } from "../lib/practice/measure.mjs";

const argv = process.argv.slice(2), arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
try {
  const repo = repoRoot(), cli = srsCli(repo), st = loadSettings(repo, cli), groups = loadGroups(repo, cli);
  let since = arg("--since"), until = arg("--until"), cycle;
  if (arg("--group")) {
    const g = groups.find((x) => x.label === arg("--group"));
    if (!g) throw new Error(`no chartered group labelled "${arg("--group")}"`);
    since = groupStates(st, [g], loadWorkflow(repo).gates, undefined, repo)[g.label].cycleStart; cycle = g.label;
    if (!since) throw new Error("the group's cycle start is unreadable");
  }
  if (!since) throw new Error("give --group <wg:label> or --since YYYY-MM-DD [--until YYYY-MM-DD]");
  const { records, relations, affirmed, outlines } = loadProgramme(cli, repo);
  let roadmap;
  try { roadmap = derive(records, relations, new Date().toISOString().slice(0, 10), affirmed, outlines); }
  catch { roadmap = { epics: records.filter((r) => r.record.typeName === "epic").map((r) => ({ refs: r.record.fieldValues.issue_ref })) }; }
  const problems = problemsFrom(records, relations, affirmed);
  const rows = mergedSince(st.githubOwner, st.repos, since, until).map((ref) => { const f = fetchPR(st.githubOwner, ref); return groundPR({ pr: f.pr, issue: f.issue, problems, roadmap, groups }); });
  const result = i1Result({ stats: i1(rows), since, until, cycle });
  const indicator = records.find((r) => r.record.typeName === "indicator" && r.record.fieldValues.indicator_id === "I1");
  const existing = records.find((r) => r.record.typeName === "measurement-result" && r.record.fieldValues.result_id === result.result_id);
  let written = null;
  if (argv.includes("--write")) {
    if (existing) written = { skipped: `a result for ${result.result_id} already exists (${existing.instanceId})` };
    else {
      const suggestions = srs(cli, repo, ["container", "list"]).containers.find((c) => c.title === "Suggestions");
      if (!suggestions) throw new Error("no Suggestions container in the programme");
      if (!indicator) throw new Error("no I1 indicator record: create the indicator records first");
      const rec = srs(cli, repo, ["record", "create", "--container", suggestions.containerId, "--type", "com.mudemocracy.argument/measurement-result"], { fieldValues: result }).record;
      srs(cli, repo, ["relation", "create"], { relationType: "evidences", sourceInstanceId: rec.instanceId ?? rec.id, targetInstanceId: indicator.instanceId });
      written = { id: rec.instanceId ?? rec.id };
    }
  }
  if (argv.includes("--json")) console.log(JSON.stringify({ result, written, pending: PENDING_INDICATORS }, null, 2));
  else {
    console.log(result.observed_finding);
    console.log(`evaluator: ${result.evaluator}`);
    console.log(`${PENDING_INDICATORS.join(", ")}: no computation yet, no result.`);
    console.log(written ? (written.id ? `wrote ${written.id}` : written.skipped) : "dry run: nothing written (--write to record)");
  }
} catch (e) { console.error("clerk measure: " + e.message); process.exit(1); }
