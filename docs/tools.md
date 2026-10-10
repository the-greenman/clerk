# Tools

Everything the programme runs, in one place. Programme data lives in srs-programme; code lives here. Scripts take `--repo <programme path>` (default: current directory) where they read the programme repo.

## Commands (`node bin/clerk.mjs <name>`, or `clerk <name>` when linked)

| Command | Purpose | Trigger | Reads | Writes | Called by |
|---|---|---|---|---|---|
| (none) / `session` / `comment` | Hold a session or post comments, by role | Human or agent | programme repo, GitHub PRs and issues | session/comment records via srs CLI, a signed PR | owner, `scripts/session`, `/session` |
| `help` | List subcommands | Human | | | |
| `settings` | Print the programme settings record (`--json`; bash: `clerk settings --json \| jq -r .githubOwner`) | Human; scripts | programme `com.semanticops.programme/programme` record | nothing | every script below |
| `roadmap` | Derive epic priority from the period ranking | Human; workflows | programme records | with `--apply --yes`: board priority, `parked` label | derive-priority.yml, pages.yml |
| `queue` | Report what the unattended lane would take next | Human | GitHub issues and PRs (settings `governed_repos`) | nothing | unattended-worker routine brief |
| `upkeep` | Merge or update PR branches by gate label | Every 15 min | GitHub PRs | merges, branch updates, digest comment on the settings `digest_issue` | pr-upkeep.yml |
| `steward` | Guard against false closes | Daily | closed issues (settings `governed_repos`) | with `--fix`: reopen and comment | srs-programme `derive-priority.yml` (daily 06:15, `--fix`); owner |
| `check` | Method rules: two poles per tension, one tension per principle, boundaries | CI, human | programme records | nothing | owner |
| `conformance` | Programme repo is an SRS repo and validates | CI | programme repo | nothing | validate.yml |
| `board` | Story-driven priority on GitHub Project #5 (`gh-project.mjs`) | Hourly; human | issues, board | board fields, mirror labels, comments | board-sync.yml, roadmap |
| `routines` | Drift between cloud triggers (a dump from the RemoteTrigger `list`), standing-job records and `routines/*.md`: `routines --check <dump.json> [--repo <programme>] [--json]`; exit 1 on any drift but stale check-ins | Human; `/routines`, `/session` | trigger dump, programme standing-job records, `git ls-files routines/` | nothing | owner |
| `wt` | Create, list, prune git worktrees | Human | git | worktrees | `scripts/session`, owner |
| `fetch-srs` | Download the pinned srs CLI, print `SRS_CLI_PATH=` | Human; CI | `.github/workflows/validate.yml` of the programme repo | `/tmp/srs-cli` | every script and workflow needing srs |

## Scripts (`scripts/`)

| Script | Purpose | Reads | Writes | Called by |
|---|---|---|---|---|
| roadmap.mjs, queue.mjs, steward-check.mjs, check-method.mjs, check-programme-conformance.mjs, fetch-pinned-srs.mjs, gh-project.mjs, pr-upkeep.sh, wt | Behind the commands above | see above | see above | `clerk <name>` |
| lib/pinned-srs.mjs, lib/repo-arg.mjs | Pin lookup; `--repo` resolution | programme `validate.yml` | | scripts |
| session | Fresh programme worktree, pinned srs, then open the clerk | srs-programme master | a worktree | owner, `/session` (`.claude/commands/session.md`) |
| routines.mjs | Behind `clerk routines` (logic in `lib/practice/routines.mjs`) | see above | nothing | `clerk routines` |
| *.test.mjs, pr-upkeep.test.sh | Tests (`npm test`) | fixtures | | CI |

## Settings

Nothing programme-specific is hard-coded. `lib/adapters/settings.mjs` reads the one `com.semanticops.programme/programme` record (title, github_owner, governed_repos, report_issue, digest_issue, board_project, board_story_repo, owner_actor) from the programme repo; `--repo` picks it. Env wins where CI needs it: `gh-project.mjs` uses `GHP_OWNER`, `GHP_PROJECT`, `GHP_STORY_REPO`, `GHP_MIRROR_REPOS` first and reads settings (from `CLERK_REPO` or the cwd) only for what is unset. The programme repo's own slug, worktree base (`~/dev/.wt/<name>`) and default branch are derived from its git remote. Still hard-coded, as working-group settings for a later step: the four WG repos in `bin/clerk.mjs` and the WG constants at the top of `scripts/pr-upkeep.sh`. 

## Packages

Canonical source of the methodology packages, installed into the programme repo with `srs package install packages/<name> --repo <programme>` (provenance in `.srs-import/`).

| Package | Namespace | Version | Holds | Upstream |
|---|---|---|---|---|
| `packages/method` | com.semanticops.method | 1.0.0 | problems, remedies, tensions, principles, archetypes | clerk (this copy) |
| `packages/governance` | com.mudemocracy.governance | 1.1.0 | decisions, roles, logs | muDemocracy.org `muSrs/packages/governance` (same id and version; differs only in key order) |
| `packages/stewardship` | com.mudemocracy.stewardship | 0.1.0 | agents, standing jobs (optional `routine_id`, `brief_path`), run reports | muDemocracy.org `muSrs/packages/stewardship` (the programme's install also carries imported com.thesystem fields) |
| `packages/programme` | com.semanticops.programme `methodology` | 0.1.0 | the `programme` settings type and its fields | clerk (this copy) |

The live methodology types (period, objective, epic, stakeholder, session and the relation types serves, responds-to, ratifies, considers, sets-aside, attended-by, receives) are still defined in srs-programme's primary package (`com.semanticops.programme` `primary`, 1.0.0) and will move into `packages/programme` in a later step.

Export a deterministic bundle (not committed; `dist/` is git-ignored):

    srs package export --repo <programme> --selector packages/<name> --published-at 2026-10-10T00:00:00Z --output dist/<name>.srspkg

## Workflows

Reusable (`on: workflow_call`) in `.github/workflows/`; the programme repo holds thin callers (`examples/programme-workflows/`, exactly what to copy) that own the triggers, concurrency and `secrets: inherit`. Each checks out the caller, then the clerk into `.clerk/` at the `clerk-ref` input, which the caller sets to the same SHA as in its `uses:` line (a reusable workflow cannot reliably learn its own pinned ref). Bump both together. The srs CLI pin `SRS_RUST_CLI_TAG` stays in the caller's `validate.yml`.

| Workflow | Purpose | Caller trigger | Runs | Secrets | Writes |
|---|---|---|---|---|---|
| programme-validate.yml | Conformance gate | push, PR | srs `repo validate`, `conformance`, `check`, `roadmap --json` | GITHUB_TOKEN | nothing |
| programme-derive-priority.yml | Apply roadmap priority; daily steward check | push, daily 06:15, dispatch | `roadmap --apply --yes`; `steward --fix` when not a push | BOARD_TOKEN | epic priority, `parked`, reopened issues |
| programme-pr-upkeep.yml | Keep PRs moving, daily digest | every 15 min, 07:20 digest, push, workflow_run, dispatch | `upkeep` | BOARD_TOKEN | merges, digest |
| programme-pages.yml | Publish `roadmap/` with generated roadmap.json | push, dispatch | `roadmap --json` | GITHUB_TOKEN | Pages |
| programme-board-sync.yml | Promote intents, reconcile board and labels | push, hourly, dispatch | `board sync` (project, story repo, mirror repos from settings) | BOARD_SECRET or BOARD_TOKEN | labels, board |
| test.yml (clerk) | The clerk's own tests | push, PR | `npm test` | | nothing |

## Routines (cloud, briefs in `routines/`; lifecycle in [routines.md](routines.md))

| Routine | Purpose | Trigger | Reads | Writes |
|---|---|---|---|---|
| unattended-worker.md | Ship `lane:unattended` issues as PRs | nightly 00:00 UTC, `trig_01GcbJwYyVfVTAekgYkAxFpJ` | issues (`ready` + lane), `queue` rules | branches, PRs, `status: in progress`, `needs-input` |
| wg-steward.md | Daily cycle close: report, minutes | 11:30 UTC, `trig_015iT3SoLLvJmgADknC7RpfG` | merged PRs, issues | run-report records, a PR, comment on the report issue |
| wg-analyst.md | Analyse and feed the group queue | 12:00 UTC, `trig_01M6mtE5wZJg2FeXFFnZjCSk` | issues, programme records | suggestions and issues |
| wg-builder.md | Build one `wg:third-party-ready` issue | event: issue labelled `ready` / PR merged | issue | branch, PR |
| wg-reviewer.md | Review one PR, post quorum | event: PR opened/synchronize/labeled | PR | quorum comment, `gate:auto-merge` |
| working-groups.md | Overview of the group's rules | | | |

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
