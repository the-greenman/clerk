#!/usr/bin/env node
/**
 * queue.mjs — report what the unattended lane would take next, by the rules in routines/unattended-worker.md "Queue".
 *
 *   node scripts/queue.mjs [--json]
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
import { refersTo } from "../lib/practice/claim.mjs";
import { repoRoot } from "./lib/repo-arg.mjs";

/** Lane label -> lane name: the general lane, plus one label per chartered working group (from the records). */
/** The general lane is the bound unattended-lane label (work_label lane-unattended); each chartered group adds its own. */
export const lanesFrom = (groups, general) => ({ [general]: "general", ...Object.fromEntries(groups.map((g) => [g.label, "wg"])) });

/** issues: REST issue objects plus `repo`; prs: open PR objects plus `repo`; lanes: lanesFrom(groups); holds: the work_hold labels. Returns ordered queued/held rows. */
export function classify(issues, prs, LANES, holds) {
  const rows = issues.map((i) => {
    const labels = i.labels.map((l) => (typeof l === "string" ? l : l.name));
    const ref = `${i.repo}#${i.number}`;
    const pr = prs.find((p) => refersTo(i.repo, i.number, p));
    const held = [
      ...(i.assignee || i.assignees?.length ? [`assigned ${(i.assignees ?? [i.assignee]).map((a) => a.login).join(",")}`] : []),
      ...labels.filter((l) => holds.includes(l)),
      ...(pr ? [`open PR ${pr.repo}#${pr.number}`] : []),
    ];
    const priority = labels.map((l) => l.match(/^priority:\s*(P\d)$/)?.[1]).find(Boolean) ?? null;
    return { ref, title: i.title, url: i.html_url, created: i.created_at.slice(0, 10), priority,
      lanes: Object.keys(LANES).filter((l) => labels.includes(l)).map((l) => LANES[l]), held };
  });
  rows.sort((a, b) => (a.priority ?? "P9").localeCompare(b.priority ?? "P9") || a.created.localeCompare(b.created));
  return { queued: rows.filter((r) => !r.held.length), held: rows.filter((r) => r.held.length) };
}

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
  return { ...classify([...issues.values()], prs, LANES, W.holds), unreadable };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let s; try { s = loadSettings(repoRoot()); } catch (e) { console.error("queue: " + e.message); process.exit(1); }
  let W; try { W = loadWorkflow(repoRoot()); } catch (e) { console.error("queue: " + e.message); process.exit(1); }
  const r = fetchAll(s.githubOwner, s.repos, loadGroups(repoRoot()), W);
  if (process.argv.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else {
    const line = (x) => `  ${(x.priority ?? "--").padEnd(3)} ${x.ref.padEnd(22)} ${x.created}  [${x.lanes.join(",")}] ${x.title}`;
    const n = (lane) => r.queued.filter((x) => x.lanes.includes(lane)).length;
    console.log(`Queued (${r.queued.length}: ${n("general")} general, ${n("wg")} wg) — the next run takes up to 3 in all (a wg build, at most 1, counts among them), top down:`);
    console.log(r.queued.map(line).join("\n") || "  (empty)");
    console.log(`\nHeld (${r.held.length}):`);
    console.log(r.held.map((x) => `${line(x)}\n        held: ${x.held.join("; ")}`).join("\n") || "  (none)");
    if (r.unreadable.length) console.log(`\nNot read (${r.unreadable.length}): ${r.unreadable.join(", ")}: this queue is partial.`);
  }
}
