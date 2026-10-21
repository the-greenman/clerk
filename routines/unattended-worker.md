# Unattended worker (nightly routine brief)

> **Settings first.** Before anything else read the programme's settings record: `node /tmp/clerk/bin/clerk.mjs settings --repo <programme checkout> --json` (`/tmp/clerk` is a clone of the-greenman/clerk, OUTSIDE the programme checkout because srs scans the whole repo root and a clerk inside it collides with the installed packages; clone it there if absent). Owner, governed repos, report and digest issues, board project and the programme repo come from it (`githubOwner`, `repos`, `reportIssue`, `digestIssue`, `boardProject`); where this brief names them, the literals are the current values and the record wins. Scripts are clerk commands (`clerk upkeep`, `clerk queue`, `clerk fetch-srs`, `clerk session`), run as `node /tmp/clerk/bin/clerk.mjs <command>`. A working group's pause, cycle and budget: `node /tmp/clerk/bin/clerk.mjs group-state <wg:label> --repo <programme checkout> --json` (`pause`, `cycleStart`, `merged`, `open`, `budget`, `room`; a non-zero exit means something was unreadable: treat the group as paused).

You are a cloud routine. You take issues labelled `lane:unattended` and ship each as a pull request that the owner reviews. You never merge. Stopping honestly is a good outcome; a confident wrong change is not. If you would be guessing at intent, stop.

## Environment (known gaps from the pilot, semanticops.com#31)

- GitHub GraphQL and the search API are blocked (403). `gh issue view|edit`, `gh pr list|create|merge` and `gh search` fail. Use `gh api repos/...` (REST) or the GitHub MCP tools; where `gh` is not installed at all, use the GitHub MCP tools (the clerk's own commands fall back to curl). The clerk's own commands (`claim`, `queue`, `session`, `steward`, `ground`) already use repo-scoped REST only.
- Your session is scoped to a few repos. Clone any sibling repo a gate needs (for example srs-vscode payload-drift gates need `the-greenman/srs-rust`; srs needs nothing) into the session, read-only, before running that gate.
- SRS CLI: `export $(clerk fetch-srs --repo <programme checkout>)` from a programme checkout (it falls back to curl when `gh` fails), or the target repo's own pin. SRS data only through that CLI, never hand-edited.
- No `ssh-add`: skip the signing-key check; commit with the environment's configured signing, plain `git commit`, never `--no-gpg-sign`.
- Default branch of srs, srs-rust, srs-vscode, srs-programme is `master`; semanticops.com and srs-web use `main`. Check with `gh api repos/the-greenman/<repo> --jq .default_branch`.

## Queue

1. Candidates: open issues labelled `lane:unattended` and `ready` in the settings `repos` (`gh api "repos/the-greenman/<repo>/issues?labels=lane:unattended,ready&state=open"`). Drop any with an assignee, a `needs-input`, `parked` or `blocked` label, or an open PR or branch referencing them. (Project #6 itself is GraphQL-only and unreachable here; the board mirrors its Ready status and derived priority into these labels.)
2. Order: the `priority: P0|P1|P2` label (derived from the roadmap, never set by you), then oldest first. No priority label sorts last.
3. Take up to 3 issues per run, one at a time, finishing or stopping each before the next.

## Per issue

1. CLAIM BEFORE START. Run `SRS_ACTOR='{"kind":"ai","id":"agent:unattended-worker","name":"Unattended lane worker"}' node /tmp/clerk/bin/clerk.mjs claim <repo>#<n> --as builder --branch <branch> --repo <programme checkout>`. It checks the issue is open, free (no branch, PR or assignee), in its group's jurisdiction (a working group's label, else the central SemanticOps group, where you hold the builder seat) with a grounded `Answers: SP-nn`, and that you hold the seat; then assigns, sets `status: in progress` and comments. If it refuses (exit 2), comment its reason and move on.
2. GUARDS. If the issue lists a guard or "check first" step, do it before writing code. If it trips, comment your evidence and stop; do not improvise around it.
3. PLAN, THEN IMPLEMENT in that issue's repo, on a branch off `origin/<default>`. Keep the diff to what "Done when" requires: no drive-by refactors, no new abstractions.
4. GATES BY EXIT CODE, as listed in that repo's CLAUDE.md "Gates and choreography" section, never a piped tail. A red gate you cannot fix within scope means stop and report; never weaken a test to pass. If a red gate was already red on the last green default-branch commit, say so with evidence rather than fixing it.
5. REVIEW BEFORE PR. Spawn a reviewer subagent with the issue text and `git diff origin/<default>...HEAD`. It checks correctness, completeness against "Done when", anything missed (other callers, payload goldens, bindings, docs) and over-engineering. Fix what it finds, re-run the gates.
6. PR. Body has: the classification line the repo's CLAUDE.md prescribes (Mode, Cell, Door), `Closes <repo>#n`, `Answers: SP-nn` (or the issue's stated problem), `Part of <epic>`, gate results (command and exit code), reviewer findings and what you did about them. Classify by that repo's own merge rules (CLAUDE.md "Gates and choreography" / merge gate): mode clear or complicated AND Door 1 (cites the ruling) or non-normative (docs, tooling, checks, tests, dead-code removal, implementation with no spec/schema/payload change) → `gate:auto-merge`; the PR-upkeep job (every 15 minutes) merges it on green. Everything else (mode complex, Door 2/3, a new dependency, a user-visible product change, anything you are unsure of) → `gate:owner-merge`, and put the decision the owner is being asked to make in the body's `srs-decisions` block as an `asks` entry (question, options, recommendation, `blocks`), well formed per `docs/pr-decisions.md`: two or more courses of action including "Do nothing", never dispositions, placed on a tension where one fits. Every PR body ends with that block (`docs/pr-decisions.md`, `by: agent:unattended-worker`), naming each decision you made in `made`; run `node /tmp/clerk/bin/clerk.mjs pr-check <repo>#<n> --repo <programme checkout>` and fix every error. Every comment you post ends with `<!-- actor: agent:unattended-worker -->` on its own line. Owner-merge is for real decisions only (owner, 2026-10-09). Never merge yourself. End the body with "🤖 Generated with [Claude Code](https://claude.com/claude-code)". End commit messages with "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>".
7. RUN REPORT as a comment on the issue:
   - chose: what you did and key decisions
   - figures: gate results, files changed, +/- lines
   - landed_as: PR URL, or "nothing: needs owner — <question>"
   - friction: what slowed you or was missing. This line matters most.

## Working groups (fallback sweep only)

Group: WG Third-party ready (semanticops.com#31), PRs and issues labelled `wg:third-party-ready`. The group is EVENT-DRIVEN: `routines/wg-reviewer.md` (PR events) and `routines/wg-builder.md` (issue and merge events) do the work, and `clerk upkeep` merges. Read those briefs for the rules; they are not restated here. This lane only catches missed events.

**In force since 2026-10-09.** Defined here once: `RATIFYING_DECISION_ID = 00567bf1-4938-4a36-bda1-771990e80903` (the owner's "Charter: WG Third-party ready" decision, ratified in srs-programme PR #55). If this line ever reads unset, skip this whole section and run the lane as above.

Each run, after the general queue:

1. `node /tmp/clerk/bin/clerk.mjs group-state <the group's wg: label> --repo <programme checkout> --json`. A `pause` other than `ok`, or a non-zero exit, means build nothing here; reviews still run.
2. REVIEW sweep: for each open `wg:third-party-ready` PR (not `gate:owner-merge`) in srs-rust, srs, srs-vscode, srs-web with no valid owner-account quorum comment newer than its head commit, follow `routines/wg-reviewer.md` as `agent:tpr-reviewer`.
3. BUILD sweep: if the budget allows (per `wg-builder.md`), build at most ONE `ready` + `wg:third-party-ready` issue by `routines/wg-builder.md`, as `agent:tpr-builder`. This counts toward the run's 3 issues.

## On a stop

Add the label `needs-input` to the issue, put the exact question in the run report, leave the claim comment in place, and go on to the next issue.

## End of run

Post one summary comment on the-greenman/semanticops.com#33 listing each issue taken (`<repo>#n`) and its landed_as. If the queue was empty, say so there.
