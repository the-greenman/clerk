#!/usr/bin/env node
// steward-audit: the weekly audit, first slice (srs-programme#38, Answers SP-02). Read-only: prints a report, writes nothing.
//   node scripts/steward-audit.mjs [--since ISO] [--stale-days N] [--json] [--previous rows.json]
// Measures what the 2026-10-08 archaeology measured by hand, from issues alone:
//   false-close      closed COMPLETED, not an epic, no merged closing PR (steward-check's reopen-no-pr rule, over all of history)
//   epic-incomplete  epic closed with open sub-issues that are not re-homed (steward-check's reopen-epic rule)
//   stale-unattended open `lane:unattended` issue not updated for N days (default 14)
//   orphan-branch    branch with commits not on the default branch and no PR (open or closed) from it
//   problem-no-remedy affirmed problem that no affirmed remedy answers (read from the programme with srs)
//   falsifier-34e4af7c open unattended-lane issue answering SP-01 untouched for 30 days (remedy 34e4af7c's falsifier)
// --previous takes an earlier run's --json output and adds a "Changes since previous run" section (new and resolved rows).
// Not in this slice: remedy falsifier eed1e4ef (its own issue), the attachment output
// and the weekly routine (named in srs-programme#38).
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSettings } from "../lib/adapters/settings.mjs";
import { list, get } from "../lib/adapters/github.mjs";
import { loadWorkflow } from "../lib/adapters/workflow.mjs";
import { plan, fetchIssues } from "./steward-check.mjs";
import { repoRoot } from "./lib/repo-arg.mjs";
import { srsCli } from "../lib/adapters/cli.mjs";
import { loadProgramme } from "../lib/adapters/ground.mjs";

const RULE = { "reopen-no-pr": "false-close", "reopen-epic": "epic-incomplete" };

// closed: issues as steward-check's fetchIssues returns them; open: [{repo, number, title, labels:[name], updatedAt, assignee}].
// lane: the bound unattended-lane label (workflow.lane). Returns [{rule, ref, detail}], false closes and incomplete epics first, then stale unattended work, oldest first.
export function audit(closed, open, { now = Date.now(), since = "1970-01-01T00:00:00Z", staleDays = 14, lane } = {}) {
  const days = Math.ceil((now - Date.parse(since)) / 864e5) + 1;
  const out = plan(closed, { now, days, since })
    .filter((a) => RULE[a.rule])
    .map((a) => ({ rule: RULE[a.rule], ref: a.ref }));
  const cutoff = now - staleDays * 864e5;
  const stale = open
    .filter((i) => i.labels.includes(lane) && Date.parse(i.updatedAt) < cutoff)
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
    .map((i) => ({ rule: "stale-unattended", ref: `${i.repo}#${i.number}`, detail: `last updated ${i.updatedAt.slice(0, 10)}${i.assignee ? `, held by ${i.assignee}` : ""}` }));
  return [...out, ...stale];
}

// Remedy 34e4af7c's falsifier, measurable now: an open lane issue whose body answers SP-01 (an `Answers:` line naming SP-01,
// not SP-010) and was last updated more than `days` ago. Oldest first. open is shaped as audit's, plus body.
export function sp01Stale(open, { now = Date.now(), days = 30, lane } = {}) {
  const cutoff = now - days * 864e5;
  return open
    .filter((i) => i.labels.includes(lane) && /^[ \t]*Answers:[^\n]*\bSP-0*1\b/im.test(i.body ?? "") && Date.parse(i.updatedAt) < cutoff)
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
    .map((i) => ({ rule: "falsifier-34e4af7c", ref: `${i.repo}#${i.number}`, detail: `answers SP-01, last updated ${i.updatedAt.slice(0, 10)}` }));
}

// branches: [{repo, name, ahead}] for branches other than the default, ahead = commits not on the default branch
// (null when the compare failed). Returns orphan-branch rows, most commits first.
export function orphanBranches(branches) {
  return branches
    .filter((b) => b.ahead > 0)
    .sort((a, b) => b.ahead - a.ahead)
    .map((b) => ({ rule: "orphan-branch", ref: `${b.repo}:${b.name}`, detail: `${b.ahead} commit${b.ahead === 1 ? "" : "s"} not on the default branch, no PR` }));
}

// records/relations/affirmed as loadProgramme returns them. An affirmed problem is one with a copy in the Affirmed
// container (forks share a problem_id, so the copies of one SP are pooled); it is answered when an affirmed remedy
// has an `answers` relation to any copy. Returns problem-no-remedy rows, by SP number.
export function problemsWithoutRemedy(records, relations, affirmed) {
  const copies = new Map();
  for (const r of records.filter((x) => x.record.typeName === "problem")) {
    const k = r.record.fieldValues.problem_id ?? r.record.fieldValues.title;
    copies.set(k, { title: r.record.fieldValues.title, ids: [...(copies.get(k)?.ids ?? []), r.instanceId] });
  }
  const remedies = new Set(records.filter((x) => x.record.typeName === "remedy" && affirmed.has(x.instanceId)).map((x) => x.instanceId));
  const answered = new Set(relations.filter((l) => l.relationType === "com.semanticops.method/answers" && remedies.has(l.sourceId)).map((l) => l.targetId));
  return [...copies].filter(([, c]) => c.ids.some((i) => affirmed.has(i)) && !c.ids.some((i) => answered.has(i)))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([sp, c]) => ({ rule: "problem-no-remedy", ref: sp, detail: c.title }));
}

// Reads one repo's branches over REST: not the default, never the head of a PR (open or closed, same repo), with the
// number of commits ahead of the default branch. A failed compare gives ahead null, not a failed repo.
export function fetchBranches(owner, repo) {
  const def = get(`repos/${owner}/${repo}`).default_branch;
  const heads = new Set(list(`repos/${owner}/${repo}/pulls?state=all&per_page=100`).filter((p) => p.head.repo?.full_name === `${owner}/${repo}`).map((p) => p.head.ref));
  return list(`repos/${owner}/${repo}/branches?per_page=100`).map((b) => b.name)
    .filter((n) => n !== def && !heads.has(n))
    .map((name) => {
      let ahead = null;
      try { ahead = get(`repos/${owner}/${repo}/compare/${encodeURIComponent(def)}...${encodeURIComponent(name)}`).ahead_by; } catch (e) { console.error(`${repo}:${name}: compare failed: ${e.message}`); }
      return { repo, name, ahead };
    });
}

// Rows are the same finding when rule and ref match (detail changes, like age, do not make a new finding).
// Returns {added, resolved}: rows only in `rows`, rows only in `previous`.
export function diffRows(previous, rows) {
  const key = (r) => `${r.rule}\u0000${r.ref}`;
  const before = new Set(previous.map(key)), after = new Set(rows.map(key));
  return { added: rows.filter((r) => !before.has(key(r))), resolved: previous.filter((r) => !after.has(key(r))) };
}

export function report(rows, date, previous) {
  const rules = ["false-close", "epic-incomplete", "orphan-branch", "stale-unattended", "problem-no-remedy", "falsifier-34e4af7c"];
  const lines = [`# Steward audit ${date}`, ""];
  for (const r of rules) {
    const hit = rows.filter((x) => x.rule === r);
    lines.push(`## ${r}: ${hit.length}`, ...hit.map((x) => `- ${x.ref}${x.detail ? ` (${x.detail})` : ""}`), "");
  }
  if (previous) {
    const { added, resolved } = diffRows(previous, rows);
    const fmt = (x) => `- ${x.rule}: ${x.ref}${x.detail ? ` (${x.detail})` : ""}`;
    lines.push(`## Changes since previous run: ${added.length} new, ${resolved.length} resolved`, "", "New:", ...(added.length ? added.map(fmt) : ["- none"]), "", "Resolved:", ...(resolved.length ? resolved.map(fmt) : ["- none"]), "");
  }
  return lines.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const since = arg("--since", "2026-01-01T00:00:00Z");
  const staleDays = Number(arg("--stale-days", 14));
  if (Number.isNaN(Date.parse(since)) || !(staleDays > 0)) { console.error("--since needs an ISO date, --stale-days a positive number"); process.exit(2); }
  let previous;
  if (argv.includes("--previous")) {
    try { previous = JSON.parse(fs.readFileSync(arg("--previous"), "utf8")); if (!Array.isArray(previous)) throw new Error("not an array of rows"); }
    catch (e) { console.error(`--previous needs a file holding an earlier --json run: ${e.message}`); process.exit(2); }
  }
  let settings; try { settings = loadSettings(repoRoot()); } catch (e) { console.error("steward-audit: " + e.message); process.exit(2); }
  let W; try { W = loadWorkflow(repoRoot()); } catch (e) { console.error("steward-audit: " + e.message); process.exit(2); }
  const OWNER = settings.githubOwner;
  const now = Date.now();
  const days = Math.ceil((now - Date.parse(since)) / 864e5) + 1;
  let failed = 0; const rows = [];
  for (const repo of settings.repos) {
    try {
      const closed = fetchIssues(repo, days, since, OWNER).filter((i) => i.state === "CLOSED");
      const open = list(`repos/${OWNER}/${repo}/issues?state=open&labels=${encodeURIComponent(W.lane)}&per_page=100`)
        .filter((i) => !i.pull_request)
        .map((i) => ({ repo, number: i.number, title: i.title, labels: i.labels.map((l) => l.name), updatedAt: i.updated_at, body: i.body, assignee: i.assignee?.login }));
      rows.push(...audit(closed, open, { now, since, staleDays, lane: W.lane }));
      rows.push(...sp01Stale(open, { now, lane: W.lane }));
      rows.push(...orphanBranches(fetchBranches(OWNER, repo)));
    } catch (e) { console.error(`${repo}: ${e.message}`); failed++; }
  }
  try { const p = loadProgramme(srsCli(repoRoot()), repoRoot()); rows.push(...problemsWithoutRemedy(p.records, p.relations, p.affirmed)); }
  catch (e) { console.error(`programme: ${e.message}`); failed++; }
  console.log(argv.includes("--json") ? JSON.stringify(rows, null, 2) : report(rows, new Date(now).toISOString().slice(0, 10), previous));
  process.exit(failed ? 1 : 0);
}
