#!/usr/bin/env node
// steward-check: daily guard against false closes (srs-programme#37, Answers SP-43).
//   node scripts/steward-check.mjs [--days N] [--since ISO] [--fix]      dry run is the DEFAULT; --fix acts.
// Rules, over the last N days (default 7), across the programme's governed repos (settings governed_repos):
//   reopen-no-pr   closed COMPLETED, not an epic, no merged closing PR, no `no-code` label -> reopen + comment
//   reopen-epic    epic (label `epic` or has sub-issues) closed with open sub-issues, unless every open child has a re-homing comment -> reopen + comment
// Closed by a Commit or a merged PR (timeline closer) also counts as landed; duplicates and bots are skipped.
// So does a comment naming a MERGED PR after "Landed" (clerk#68): "Landed: srs-web#548 ...", "Landed via srs-programme#44, #45".
// The refs run to the end of that line; a bare #n takes the repo of the ref before it on the line, else the issue's own repo.
// Each is checked as a merged PR (REST pulls/{n}); a named issue or an unmerged PR is no evidence.
//   answers        OPEN and opened without an `Answers:` / `No affirmed problem yet` line -> one comment
//   prereq-edge    OPEN, and its body names a prerequisite ("Blocked by: X", "once X lands") that is not a
//                  blocked-by edge -> one comment asking for the edge (clerk#113: ranked work pulls its blockers)
// Every comment carries a hidden marker, so reruns are idempotent; an issue that already carries our
// marker is never reopened again (a human who re-closes it has overruled us).
// plan() is pure (rows in, actions out); the GitHub I/O is the thin REST layer below (lib/adapters/github.mjs).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadSettings } from "../lib/adapters/settings.mjs";
import { answersOf } from "../lib/practice/grounding.mjs";
import { issuesSince, list, get, closers } from "../lib/adapters/github.mjs";
import { repoRoot } from "./lib/repo-arg.mjs";

// Go-forward only: history before this is never acted on (the weekly audit, srs-programme#38, reports it).
export const SINCE = "2026-10-09T00:00:00Z";
const RESET_RE = /Closed in the SemanticOps roadmap reset/;
const M = { noPr: "<!-- steward-check:reopen-no-pr -->", epic: "<!-- steward-check:reopen-epic -->", answers: "<!-- steward-check:answers -->", prereq: "<!-- steward-check:prereq-edge -->" };
const REHOME_RE = /(re-?hom|moved to|moving to|tracked (in|by)|now (in|under|tracked))/i;
const REF_RE = /(?:[\w.-]+\/)?[\w.-]*#(\d+)/g;

const LANDED_RE = /\bLanded\b([^\n]*)/g;
const LANDED_REF_RE = /(?:([\w.-]+)\/)?([\w.-]+)?#(\d+)/g;

// Refs named after "Landed" in any comment -> [{repo, number}], deduped. repo: the issue's own repo, for a bare #n with no repo before it.
export function landedRefs(comments, repo) {
  const out = new Map();
  for (const c of comments || []) for (const [, tail] of c.matchAll(LANDED_RE)) {
    let last = repo;
    for (const m of tail.matchAll(LANDED_REF_RE)) {
      last = m[2] ?? last;
      out.set(`${last}#${m[3]}`, { repo: last, number: Number(m[3]) });
    }
  }
  return [...out.values()];
}

// Prerequisites named in text (clerk#113): refs on a "Blocked by:" line, and "once <ref> lands".
const BLOCKED_BY_RE = /^\W*Blocked by\b:?([^\n]*)/gim;
const ONCE_RE = /\bonce\s+((?:[\w.-]+\/)?[\w.-]*#\d+)\s+lands\b/gi;
export function prereqRefs(body, repo) {
  // A bare #n takes the repo of the ref before it on the line, else the issue's own (as landedRefs).
  const out = new Set(), add = (tail) => { let last = repo; for (const m of tail.matchAll(LANDED_REF_RE)) { last = m[2] ?? last; out.add(`${last}#${m[3]}`); } };
  for (const [, tail] of String(body ?? "").matchAll(BLOCKED_BY_RE)) add(tail);
  for (const [, ref] of String(body ?? "").matchAll(ONCE_RE)) add(ref);
  return [...out];
}

const names = (xs) => (xs || []).map((l) => l.name);
const hasMarker = (issue, m) => (issue.comments || []).some((c) => c.includes(m));

// A child is re-homed when one of its comments says so and names another issue by number.
export function rehomed(child) {
  return (child.comments || []).some((c) => {
    if (!REHOME_RE.test(c)) return false;
    return [...c.matchAll(REF_RE)].some((m) => Number(m[1]) !== child.number);
  });
}

// issue: {repo, number, title, body, state, stateReason, createdAt, closedAt, labels:[name], comments:[body],
//         closingPrs:[{merged}], landedPrs:[{repo, number, merged}] (from landedRefs), openChildren:[{number, comments:[body]}],
//         blockedBy:[ref] (blocked-by edges, read only when the body names a prerequisite)}
export function plan(issues, { now = Date.now(), days = 7, since: cutoff = SINCE } = {}) {
  const since = Math.max(Date.parse(cutoff), now - days * 864e5);
  const out = [];
  for (const i of issues) {
    const ref = `${i.repo}#${i.number}`;
    const isEpic = i.labels.includes("epic") || (i.openChildren || []).length > 0; // srs#256 had children but no `epic` label
    if (i.state === "CLOSED" && i.closedAt && Date.parse(i.closedAt) >= since) {
      if (isEpic) {
        if (i.stateReason !== "COMPLETED") continue;
        const orphans = (i.openChildren || []).filter((c) => !rehomed(c));
        if (orphans.length && !hasMarker(i, M.epic))
          out.push({ rule: "reopen-epic", ref, repo: i.repo, number: i.number, reopen: true,
            comment: `${M.epic}\nReopened by steward-check: this epic was closed while sub-issues are still open and not re-homed: ${orphans.map((c) => "#" + c.number).join(", ")}. Close it again once each is finished, or comment on each child saying where it moved (e.g. "re-homed to #123"). Re-closing after this comment is respected.` });
      } else if (i.stateReason === "COMPLETED" && !(i.comments || []).some((c) => RESET_RE.test(c)) && !i.labels.includes("no-code") && !(i.closingPrs || []).some((p) => p.merged) && !(i.landedPrs || []).some((p) => p.merged) && i.closer?.__typename !== "Commit" && !i.closer?.merged && !i.labels.includes("duplicate") && !hasMarker(i, M.noPr))
        out.push({ rule: "reopen-no-pr", ref, repo: i.repo, number: i.number, reopen: true,
          comment: `${M.noPr}\nReopened by steward-check: closed as completed within ${days} days but no merged pull request closes it, so the fix may only exist on a branch. Link the merged PR, or add the \`no-code\` label if no code was needed, then close it again. Re-closing after this comment is respected.` });
    }
    if (i.state === "OPEN" && !i.bot && i.createdAt && Date.parse(i.createdAt) >= since && !answersOf(i.body || "").stated && !(i.comments || []).some((c) => answersOf(c).stated) && !hasMarker(i, M.answers))
      out.push({ rule: "answers", ref, repo: i.repo, number: i.number, reopen: false,
        comment: `${M.answers}\nsteward-check: this issue has no \`Answers:\` line. State \`Answers: SP-nn\` or \`No affirmed problem yet: <one-line problem>\` in the description (see srs-programme CLAUDE.md, "Filing issues").` });
    if (i.state === "OPEN" && !i.bot && i.createdAt && Date.parse(i.createdAt) >= since && !hasMarker(i, M.prereq)) {
      const missing = prereqRefs(i.body, i.repo).filter((r) => r !== ref && !(i.blockedBy || []).includes(r));
      if (missing.length)
        out.push({ rule: "prereq-edge", ref, repo: i.repo, number: i.number, reopen: false,
          comment: `${M.prereq}\nsteward-check: this issue names ${missing.join(", ")} as a prerequisite in text only. Record each as a blocked-by edge so the board sees it (a parked blocker of ranked work then reaches the owner's desk): ${missing.map((m) => `\`clerk board dep add ${ref} ${m}\``).join(", ")}.` });
    }
  }
  return out;
}

// ---- thin gh layer ----
function gh(args, input) {
  const r = spawnSync("gh", args, { encoding: "utf8", input, timeout: 60000, maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 3).join(" ")} failed: ${r.stderr || r.error}`);
  return r.stdout;
}
// Repo-scoped REST only (cloud sessions refuse GraphQL and search): the window's issues, then per closed issue its timeline
// (closing PRs, commit closer) and, for epics, its sub-issues. Shapes match what plan() reads.
const comments = (OWNER, repo, n) => list(`repos/${OWNER}/${repo}/issues/${n}/comments?per_page=100`).map((c) => c.body);

// A named ref is evidence only as a merged PR; an issue number (404 on pulls) or any read failure is not.
function mergedPr(OWNER, { repo, number }) {
  try { return Boolean(get(`repos/${OWNER}/${repo}/pulls/${number}`)?.merged_at); } catch { return false; }
}

export function fetchIssues(repo, days, cutoff = SINCE, OWNER) {
  const since = new Date(Math.max(Date.parse(cutoff), Date.now() - days * 864e5)).toISOString().slice(0, 10);
  const inWindow = (t) => t && t.slice(0, 10) >= since;
  return issuesSince(`${OWNER}/${repo}`, since).filter((n) => inWindow(n.closed_at) || inWindow(n.created_at)).map((n) => {
    const labels = names(n.labels), state = n.state.toUpperCase();
    const subTotal = n.sub_issues_summary?.total ?? 0;
    const openChildren = state === "CLOSED" && (labels.includes("epic") || subTotal > 0)
      ? list(`repos/${OWNER}/${repo}/issues/${n.number}/sub_issues?per_page=100`).filter((c) => c.state === "open")
        .map((c) => ({ number: c.number, comments: comments(OWNER, repo, c.number) }))
      : [];
    const { closingPrs, closer } = state === "CLOSED" ? closers(OWNER, repo, n.number) : { closingPrs: [], closer: null };
    const cs = n.comments ? comments(OWNER, repo, n.number) : [];
    const landedPrs = state === "CLOSED" ? landedRefs(cs, repo).map((r) => ({ ...r, merged: mergedPr(OWNER, r) })) : [];
    // Edges are read only where the text names a prerequisite (one REST call per such open issue).
    const blockedBy = state === "OPEN" && prereqRefs(n.body, repo).length
      ? list(`repos/${OWNER}/${repo}/issues/${n.number}/dependencies/blocked_by?per_page=100`).map((b) => `${b.repository_url?.split("/").pop() ?? repo}#${b.number}`)
      : [];
    return { repo, number: n.number, title: n.title, body: n.body, state, stateReason: n.state_reason?.toUpperCase() ?? null,
      createdAt: n.created_at, closedAt: n.closed_at, labels, comments: cs, blockedBy,
      closingPrs, landedPrs, closer, bot: n.user?.type === "Bot", openChildren };
  });
}

function apply(a, OWNER) {
  const base = `repos/${OWNER}/${a.repo}/issues/${a.number}`;
  if (a.reopen) gh(["api", "-X", "PATCH", base, "-f", "state=open"]);
  gh(["api", "-X", "POST", `${base}/comments`, "-f", `body=${a.comment}`]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const fix = argv.includes("--fix");
  const di = argv.indexOf("--days");
  const si = argv.indexOf("--since");
  const cutoff = si >= 0 ? argv[si + 1] : SINCE;
  if (Number.isNaN(Date.parse(cutoff))) { console.error("--since needs an ISO date"); process.exit(2); }
  const days = di >= 0 ? Number(argv[di + 1]) : 7;
  if (!(days > 0)) { console.error("--days needs a positive number"); process.exit(2); }
  let settings; try { settings = loadSettings(repoRoot()); } catch (e) { console.error("steward: " + e.message); process.exit(2); }
  const OWNER = settings.githubOwner;
  let failed = 0, n = 0;
  for (const repo of settings.repos) {
    let issues;
    try { issues = fetchIssues(repo, days, cutoff, OWNER); } catch (e) { console.error(`${repo}: ${e.message}`); failed++; continue; }
    for (const a of plan(issues, { days, since: cutoff })) {
      n++;
      console.log(`${fix ? "ACT " : "WOULD"} ${a.rule.padEnd(12)} ${a.ref}${a.reopen ? " (reopen)" : ""}`);
      if (fix) try { apply(a, OWNER); } catch (e) { console.error(`${a.ref}: ${e.message}`); failed++; }
    }
  }
  console.log(`${n} action(s)${fix ? "" : " (dry run; --fix to act)"}, ${failed} failure(s)`);
  process.exit(failed ? 1 : 0);
}
