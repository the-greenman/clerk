#!/usr/bin/env node
/**
 * queue.mjs — report what the unattended lane would take next, by the rules in routines/unattended-worker.md "Queue".
 *
 *   node scripts/queue.mjs [--bugs] [--json]
 *
 * --bugs: the bug queue instead (open `bug` issues in every settings repo, held the same way plus claimed or in review;
 * priority label then oldest, no priority counting as P1; lane = the issue's wg: group, else central).
 * --rfcs: the RFC-request queue the RFC drafter takes from (routines/rfc-drafter.md): open `ready` issues carrying the label
 * bound to work_label rfc-request, held and laned as bugs; no priority sorts last.
 *
 * Queued: open issues labelled `ready` plus `lane:unattended` (general lane) or `wg:third-party-ready` (WG lane).
 * Held: an assignee, an open PR referencing the issue, or a hold (work_hold: needs-input, blocked, parked; labels from the programme's bindings).
 * Order: `priority: P0|P1|P2` label, then oldest first; no priority sorts last. Read-only.
 */
import { fileURLToPath } from "url";
import { ghJson } from "../lib/adapters/cli.mjs";
import { loadSettings } from "../lib/adapters/settings.mjs";
import { loadGroups } from "../lib/adapters/groups.mjs";
import { loadWorkflow } from "../lib/adapters/workflow.mjs";
import { classify } from "../lib/practice/queue.mjs";
import { repoRoot } from "./lib/repo-arg.mjs";

export { classify };

/** The general lane is the bound unattended-lane label (work_label lane-unattended); each chartered group adds its own. */
export const lanesFrom = (groups, general) => ({ [general]: "general", ...Object.fromEntries(groups.map((g) => [g.label, "wg"])) });

const api = (path) => ghJson(["api", "--paginate", "--slurp", path]).flat();

function fetchAll(OWNER, REPOS, groups, W) {
  const LANES = lanesFrom(groups, W.lane), issues = new Map(), prs = [], unreadable = [];
  for (const repo of REPOS) try {
    for (const lane of Object.keys(LANES).filter((l) => l === W.lane || groups.some((g) => g.label === l && g.repos.includes(repo))))
      for (const i of api(`repos/${OWNER}/${repo}/issues?labels=${encodeURIComponent(`${lane},${W.ready}`)}&state=open&per_page=100`))
        if (!i.pull_request) issues.set(`${repo}#${i.number}`, { ...i, repo });
    prs.push(...api(`repos/${OWNER}/${repo}/pulls?state=open&per_page=100`).map((p) => ({ ...p, repo })));
  } catch (e) { // e.g. a cloud session without that repo attached: report it, keep the rest
    unreadable.push(repo); console.error(`queue: ${repo} unreadable, skipped (${String(e.stderr || e.message).trim().split("\n")[0]})`);
  }
  return { ...classify([...issues.values()], prs, LANES, W.holds, takenBy(W)), unreadable };
}

const takenBy = (W) => ({ [W.inProgress]: "claimed", [W.inReview]: "in review" });

// The bug queue (routines/bug-fixer.md): every open issue labelled with the bound bug label in the settings repos, held the
// same way as the lanes, ordered by priority label then age; a bug with no priority counts as P1 (the bug floor). Its lane is
// the group whose wg: label it carries, else the central group.
export function bugQueue(issues, prs, groups, W, floor = "P1") {
  const r = classify(issues, prs, Object.fromEntries(groups.map((g) => [g.label, g.label])), W.holds, takenBy(W));
  const fix = (x) => ({ ...x, priority: x.priority ?? floor, lanes: x.lanes.length ? x.lanes : ["central"] });
  const order = (a, b) => (a.priority ?? "P9").localeCompare(b.priority ?? "P9") || a.created.localeCompare(b.created);
  return { queued: r.queued.map(fix).sort(order), held: r.held.map(fix).sort(order) };
}

// The RFC-request queue (routines/rfc-drafter.md, decision 778f154a): as the bug queue, with no priority floor.
export const rfcQueue = (issues, prs, groups, W) => bugQueue(issues, prs, groups, W, null);

function fetchBugs(OWNER, REPOS, groups, W, rfcs = false) {
  const issues = [], prs = [], unreadable = [];
  const labels = rfcs ? `${W.rfcRequest},${W.ready}` : W.bug;
  for (const repo of REPOS) try {
    issues.push(...api(`repos/${OWNER}/${repo}/issues?labels=${encodeURIComponent(labels)}&state=open&per_page=100`).filter((i) => !i.pull_request).map((i) => ({ ...i, repo })));
    prs.push(...api(`repos/${OWNER}/${repo}/pulls?state=open&per_page=100`).map((p) => ({ ...p, repo })));
  } catch (e) {
    unreadable.push(repo); console.error(`queue: ${repo} unreadable, skipped (${String(e.stderr || e.message).trim().split("\n")[0]})`);
  }
  return { ...(rfcs ? rfcQueue : bugQueue)(issues, prs, groups, W), unreadable };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let s; try { s = loadSettings(repoRoot()); } catch (e) { console.error("queue: " + e.message); process.exit(1); }
  let W; try { W = loadWorkflow(repoRoot()); } catch (e) { console.error("queue: " + e.message); process.exit(1); }
  const rfcs = process.argv.includes("--rfcs"), bugs = rfcs || process.argv.includes("--bugs");
  if (rfcs && !W.rfcRequest) { console.error("queue: no active label-binding gives work_label rfc-request a GitHub label (programme label bindings)"); process.exit(1); }
  const r = bugs ? fetchBugs(s.githubOwner, s.repos, loadGroups(repoRoot()), W, rfcs) : fetchAll(s.githubOwner, s.repos, loadGroups(repoRoot()), W);
  if (process.argv.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else if (bugs) {
    const line = (x) => `  ${(x.priority ?? "--").padEnd(3)} ${x.ref.padEnd(26)} ${x.created}  [${x.lanes.join(",")}] ${x.title}`;
    console.log(`${rfcs ? "RFC-request" : "Bug"} queue (${r.queued.length}), top down — the ${rfcs ? "RFC drafter" : "bug fixer"} takes the first:\n${r.queued.map(line).join("\n") || "  (empty)"}`);
    console.log(`\nHeld (${r.held.length}):\n${r.held.map((x) => `${line(x)}\n        held: ${x.held.join("; ")}`).join("\n") || "  (none)"}`);
    if (r.unreadable.length) console.log(`\nNot read (${r.unreadable.length}): ${r.unreadable.join(", ")}: this queue is partial.`);
  } else {
    const line = (x) => `  ${(x.priority ?? "--").padEnd(3)} ${x.ref.padEnd(22)} ${x.created}  [${x.lanes.join(",")}] ${x.title}`;
    const n = (lane) => r.queued.filter((x) => x.lanes.includes(lane)).length;
    console.log(`Queued (${r.queued.length}: ${n("general")} general, ${n("wg")} wg) — the next run takes up to 3 in all (a wg build, at most 1, counts among them), top down:`);
    console.log(r.queued.map(line).join("\n") || "  (empty)");
    console.log(`\nHeld (${r.held.length}):`);
    console.log(r.held.map((x) => `${line(x)}\n        held: ${x.held.join("; ")}`).join("\n") || "  (none)");
    if (r.unreadable.length) console.log(`\nNot read (${r.unreadable.length}): ${r.unreadable.join(", ")}: this queue is partial.`);
  }
}
