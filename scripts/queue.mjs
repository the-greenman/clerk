#!/usr/bin/env node
/**
 * queue.mjs — report what the unattended lane would take next, by the rules in routines/unattended-worker.md "Queue".
 *
 *   node scripts/queue.mjs [--json]
 *
 * Queued: open issues labelled `ready` plus `lane:unattended` (general lane) or `wg:third-party-ready` (WG lane).
 * Held: an assignee, a `needs-input` or `parked` label, or an open PR referencing the issue.
 * Order: `priority: P0|P1|P2` label, then oldest first; no priority sorts last. Read-only.
 */
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { loadSettings } from "../lib/adapters/settings.mjs";
import { loadGroups } from "../lib/adapters/groups.mjs";
import { refersTo } from "../lib/practice/claim.mjs";
import { repoRoot } from "./lib/repo-arg.mjs";

/** Lane label -> lane name: the general lane, plus one label per chartered working group (from the records). */
export const lanesFrom = (groups) => ({ "lane:unattended": "general", ...Object.fromEntries(groups.map((g) => [g.label, "wg"])) });

/** issues: REST issue objects plus `repo`; prs: open PR objects plus `repo`; lanes: lanesFrom(groups). Returns ordered queued/held rows. */
export function classify(issues, prs, LANES = lanesFrom([])) {
  const rows = issues.map((i) => {
    const labels = i.labels.map((l) => (typeof l === "string" ? l : l.name));
    const ref = `${i.repo}#${i.number}`;
    const pr = prs.find((p) => refersTo(i.repo, i.number, p));
    const held = [
      ...(i.assignee || i.assignees?.length ? [`assigned ${(i.assignees ?? [i.assignee]).map((a) => a.login).join(",")}`] : []),
      ...labels.filter((l) => l === "needs-input" || l === "parked"),
      ...(pr ? [`open PR ${pr.repo}#${pr.number}`] : []),
    ];
    const priority = labels.map((l) => l.match(/^priority:\s*(P\d)$/)?.[1]).find(Boolean) ?? null;
    return { ref, title: i.title, url: i.html_url, created: i.created_at.slice(0, 10), priority,
      lanes: Object.keys(LANES).filter((l) => labels.includes(l)).map((l) => LANES[l]), held };
  });
  rows.sort((a, b) => (a.priority ?? "P9").localeCompare(b.priority ?? "P9") || a.created.localeCompare(b.created));
  return { queued: rows.filter((r) => !r.held.length), held: rows.filter((r) => r.held.length) };
}

const api = (path) => JSON.parse(execFileSync("gh", ["api", "--paginate", "--slurp", path], { encoding: "utf8" })).flat();

function fetchAll(OWNER, REPOS, groups) {
  const LANES = lanesFrom(groups), issues = new Map(), prs = [];
  for (const repo of REPOS) {
    for (const lane of Object.keys(LANES).filter((l) => l === "lane:unattended" || groups.some((g) => g.label === l && g.repos.includes(repo))))
      for (const i of api(`repos/${OWNER}/${repo}/issues?labels=${encodeURIComponent(`${lane},ready`)}&state=open&per_page=100`))
        if (!i.pull_request) issues.set(`${repo}#${i.number}`, { ...i, repo });
    prs.push(...api(`repos/${OWNER}/${repo}/pulls?state=open&per_page=100`).map((p) => ({ ...p, repo })));
  }
  return classify([...issues.values()], prs, LANES);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let s; try { s = loadSettings(repoRoot()); } catch (e) { console.error("queue: " + e.message); process.exit(1); }
  const r = fetchAll(s.githubOwner, s.repos, loadGroups(repoRoot()));
  if (process.argv.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else {
    const line = (x) => `  ${(x.priority ?? "--").padEnd(3)} ${x.ref.padEnd(22)} ${x.created}  [${x.lanes.join(",")}] ${x.title}`;
    const n = (lane) => r.queued.filter((x) => x.lanes.includes(lane)).length;
    console.log(`Queued (${r.queued.length}: ${n("general")} general, ${n("wg")} wg) — the next run takes up to 3 in all (a wg build, at most 1, counts among them), top down:`);
    console.log(r.queued.map(line).join("\n") || "  (empty)");
    console.log(`\nHeld (${r.held.length}):`);
    console.log(r.held.map((x) => `${line(x)}\n        held: ${x.held.join("; ")}`).join("\n") || "  (none)");
  }
}
