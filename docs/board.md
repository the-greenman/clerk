# The board

How issues are prioritised, queued and tracked on GitHub Project #6 "SemanticOps". Everything here is checked against `scripts/gh-project.mjs` (run `clerk board help`). The label contract (who writes and reads each label) is in [tools.md](tools.md#label-contract); this page covers what that table lacks.

Stories and epics live in the story repo, `the-greenman/semanticops.com` (settings `board_story_repo`). Implementation issues live in any governed repo. Everything goes through the GitHub API, so nothing depends on a sibling checkout.

## The tool

`gh-project.mjs` is one zero-dependency Node file wrapping `gh` (or `curl` with `GITHUB_TOKEN`/`GH_TOKEN`). Run it as `clerk board <command>` from a programme checkout, or `node scripts/gh-project.mjs <command>` with `GHP_*` env set. It finds the project's field, option and iteration IDs itself; never hard-code them (`fields` dumps them).

| Command | One line |
|---|---|
| `fields`, `ensure-fields` | Dump field/option/iteration IDs; create the MoSCoW field if missing |
| `ensure-labels [--repo R]` | Create the mirror label set in every mirror repo (or one) |
| `board [--repo --status --iteration --open]` | List board items |
| `add <repo> <#>` | Put an issue on the board |
| `stories sync` | Add open `user-story` issues to the board |
| `story set <#> --moscow M` | Set a story's MoSCoW |
| `tree [<#>]` | Sub-issue tree for one story or epic, or the whole board by epic |
| `rollup [--fix]` | Derive implementation priority (dry run unless `--fix`) |
| `summary`, `explain <repo> <#>` | All estimates with the stages; one issue stage by stage |
| `coverage` | JSON audit: bugs, orphans, uncovered stories, stories under no epic, unsized issues |
| `epics` | Epics in feed order with coverage and flags |
| `epic set <#> --priority P` | Write an epic's Priority (see below: do not use by hand) |
| `epic add-story <epic#> <story#>` | Link a story under an epic |
| `link <parent>#<n> <child>#<n>` | Sub-issue link, cross-repo, REST |
| `dep add\|rm <blocked>#<n> <blocker>#<n>` | Native blocked-by edge, cross-repo, REST |
| `set <repo> <#> [--status --priority --iteration]` | Write board fields |
| `size <repo> <#> <small\|medium\|large\|xl>` | Set effort (label and Size field) |
| `bands [--count N --tree --assign]` | Implementation order in equal-effort bands |
| `topup [--fix] [--target N]` | Nominate Backlog leaves with `promote:ready` |
| `promote [--fix]` | Turn `promote:ready` intents into Status=Ready |
| `stale-claims [--hours N] [--fix]` | Recover dead `In progress` claims |
| `reconcile [--fix]` | Report and repair drift |
| `sync [--dry-run]` | The whole hourly pipeline in one process |

Write commands are dry runs unless given `--fix` (`sync` writes unless `--dry-run`). Do not run them to test.

## Priority model

```
EPIC   (story repo, label epic, title "Epic NN: Name")   Priority P0/P1/P2, from clerk roadmap
  |  sub-issues
USER STORY   (label user-story)                           MoSCoW Must/Should/Could/Won't, set by a human
  |  sub-issues, cross-repo
IMPLEMENTATION ISSUE   priority: Pn label + board Priority   derived, never hand-set
```

**Epic priority is never hand-set.** `clerk roadmap --apply` writes it from the srs-programme period/objective ranking (rank 1 is P0, 2 is P1, 3 and below P2). An epic that serves no ranked objective gets the `parked` label. `epic set` exists but it is the writer `roadmap` uses, not a human input; a hand-set value is overwritten on the next apply.

The tool derives each implementation issue's priority in stages (`explain` walks one issue through them):

| Stage | Rule |
|---|---|
| served stories | Walk sub-issues up to the stories the issue serves |
| MoSCoW to P | Must P0, Should P1, Could P2, blank counts as Could, Won't excludes |
| base | The highest P across served stories |
| epic fallback | No story: inherit the claiming epic's Priority one tier down (P0 to P1, P1 and P2 to P2; blank epic is P2). A node under two epics goes to the higher-Priority epic |
| bug floor | A `bug` is never weaker than P1 |
| default floor | No story, no epic, not a bug: P2, still flagged as an orphan until linked |
| bump | One tier up (cap P0) for `critical-path`, `blocks-gate`, `regression` |

Blank never hides work. The only exclusions are an explicit Won't on every served story, and `parked`: the issue's own `parked` label, or a parked claiming epic. The bug floor still applies to parked bugs. Orphans are flagged in `rollup`, `coverage` and `reconcile` until linked.

Epics order everywhere (feed, `epics`, `tree`) by Priority tier, then started epics first, then the `NN` in the title, then issue number. An epic is started once any descendant is In progress, In review, Done or closed. Ready does not count. Retitle the epic to renumber; a title with no `NN` is flagged `missing-roadmap-number` and sorts last in its group.

An epic is a release: membership is whatever the epic reaches in the sub-issue graph. There is no Release field or label (`release-sync` and `epic set --release` are refused). See `tree <epic#>` and `summary --epic <epic#>`.

Link at creation: whoever files an implementation issue parents it under the story or epic it serves in the same session (`link`, or REST: `POST repos/<owner>/<parent-repo>/issues/<parent#>/sub_issues` with `sub_issue_id` set to the child's issue `id`). If no parent clearly applies, say so in the summary so `coverage` surfaces it.

## Status lifecycle

`Backlog`, `Ready`, `In progress`, `In review`, `Done`. What each means, and the moves between them, is the `work_item` lifecycle in the clerk's programme package (decision f58db200); what stops an item (needs-input, blocked, parked) is the `work_hold` vocabulary. The column and label names are the programme's `label-binding` records, which every clerk command reads (`lib/adapters/workflow.mjs`). `reconcile --fix` moves any closed issue not already Done to Done, an open one still in Done back to Backlog (reopened), and a claimed one still in Backlog or Ready to In progress (a claim label, written over REST, wins over an earlier column).

Iterations are delivery windows. GitHub has no API to create them: add them in the project UI, and the tool only assigns existing ones (`set --iteration`).

## Sizing and bands

Size is an input, not derived: `size` writes the `size: <v>` label and the board Size field (small S, medium M, large L, xl XL; the field write is best-effort). `coverage` and `reconcile` report unsized leaves.

`bands [--count N]` (default 10) lists the leaves in implementation order (epic rank, then derived priority, then sub-issue position) and cuts it into N bands of equal effort, weighting by size (unsized counts as medium). Leaves under no epic trail as an unlinked group. `--assign` writes band k into the number field `Band`, which you must create in the UI first; it does not touch Iteration.

## Promotion pipeline

Readiness is split into judgment and a privileged write, so cloud routines (REST only, no Projects v2) never fight the mirror:

1. **Intent.** A judge (`topup`, a human, a rule, a routine) writes the `promote:ready` label on an issue it deems unblocked. It never writes `ready` or Status.
2. **Promote.** `promote --fix`, run where Projects v2 is reachable (the board-sync workflow, or locally), sets every open Backlog issue with the intent to Status=Ready, mirrors `ready`, and clears the intent. It never demotes: issues already Ready, further along, or closed just lose the stale intent.

**Auto-topup.** `topup` keeps the consumable Ready queue at a target depth: default 6, overridden by `--target N` or `GHP_TOPUP_TARGET` (a target of 0 or less does nothing). The count is open non-bug issues that are Status=Ready or carry the intent, minus `needs-input`. It nominates the top `target - count` candidates: open work items (not epic, plan or story) in Backlog or with no Status, not blocked (open edges, else the `blocked` label), not `needs-input`, not already intended, not a `bug`, not excluded by Won't or `parked`. Candidates go in implementation order: epic Priority, started epics first, `NN` prefix, issue priority, sub-issue position. So a started epic drains before the next opens. `sync` runs topup before promote, so intents land the same run.

## The plain-label mirror

Cloud routines cannot read Projects v2 through the web-session proxy, so the board is mirrored to labels they can read and write. The set comes from the programme's label bindings: the Ready, In progress and In review labels, the priorities, the promote request, `blocked` and `needs-input`. (Size labels are created separately, by `size`.)

| Board field | Label | Written by |
|---|---|---|
| Priority P0/P1/P2 | `priority: Pn` | `rollup --fix`, `reconcile --fix`, `set --priority` |
| Status Ready | `ready` | `promote`, `reconcile --fix`, `set --status` |
| Status In progress | `status: in progress` | `clerk claim` (and so any routine claiming), `reconcile --fix`, `set --status` |
| Status In review | `status: in review` | `stale-claims` (an open PR closes the issue), `reconcile --fix` |

`reconcile --fix` repairs drift: open Ready or In progress items get the matching label, every other status and every closed issue has both cleared (`status-mirror-stale`); a stale `priority:` label is rewritten (`rollup-stale`). Self-healing: `ensure-labels`, `rollup --fix`, `reconcile --fix`, `topup --fix` and `promote --fix` create any missing mirror label in every mirror repo first, so a routine's `--add-label` cannot hit a missing label. `blocked` and `needs-input` have no board field; they are plain labels.

## Dependencies

Blocking is a native GitHub blocked-by edge, writable over REST, cross-repo within the owner.

    clerk board dep add srs-web#116 srs-rust#330     # srs-web#116 is blocked by srs-rust#330
    clerk board dep rm  srs-web#116 srs-rust#330
    # REST: POST repos/<owner>/<blocked-repo>/issues/<n>/dependencies/blocked_by  with issue_id = blocker's issue id

If an issue has any edge, `blocked` is derived: `reconcile` sets it while a blocker is open and clears it when the last closes. With no edge it is human-owned (non-issue blocks) and the tool leaves it. `topup` checks edges directly, so an unblocked issue is feedable on the next run. Blocked-by is the only relation the tooling adopts; build order inside an epic is sub-issue position.

## Stale claims and needs-input

Nothing else revisits an In progress issue, so `stale-claims` does. It looks at open issues claimed by the `status: in progress` label or board Status, and reads each timeline for the claim time and the last real activity (a comment, or a commit or PR reference; the hourly label churn does not count). Age runs from the later of the two.

| Case | Action |
|---|---|
| `needs-input` label | Never touched; reported |
| An open PR closes the issue | Board Status to In review, the claim label replaced by the In review label, one comment; never reclaimed however old |
| In review, and no PR that would close it is open any more (closed unmerged) | Status to Ready, `ready` label set, comment |
| Claim time unresolvable (or PR lookup failed) | Reported `unknown`; no change |
| Idle at or over the threshold (default 3h, `--hours N`) | Status to Ready, `ready` label set, comment; if the owner is assigned and the latest `Claimed by <actor>` comment names an actor other than `owner_actor`, the owner is unassigned (an agent claim never assigns, clerk#68) |
| Otherwise | Left alone |

**needs-input.** A session that hits a human gate cannot ask. It comments the specific question, adds `needs-input`, keeps its claim, and stops. The label keeps the issue out of topup, the Ready count and reclaim. A human answers in the comments and removes the label; the next sync feeds it again. To list them, filter a board view by `label:needs-input` (views are UI-only).

## The bug track

Bugs do not ride the feature feed: a P1 floor and an epic-major feed contradict each other. `topup` never nominates a `bug` and bugs do not count toward Ready. `label:bug` is the bug queue: derived priority label first (a bug with none counts as P1), oldest first. A bug consumer takes one at a time with the same claim, activity and `needs-input` rules. The bug floor, `coverage`'s bugs report, blocked semantics and stale-claim recovery all still apply.

## API budget

The hourly run is rate-limited, so call volume is a design limit.

- The whole board is one paginated GraphQL query, cached per process.
- Sub-issue edges are prefetched in batched GraphQL queries (about 40 issues each), transitive; if GraphQL is unavailable it falls back to per-issue REST.
- `sync` is the whole pipeline in one process on one fetch: stories-sync, rollup, topup, promote, stale-claims, reconcile. Each step patches the cache so later steps see earlier writes (reconcile must not undo promote). Never split it into per-step runs.
- Every subprocess has a timeout; a hung call fails the run and the next hour retries.

## Agents and humans

- **Humans** set story MoSCoW, link stories under epics and issues under stories, title epics (`Epic NN:`), add iterations, answer `needs-input`. Epic priority comes from the programme ranking, not from them.
- **Interactive agents** use the GitHub MCP for issues, labels, comments and sub-issues, and `gh-project` for board fields.
- **Cloud routines** use `gh` REST plus `gh-project` only: labels and `link`/`dep` writes, never Projects v2.
- **`gh-project` is the only writer of Projects v2 fields** (Status, Priority, Iteration, MoSCoW, Size, Band).

## Where it runs

The srs-programme workflow `board-sync.yml` calls the clerk's reusable `programme-board-sync.yml`, which runs `clerk board sync`. Triggers (in the caller): push to the default branch, hourly, and `workflow_dispatch` (a session can label issues, then `gh workflow run board-sync.yml --repo the-greenman/srs-programme` to promote at once). Concurrency group `board-sync`, no cancel. It needs a PAT with `project` scope as the secret `BOARD_SECRET` (or `BOARD_TOKEN`); with neither it fails loudly rather than skipping.

The programme settings record supplies `GHP_OWNER` (`github_owner`), `GHP_OWNER_ACTOR` (`owner_actor`, so `stale-claims` can tell an agent claim from the owner's), `GHP_PROJECT` (`board_project`), `GHP_STORY_REPO` (`board_story_repo`) and `GHP_MIRROR_REPOS` (`governed_repos`); the workflow's `project`, `story-repo` and `mirror-repos` inputs override them. Env set directly beats settings. The script reads settings from `CLERK_REPO` or the cwd. There is one board-sync workflow, since it reconciles the whole cross-repo board; a copy elsewhere without its own secret would silently do nothing.

Related commands: [/triage, /stories, /roadmap](../.claude/commands/) are the agent workflows over this tool.
