#!/usr/bin/env node
// check-method.mjs — structural rules the method package cannot declare itself (no cardinality in SRS):
// every tension contains exactly two poles; every principle governs exactly one tension and leans
// toward exactly one of that tension's poles. Runs over both layers (Suggestions and Affirmed).
import { execFileSync } from "child_process";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import { repoRoot } from "./lib/repo-arg.mjs";
import { canonOf } from "../lib/practice/canon.mjs";
const ROOT = repoRoot();
const MNS = "com.semanticops.method";
const ANS = "com.mudemocracy.argument";
// Boundary rules (pilot semanticops.com#31, D6) bind only records created on/after this day: the 6 older principles have no
// boundary and are not retro-fitted. Creation date, not layer, so agent suggestions are held to it too.
export const BOUNDARY_RULES_FROM = "2026-10-09";
// Principle 2 gate severity (clerk#35, rulings D2a/D4/D5): a warning until both pilot domains are walked; flip this one switch to "error" then.
export const PRINCIPLE2_SEVERITY = "warning";

/** records: `srs record list` entries; relations: `srs relation list` entries. Returns error strings. */
export function checkMethod(records, relations, since = BOUNDARY_RULES_FROM) {
  const type = (n) => records.filter((r) => r.record.typeName === n);
  const label = (r) => `${r.record.typeName} ${r.record.fieldValues.title ?? r.record.fieldValues.statement} (${r.instanceId.slice(0, 8)})`;
  const out = (id, t) => relations.filter((x) => x.sourceId === id && x.relationType === t).map((x) => x.targetId);
  const errors = [];
  for (const t of type("tension")) {
    const poles = out(t.instanceId, "contains").filter((id) => records.some((r) => r.instanceId === id && r.record.typeName === "pole"));
    if (poles.length !== 2) errors.push(`${label(t)} contains ${poles.length} poles, expected exactly 2`);
  }
  for (const p of type("principle")) {
    const gov = out(p.instanceId, `${MNS}/governs`);
    if (gov.length !== 1) { errors.push(`${label(p)} governs ${gov.length} tensions, expected exactly 1`); continue; }
    const poles = out(gov[0], "contains");
    const leans = out(p.instanceId, `${MNS}/leans-toward`);
    if (leans.length !== 1 || !poles.includes(leans[0])) errors.push(`${label(p)} must lean toward exactly one pole of its tension`);
  }
  // Boundary rules; the argument package may be absent, then there are no boundaries and nothing to check.
  const isBoundary = (r) => r.record.typeName === "boundary" && r.record.typeNamespace === ANS;
  const isNew = (r) => String(r.record.createdAt ?? "").slice(0, 10) >= since;
  for (const b of records.filter((r) => isBoundary(r) && isNew(r))) {
    const n = new Set(out(b.instanceId, `${ANS}/holds-tension`)).size;
    if (n < 3) errors.push(`${label(b)} holds ${n} tensions, expected at least 3`);
  }
  for (const p of type("principle").filter(isNew)) {
    const bs = new Set(out(p.instanceId, `${ANS}/within-boundary`).filter((id) => records.some((r) => r.instanceId === id && isBoundary(r))));
    if (bs.size !== 1) errors.push(`${label(p)} is within-boundary of ${bs.size} boundaries, expected exactly 1`);
  }
  return errors;
}

/**
 * Affirmed / Set aside gates. affirmed, setAside: Sets of member instance ids.
 * Errors: an AI-authored member of either human layer; a duplicate problem_id within one layer (forks legitimately repeat it across layers); an affirmed remedy that answers no
 * affirmed problem or has no falsifier. Warning: an epic serving a ranked objective that answers no affirmed problem
 * (directly, or through a remedy it implements).
 */
export function checkGates(records, relations, affirmed, setAside, today = new Date().toISOString().slice(0, 10)) {
  const errors = [], warnings = [];
  const label = (r) => `${r.record.typeName} ${r.record.fieldValues.title ?? r.record.fieldValues.statement} (${r.instanceId.slice(0, 8)})`;
  const isType = (id, n) => records.some((r) => r.instanceId === id && r.record.typeName === n);
  const out = (id, t) => relations.filter((x) => x.sourceId === id && x.relationType === t).map((x) => x.targetId);
  for (const r of records) {
    if (affirmed.has(r.instanceId) && setAside.has(r.instanceId)) errors.push(`${label(r)} is in both Affirmed and Set aside`);
    const layer = affirmed.has(r.instanceId) ? "Affirmed" : setAside.has(r.instanceId) ? "Set aside" : null;
    if (layer && r.record.createdBy?.kind === "ai") errors.push(`${label(r)} is in ${layer} but was created by an AI actor (${r.record.createdBy.id}); fork it as a human`);
  }
  const seen = new Map();
  for (const r of records.filter((r) => r.record.typeName === "problem" && r.record.fieldValues.problem_id)) {
    // a fork keeps its problem_id, so the same id across layers is expected; twice in one layer is not
    const id = `${r.record.fieldValues.problem_id}@${affirmed.has(r.instanceId) ? "Affirmed" : setAside.has(r.instanceId) ? "Set aside" : "Suggestions"}`;
    if (seen.has(id)) errors.push(`duplicate problem_id ${id.replace('@', ' in ')}: ${label(seen.get(id))} and ${label(r)}`);
    else seen.set(id, r);
  }
  const answersAffirmed = (id) => out(id, `${MNS}/answers`).some((t) => affirmed.has(t) && isType(t, "problem"));
  for (const r of records.filter((r) => r.record.typeName === "remedy" && affirmed.has(r.instanceId))) {
    if (!answersAffirmed(r.instanceId)) errors.push(`${label(r)} is affirmed but answers no affirmed problem`);
    if (!String(r.record.fieldValues.falsifier ?? "").trim()) errors.push(`${label(r)} is affirmed but has no falsifier`);
  }
  const ranked = new Set(records.filter((r) => r.record.typeName === "period" && r.record.fieldValues.starts_on <= today && (!r.record.fieldValues.ends_on || today <= r.record.fieldValues.ends_on)).flatMap((r) => r.record.fieldValues.objective_rank ?? []));
  for (const e of records.filter((r) => r.record.typeName === "epic")) {
    if (!out(e.instanceId, "com.semanticops.programme/serves").some((o) => ranked.has(o))) continue;
    const viaRemedy = out(e.instanceId, `${MNS}/implements`).some((t) => affirmed.has(t) && isType(t, "remedy") && answersAffirmed(t));
    if (!answersAffirmed(e.instanceId) && !viaRemedy) warnings.push(`${label(e)} serves a ranked objective but answers no affirmed problem`);
  }
  // Principle 2. canon() makes a suggestion and its fork one identity; an edge on either copy counts.
  const canon = canonOf(relations);
  const affirmedIds = new Set([...affirmed].map(canon));
  const classOf = (id) => records.map((r) => r.instanceId).filter((x) => canon(x) === canon(id));
  const reach = (id, t) => [...new Set(classOf(id).flatMap((m) => out(m, t)).map(canon))];
  const p2 = PRINCIPLE2_SEVERITY === "error" ? errors : warnings;
  const typeOf = (id, n) => records.some((r) => canon(r.instanceId) === canon(id) && r.record.typeName === n);
  for (const r of records.filter((r) => r.record.typeName === "problem" && affirmed.has(r.instanceId))) {
    const holders = reach(r.instanceId, `${MNS}/held-by`).filter((h) => typeOf(h, "persona-in-domain") && affirmedIds.has(h));
    if (!holders.length) { p2.push(`${label(r)} is affirmed but held-by no affirmed persona-in-domain`); continue; }
    const grounded = holders.some((h) => {
      const doms = reach(h, `${MNS}/in-domain`);
      return doms.length === 1 && typeOf(doms[0], "domain") && affirmedIds.has(doms[0]);
    });
    if (!grounded) p2.push(`${label(r)} is affirmed but no affirmed persona-in-domain holding it has exactly one in-domain reaching an affirmed domain`);
  }
  return { errors, warnings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cli = process.env.SRS_CLI_PATH?.trim() || "srs";
  const run = (args) => JSON.parse(execFileSync(cli, [...args, "--repo", ROOT], { encoding: "utf8", maxBuffer: 1 << 28 })).payload;
  const records = run(["record", "list"]).records, relations = run(["relation", "list"]).relations;
  const members = (title) => {
    const c = run(["container", "list"]).containers.find((x) => x.title === title);
    const k = c && run(["container", "get", c.containerId]).container;
    // the identity record is container scaffolding, not a method record
    return new Set(k ? k.memberInstanceIds.map((m) => m.instanceId).filter((id) => id !== k.identityInstanceId) : []);
  };
  const gates = checkGates(records, relations, members("Affirmed"), members("Set aside"));
  gates.warnings.forEach((w) => console.warn(`! ${w}`));
  const errors = [...checkMethod(records, relations), ...gates.errors];
  if (errors.length) { errors.forEach((e) => console.error(`✗ ${e}`)); process.exit(1); }
  console.log("✓ method: every tension has 2 poles; every principle governs one tension and leans toward one of its poles.");
}
