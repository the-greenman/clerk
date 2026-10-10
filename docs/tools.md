# Tools

Everything the programme runs, in one place. Programme data lives in srs-programme; code lives here. Scripts take `--repo <programme path>` (default: current directory) where they read the programme repo.

## Commands (`node bin/clerk.mjs <name>`, or `clerk <name>` when linked)

| Command | Purpose | Trigger | Reads | Writes | Called by |
|---|---|---|---|---|---|
| (none) / `session` / `comment` | Hold a session or post comments, by role | Human or agent | programme repo, GitHub PRs and issues | session/comment records via srs CLI, a signed PR | owner, `scripts/session`, `/session` |
| `help` | List subcommands | Human | | | |
| `roadmap` | Derive epic priority from the period ranking | Human; workflows | programme records | with `--apply --yes`: board priority, `parked` label | derive-priority.yml, pages.yml |
| `queue` | Report what the unattended lane would take next | Human | GitHub issues and PRs (6 repos) | nothing | unattended-worker routine brief |
| `upkeep` | Merge or update PR branches by gate label | Every 15 min | GitHub PRs | merges, branch updates, digest comment on semanticops.com#33 | pr-upkeep.yml |
| `steward` | Guard against false closes | Daily | closed issues (6 repos) | with `--fix`: reopen and comment | owner |
| `check` | Method rules: two poles per tension, one tension per principle, boundaries | CI, human | programme records | nothing | owner |
| `conformance` | Programme repo is an SRS repo and validates | CI | programme repo | nothing | validate.yml |
| `board` | Story-driven priority on GitHub Project #5 (`gh-project.mjs`) | Hourly; human | issues, board | board fields, mirror labels, comments | board-sync.yml, roadmap |
| `wt` | Create, list, prune git worktrees | Human | git | worktrees | `scripts/session`, owner |
| `fetch-srs` | Download the pinned srs CLI, print `SRS_CLI_PATH=` | Human; CI | `.github/workflows/validate.yml` of the programme repo | `/tmp/srs-cli` | every script and workflow needing srs |

## Scripts (`scripts/`)

| Script | Purpose | Reads | Writes | Called by |
|---|---|---|---|---|
| roadmap.mjs, queue.mjs, steward-check.mjs, check-method.mjs, check-programme-conformance.mjs, fetch-pinned-srs.mjs, gh-project.mjs, pr-upkeep.sh, wt | Behind the commands above | see above | see above | `clerk <name>` |
| lib/pinned-srs.mjs, lib/repo-arg.mjs | Pin lookup; `--repo` resolution | programme `validate.yml` | | scripts |
| session | Fresh programme worktree, pinned srs, then open the clerk | srs-programme master | a worktree | owner, `/session` (`.claude/commands/session.md`) |
| *.test.mjs, pr-upkeep.test.sh | Tests (`npm test`) | fixtures | | CI |

## Workflows

Still in srs-programme unless noted; they call these scripts from the programme checkout, and move or repoint in a later phase.

| Workflow | Purpose | Trigger | Runs | Writes |
|---|---|---|---|---|
| validate.yml (programme) | Conformance gate; holds the srs pin `SRS_RUST_CLI_TAG` | push, PR | conformance, roadmap tests | nothing |
| derive-priority.yml (programme) | Apply roadmap priority | push to master, daily 06:15 | `roadmap --apply --yes` | epic priority, `parked` |
| pr-upkeep.yml (programme) | Keep PRs moving, daily digest | every 15 min, 07:20 digest, push | `upkeep` | merges, digest |
| pages.yml (programme) | Publish roadmap JSON | push | `roadmap --json` | Pages |
| board-sync.yml (srs-rust) | Promote intents, reconcile board and labels | hourly | `board sync` | labels, board |

## Routines (cloud, briefs in srs-programme `routines/`)

| Routine | Purpose | Trigger | Reads | Writes |
|---|---|---|---|---|
| unattended-worker.md | Ship `lane:unattended` issues as PRs | nightly 00:00 UTC, `trig_01GcbJwYyVfVTAekgYkAxFpJ` | issues (`ready` + lane), `queue` rules | branches, PRs, `status: in progress`, `needs-input` |
| wg-steward.md | Daily cycle close: report, minutes | 11:30 UTC, `trig_015iT3SoLLvJmgADknC7RpfG` | merged PRs, issues | run-report records, a PR, comment on semanticops.com#31 |
| (wg analyst) | Analyse and feed the group queue | 12:00 UTC, `trig_01M6mtE5wZJg2FeXFFnZjCSk` | issues, programme records | suggestions and issues |
| wg-builder.md | Build one `wg:third-party-ready` issue | event: issue labelled `ready` / PR merged | issue | branch, PR |
| wg-reviewer.md | Review one PR, post quorum | event: PR opened/synchronize/labeled | PR | quorum comment, `gate:auto-merge` |
| pilot31-ratify.md | Owner-run ratification steps | owner | | owner's records |

## Label contract

| Label | Written by | Read by |
|---|---|---|
| `ready` | board mirror (`board promote`/`reconcile`), never by hand | queue, unattended-worker, wg-builder, steward |
| `promote:ready` | `board topup` (intent) or the owner | `board promote`, which sets Status=Ready and the `ready` mirror |
| `priority: P0` / `P1` / `P2` | `board` (derived from stories and epics; epics from `roadmap`) | queue, unattended-worker (ordering) |
| `parked` | `roadmap --apply` (epic serves no ranked objective) | queue (held), `board` (excluded) |
| `needs-input` | a stopping routine; the human removes it | queue (held), `board` (never reclaimed), wg-steward |
| `lane:unattended` | owner or filing agent | queue, unattended-worker |
| `gate:auto-merge` | PR author per repo rule; wg-reviewer on approve | pr-upkeep (merge when clean) |
| `gate:owner-merge` | PR author or owner | pr-upkeep (keep up to date, never merge), clerk Merges section, wg budget (not counted) |
| `wg:third-party-ready` | owner or steward on issues; builder on PRs | queue (wg lane), wg-builder, wg-reviewer, pr-upkeep (quorum and budget), wg-steward |
| `status: in progress` | routine claiming an issue (mirror of board Status) | `board` reclaim, unattended-worker |

## Repo lists

The scripts disagree on the estate, to be unified from settings in Phase 2: queue.mjs and steward-check.mjs list 6 repos (semanticops.com, srs, srs-rust, srs-web, srs-vscode, srs-programme); gh-project.mjs `MIRROR_REPOS` lists 7 (srs, srs-rust, srs-web, srs-vscode, srs-context, srs-programme, plus the story repo); pr-upkeep.sh lists 8 (the six, srs-context, muDemocracy.org).

## Related tools elsewhere

- srs-context hooks (`srs-context/hooks`: session-start, prompt-context, usage-log) give agents project memory.
- srs-web governance shell (`src/lib/governance`) is the editor that will import `lib/practice`.
- srs-gov is retiring (clerk#7).
