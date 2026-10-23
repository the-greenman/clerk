#!/usr/bin/env node
/**
 * roadmap.mjs — derive epic priority from the active period's objective ranking (srs-programme#15).
 * Rank 1 -> P0, 2 -> P1, 3+ -> P2; an epic serving no ranked objective is parked.
 *
 *   node scripts/roadmap.mjs --json [--today YYYY-MM-DD]
 *   node scripts/roadmap.mjs --explain <repo#n>
 *   node scripts/roadmap.mjs --apply [--dry-run | --yes]   (dry-run unless --yes; needs GHP_SCRIPT for priorities)
 *
 * The only writer of epic priority. Owners reprioritise by editing a period's objective_rank.
 */
import { execFileSync } from "child_process";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import { repoRoot } from "./lib/repo-arg.mjs";
import { srsCli } from "../lib/adapters/cli.mjs";
import { loadSettings } from "../lib/adapters/settings.mjs";
import { loadWorkflow } from "../lib/adapters/workflow.mjs";
import { canonOf } from "../lib/practice/canon.mjs";
const ROOT = repoRoot();
const NS = "com.semanticops.programme";

const MNS = "com.semanticops.method";

/**
 * records: `srs record list` entries; relations: `srs relation list` entries. Throws on a broken ranking.
 * affirmed: instance ids in the Affirmed container. Problems, clusters and personas are read from that
 * layer only (so are remedies); cluster and persona labels may also come from Suggestions, flagged suggested.
 * outlines: domain containers ({ containerType: "domain", memberInstanceIds: [{ instanceId, depth? }] }). A problem's cluster is the depth-0
 * cluster above it in a domain outline (clusters depth 0, problems depth 1; clerk#35, ruling D4); a problem on no outline keeps its `contains` cluster.
 */
export function derive(records, relations, today, affirmed = new Set(), outlines = []) {
  const rows = records.map((r) => ({ id: r.instanceId, type: r.record.typeName, ns: r.record.typeNamespace, fv: r.record.fieldValues }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const canon = canonOf(relations);
  const same = (id) => rows.filter((r) => canon(r.id) === canon(id)).map((r) => r.id); // a suggestion and its fork are one identity
  const outlineCluster = (problemId) => {
    for (const o of outlines.filter((x) => x.containerType === "domain")) {
      const ms = o.memberInstanceIds ?? [], i = ms.findIndex((m) => canon(m.instanceId) === canon(problemId) && (m.depth ?? 0) >= 1);
      for (let j = i - 1; i >= 0 && j >= 0; j--) if ((ms[j].depth ?? 0) === 0) { const cs = same(ms[j].instanceId).map((id) => byId.get(id)).filter((r) => r?.type === "cluster"), c = cs.find((r) => affirmed.has(r.id)) ?? cs[0]; if (c) return c; break; }
    }
    return null;
  };
  const periods = rows.filter((r) => r.type === "period").sort((a, b) => a.fv.starts_on.localeCompare(b.fv.starts_on));
  // Active = started and not ended (ends_on optional). A later-started period requires the earlier one to be closed before it.
  const covering = periods.filter((p) => p.fv.starts_on <= today && (!p.fv.ends_on || today <= p.fv.ends_on));
  if (covering.length !== 1) throw new Error(`${covering.length} periods active on ${today}; exactly one required (close an earlier open period with an ends_on)`);
  const period = covering[0];
  const ranking = period.fv.objective_rank ?? [];
  for (const id of ranking)
    if (byId.get(id)?.type !== "objective") throw new Error(`objective_rank of ${period.fv.title} references ${id}, which is not an objective`);
  const tier = (rank) => (rank == null ? null : `P${Math.min(rank, 3) - 1}`);
  const rankOf = (id) => (ranking.includes(id) ? ranking.indexOf(id) + 1 : null);
  const objectives = rows.filter((r) => r.type === "objective")
    .map((o) => ({ id: o.id, title: o.fv.title, rank: rankOf(o.id), tier: tier(rankOf(o.id)) }))
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const epics = rows.filter((r) => r.type === "epic").map((e) => {
    const served = relations.filter((l) => l.relationType === `${NS}/serves` && l.sourceId === e.id)
      .map((l) => objectives.find((o) => o.id === l.targetId)).filter((o) => o?.rank != null)
      .sort((a, b) => a.rank - b.rank)[0];
    const rel = (type, from, to) => relations.filter((l) => l.relationType === `${MNS}/${type}` && (from ? l.sourceId === from : l.targetId === to));
    const aff = (id, type) => (affirmed.has(id) && byId.get(id)?.type === type ? byId.get(id) : null);
    // Cluster and persona are structure: resolved from Affirmed or Suggestions, marked suggested when only the latter.
    const any = (id, type) => (byId.get(id)?.type === type ? byId.get(id) : null);
    const lab = (r) => (r ? { label: r.fv.title, ...(affirmed.has(r.id) ? {} : { suggested: true }) } : null);
    const remedies = rel("implements", e.id).map((l) => aff(l.targetId, "remedy")).filter(Boolean).map((rm) =>
      ({ rm, problems: rel("answers", rm.id).map((l) => aff(l.targetId, "problem")).filter(Boolean) }));
    const problems = [...new Set([...rel("answers", e.id).map((l) => aff(l.targetId, "problem")).filter(Boolean), ...remedies.flatMap((x) => x.problems)])];
    const answers = problems.map((pr) => {
      const persona = lab(same(pr.id).flatMap((id) => rel("held-by", id)).map((l) => any(l.targetId, "persona-in-domain") ?? any(l.targetId, "persona")).find(Boolean));
      const cl = outlineCluster(pr.id) ?? relations.filter((l) => l.relationType === "contains" && l.targetId === pr.id).map((l) => any(l.sourceId, "cluster")).find(Boolean);
      const cluster = lab(cl);
      const objective = cl && same(cl.id).flatMap((id) => rel("addresses", null, id)).map((l) => objectives.find((o) => o.id === l.sourceId)).find(Boolean);
      return { problem: pr.fv.problem_id ?? pr.fv.title, persona: persona?.label ?? null, ...(persona?.suggested ? { personaSuggested: true } : {}),
        cluster: cluster?.label ?? null, ...(cluster?.suggested ? { suggested: true } : {}), objective: objective?.title ?? null };
    });
    const [ref] = e.fv.issue_ref;
    const [repo, number] = ref.split("#");
    return { ref, refs: e.fv.issue_ref, repo, number: Number(number), title: e.fv.title,
      objective: served?.title ?? null, rank: served?.rank ?? null, priority: served?.tier ?? null, parked: !served,
      ...(remedies.length ? { remedies: remedies.map(({ rm, problems: ps }) => ({ id: rm.id, title: rm.fv.title, move: rm.fv.move, answers: ps.map((p) => p.fv.problem_id ?? p.fv.title) })) } : {}),
      ...(answers.length ? { answers } : {}) };
  });
  // Parked snapshot (v12): boundaries, stages, contracts, assessments keyed by strategy_key, with their outgoing relations among themselves.
  const SNAP = { boundary: "boundaries", capability_stage: "stages", strategy_contract: "contracts", assessment: "assessments" };
  const snapshot = Object.fromEntries(Object.values(SNAP).map((k) => [k, []]));
  // Programme types only: argument/boundary shares the type name "boundary" (pilot semanticops.com#31).
  const snapRows = rows.filter((r) => SNAP[r.type] && (r.ns ?? NS) === NS);
  const snapIds = new Map(snapRows.map((r) => [r.id, r]));
  for (const r of snapRows) {
    const { title, strategy_key, summary, body, ...rest } = r.fv;
    const links = relations.filter((l) => l.sourceId === r.id && snapIds.has(l.targetId))
      .map((l) => ({ type: l.relationType.split("/").at(-1), to: snapIds.get(l.targetId).fv.strategy_key }));
    snapshot[SNAP[r.type]].push({ key: strategy_key, title, summary, body, ...rest, links });
  }
  for (const list of Object.values(snapshot)) list.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  return { snapshot, activePeriod: { title: period.fv.title, starts_on: period.fv.starts_on, ends_on: period.fv.ends_on ?? null },
    objectives, epics, parked: epics.filter((e) => e.parked).map((e) => e.ref) };
}

function load() {
  const cli = srsCli(ROOT);
  const run = (args) => JSON.parse(execFileSync(cli, [...args, "--repo", ROOT], { encoding: "utf8", maxBuffer: 1 << 28 })).payload;
  const listed = run(["container", "list"]).containers.find((x) => x.title === "Affirmed");
  const c = listed && run(["container", "get", listed.containerId]).container;
  const affirmed = new Set(c ? c.memberInstanceIds.map((m) => m.instanceId) : []); // the human layer
  const outlines = run(["container", "list"]).containers.filter((x) => x.containerType === "domain").map((x) => run(["container", "get", x.containerId]).container);
  return [run(["record", "list"]).records, run(["relation", "list"]).relations, affirmed, outlines];
}

function main(argv) {
  const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const today = arg("--today") ?? new Date().toISOString().slice(0, 10);
  const [records, relations, affirmed, outlines] = load();
  const result = derive(records, relations, today, affirmed, outlines);
  if (argv.includes("--explain")) {
    const ref = arg("--explain");
    const e = result.epics.find((x) => x.refs.includes(ref));
    if (!e) throw new Error(`${ref} is not a known epic`);
    console.log(e.parked
      ? `${ref} -> ${e.title} -> no ranked objective in ${result.activePeriod.title} -> parked`
      : `${ref} -> ${e.title} -> ${e.objective} -> rank ${e.rank} in ${result.activePeriod.title} -> ${e.priority}`);
    for (const r of e.remedies ?? []) console.log(`  implements "${r.title}" (move: ${r.move.slice(0, 60)}) -> answers ${r.answers.join(", ") || "no problem"}`);
    for (const a of e.answers ?? [])
      console.log(`  answers ${a.problem} (held by ${a.persona ?? "?"}${a.personaSuggested ? " (suggested)" : ""}) -> ${a.cluster ?? "no cluster"}${a.suggested ? " (suggested)" : ""} -> ${a.objective ?? "no objective"}`);
  } else if (argv.includes("--apply")) {
    const live = argv.includes("--yes") && !argv.includes("--dry-run");
    const ghp = process.env.GHP_SCRIPT;
    if (live && !ghp) throw new Error("GHP_SCRIPT (path to gh-project.mjs) is required with --yes");
    const sh = (cmd, args, env = {}, soft = false) => {
      console.log(`${live ? "run" : "dry-run"}: ${cmd} ${args.join(" ")}`);
      try { if (live) execFileSync(cmd, args, { stdio: soft ? "pipe" : "inherit", env: { ...process.env, ...env } }); }
      catch (e) { if (!(soft && /HTTP 404|Label does not exist/.test(String(e.stderr)))) throw e; } // soft: a label the issue or repo lacks (clerk#42)
    };
    const OWNER = loadSettings(ROOT).githubOwner, PARKED = loadWorkflow(ROOT).parked;
    for (const e of result.epics) {
      if (!e.parked) sh("node", [ghp ?? "$GHP_SCRIPT", "epic", "set", String(e.number), "--priority", e.priority], { GHP_STORY_REPO: e.repo });
      sh("gh", e.parked ? ["api", "-X", "POST", `repos/${OWNER}/${e.repo}/issues/${e.number}/labels`, "-f", `labels[]=${PARKED}`]
        : ["api", "-X", "DELETE", `repos/${OWNER}/${e.repo}/issues/${e.number}/labels/${encodeURIComponent(PARKED)}`], {}, !e.parked); // REST, not `gh issue edit` (GraphQL); removing an absent label is a 404, not a failure
    }
  } else console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (err) { console.error(`✗ ${err.message}`); process.exit(1); }
}
