#!/usr/bin/env node
// steward-check: daily guard against false closes (srs-programme#37, Answers SP-43).
//   node scripts/steward-check.mjs [--days N] [--since ISO] [--fix]      dry run is the DEFAULT; --fix acts.
// Rules, over the last N days (default 7), across the six SemanticOps repos:
//   reopen-no-pr   closed COMPLETED, not an epic, no merged closing PR, no `no-code` label -> reopen + comment
//   reopen-epic    epic (label `epic` or has sub-issues) closed with open sub-issues, unless every open child has a re-homing comment -> reopen + comment
// Closed by a Commit or a merged PR (timeline closer) also counts as landed; duplicates and bots are skipped.
//   answers        OPEN and opened without an `Answers:` / `No affirmed problem yet` line -> one comment
// Every comment carries a hidden marker, so reruns are idempotent; an issue that already carries our
// marker is never reopened again (a human who re-closes it has overruled us).
// plan() is pure (rows in, actions out); the gh I/O is the thin layer below. The gh helper pattern is
// copied from srs-rust/scripts/gh-project.mjs (separate repo, so a small copy rather than an import).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Go-forward only: history before this is never acted on (the weekly audit, srs-programme#38, reports it).
export const SINCE = "2026-10-09T00:00:00Z";
const RESET_RE = /Closed in the SemanticOps roadmap reset/;
export const REPOS = ["semanticops.com", "srs", "srs-rust", "srs-web", "srs-vscode", "srs-programme"];
const OWNER = "the-greenman";
const M = { noPr: "<!-- steward-check:reopen-no-pr -->", epic: "<!-- steward-check:reopen-epic -->", answers: "<!-- steward-check:answers -->" };
const ANSWERS_RE = /^[\s>*_-]*(answers|no affirmed problem yet)\b/im;
const REHOME_RE = /(re-?hom|moved to|moving to|tracked (in|by)|now (in|under|tracked))/i;
const REF_RE = /(?:[\w.-]+\/)?[\w.-]*#(\d+)/g;

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
//         closingPrs:[{merged}], openChildren:[{number, comments:[body]}]}
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
      } else if (i.stateReason === "COMPLETED" && !(i.comments || []).some((c) => RESET_RE.test(c)) && !i.labels.includes("no-code") && !(i.closingPrs || []).some((p) => p.merged) && i.closer?.__typename !== "Commit" && !i.closer?.merged && !i.labels.includes("duplicate") && !hasMarker(i, M.noPr))
        out.push({ rule: "reopen-no-pr", ref, repo: i.repo, number: i.number, reopen: true,
          comment: `${M.noPr}\nReopened by steward-check: closed as completed within ${days} days but no merged pull request closes it, so the fix may only exist on a branch. Link the merged PR, or add the \`no-code\` label if no code was needed, then close it again. Re-closing after this comment is respected.` });
    }
    if (i.state === "OPEN" && !i.bot && i.createdAt && Date.parse(i.createdAt) >= since && !ANSWERS_RE.test(i.body || "") && !(i.comments || []).some((c) => ANSWERS_RE.test(c)) && !hasMarker(i, M.answers))
      out.push({ rule: "answers", ref, repo: i.repo, number: i.number, reopen: false,
        comment: `${M.answers}\nsteward-check: this issue has no \`Answers:\` line. State \`Answers: SP-nn\` or \`No affirmed problem yet: <one-line problem>\` in the description (see srs-programme CLAUDE.md, "Filing issues").` });
  }
  return out;
}

// ---- thin gh layer ----
function gh(args, input) {
  const r = spawnSync("gh", args, { encoding: "utf8", input, timeout: 60000, maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 3).join(" ")} failed: ${r.stderr || r.error}`);
  return r.stdout;
}
const gql = (query, vars) => JSON.parse(gh(["api", "graphql", "--input", "-"], JSON.stringify({ query, variables: vars }))).data;

const ISSUE_Q = `query($q:String!,$after:String){search(query:$q,type:ISSUE,first:50,after:$after){pageInfo{hasNextPage endCursor}
 nodes{... on Issue{number title body author{__typename} timelineItems(itemTypes:[CLOSED_EVENT],last:1){nodes{... on ClosedEvent{closer{__typename ... on PullRequest{merged}}}}} state stateReason createdAt closedAt labels(first:30){nodes{name}} comments(last:100){nodes{body}}
 subIssuesSummary{total} closedByPullRequestsReferences(first:10,includeClosedPrs:true){nodes{merged}}}}}}`;
const CHILD_Q = `query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){subIssues(first:100){nodes{number state comments(last:30){nodes{body}}}}}}}`;

export function fetchIssues(repo, days, cutoff = SINCE) {
  const since = new Date(Math.max(Date.parse(cutoff), Date.now() - days * 864e5)).toISOString().slice(0, 10);
  const seen = new Map();
  for (const qual of [`closed:>=${since}`, `created:>=${since}`]) {
    let after = null;
    do {
      const { search } = gql(ISSUE_Q, { q: `repo:${OWNER}/${repo} is:issue ${qual}`, after });
      for (const n of search.nodes) if (n.number) seen.set(n.number, n);
      after = search.pageInfo.hasNextPage ? search.pageInfo.endCursor : null;
    } while (after);
  }
  return [...seen.values()].map((n) => {
    const labels = names(n.labels.nodes);
    let openChildren = [];
    if (n.state === "CLOSED" && (labels.includes("epic") || n.subIssuesSummary.total > 0))
      openChildren = gql(CHILD_Q, { o: OWNER, r: repo, n: n.number }).repository.issue.subIssues.nodes
        .filter((c) => c.state === "OPEN").map((c) => ({ number: c.number, comments: c.comments.nodes.map((x) => x.body) }));
    return { repo, number: n.number, title: n.title, body: n.body, state: n.state, stateReason: n.stateReason,
      createdAt: n.createdAt, closedAt: n.closedAt, labels, comments: n.comments.nodes.map((c) => c.body),
      closingPrs: n.closedByPullRequestsReferences.nodes, closer: n.timelineItems.nodes[0]?.closer || null, bot: n.author?.__typename === "Bot", openChildren };
  });
}

function apply(a) {
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
  let failed = 0, n = 0;
  for (const repo of REPOS) {
    let issues;
    try { issues = fetchIssues(repo, days, cutoff); } catch (e) { console.error(`${repo}: ${e.message}`); failed++; continue; }
    for (const a of plan(issues, { days, since: cutoff })) {
      n++;
      console.log(`${fix ? "ACT " : "WOULD"} ${a.rule.padEnd(12)} ${a.ref}${a.reopen ? " (reopen)" : ""}`);
      if (fix) try { apply(a); } catch (e) { console.error(`${a.ref}: ${e.message}`); failed++; }
    }
  }
  console.log(`${n} action(s)${fix ? "" : " (dry run; --fix to act)"}, ${failed} failure(s)`);
  process.exit(failed ? 1 : 0);
}
