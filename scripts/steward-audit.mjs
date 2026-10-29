#!/usr/bin/env node
// steward-audit: the weekly audit, first slice (srs-programme#38, Answers SP-02). Read-only: prints a report, writes nothing.
//   node scripts/steward-audit.mjs [--since ISO] [--stale-days N] [--json]
// Measures what the 2026-10-08 archaeology measured by hand, from issues alone:
//   false-close      closed COMPLETED, not an epic, no merged closing PR (steward-check's reopen-no-pr rule, over all of history)
//   epic-incomplete  epic closed with open sub-issues that are not re-homed (steward-check's reopen-epic rule)
//   stale-unattended open `lane:unattended` issue not updated for N days (default 14)
// Not in this slice: orphan branches, affirmed problems without a remedy, remedy falsifiers, the diff against the previous
// run, the attachment output and the weekly routine (all named in srs-programme#38).
import { fileURLToPath } from "node:url";
import { loadSettings } from "../lib/adapters/settings.mjs";
import { list } from "../lib/adapters/github.mjs";
import { loadWorkflow } from "../lib/adapters/workflow.mjs";
import { plan, fetchIssues } from "./steward-check.mjs";
import { repoRoot } from "./lib/repo-arg.mjs";

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

export function report(rows, date) {
  const rules = ["false-close", "epic-incomplete", "stale-unattended"];
  const lines = [`# Steward audit ${date}`, ""];
  for (const r of rules) {
    const hit = rows.filter((x) => x.rule === r);
    lines.push(`## ${r}: ${hit.length}`, ...hit.map((x) => `- ${x.ref}${x.detail ? ` (${x.detail})` : ""}`), "");
  }
  return lines.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const since = arg("--since", "2026-01-01T00:00:00Z");
  const staleDays = Number(arg("--stale-days", 14));
  if (Number.isNaN(Date.parse(since)) || !(staleDays > 0)) { console.error("--since needs an ISO date, --stale-days a positive number"); process.exit(2); }
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
        .map((i) => ({ repo, number: i.number, title: i.title, labels: i.labels.map((l) => l.name), updatedAt: i.updated_at, assignee: i.assignee?.login }));
      rows.push(...audit(closed, open, { now, since, staleDays, lane: W.lane }));
    } catch (e) { console.error(`${repo}: ${e.message}`); failed++; }
  }
  console.log(argv.includes("--json") ? JSON.stringify(rows, null, 2) : report(rows, new Date(now).toISOString().slice(0, 10)));
  process.exit(failed ? 1 : 0);
}
