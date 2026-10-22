# Tools

Everything the programme runs, in one place. Programme data lives in srs-programme; code lives here. Scripts take `--repo <programme path>` (default: current directory) where they read the programme repo.

## Commands (`node bin/clerk.mjs <name>`, or `clerk <name>` when linked)

| Command | Purpose | Trigger | Reads | Writes | Called by |
|---|---|---|---|---|---|
| (none) / `session` / `comment` | Hold a session or post comments, by role | Human or agent | programme repo, GitHub PRs and issues | session/comment records via srs CLI (each act's time, agenda position and what was seen: listed in the session `summary`, held per act in a linked `acts.json` source document), a signed PR | owner, `scripts/session`, `/session` |
| `help` | List subcommands | Human | | | |
| `desk` | The owner's desk: `desk --repo <programme> [--post [--dry-run]]` prints the body of the one pinned issue labelled `desk` (Needs you, Threads, Running fine); `--post` rewrites that issue's body in place (REST PATCH, never a comment), `--dry-run` prints what it would write; `--json` prints the desk as data for clients (the body, Needs you and Threads as rows, each open PR with its conversation, files and the decision records its diff adds, epics with their tasks, PRs closed in the last `CLERK_CLOSED_DAYS` (14)) and never posts. Exit 1 when the settings `digest_issue` repo has no open `desk` issue or more than one; it never creates one. No role needed (logic in `lib/practice/desk.mjs`) | Daily; human | decision log, run reports, exercises, groups and their pause state, roadmap epics (programme records); open PRs, quorum comments, sub-issue parents, issues assigned to the owner (less those labelled `status: in progress`, which someone has claimed) or labelled `needs-input`, the report issue (gh REST) | with `--post`: the `desk` issue body | owner; the daily upkeep run once its `desk --post` step is added (clerk#64) |
| `serve` | The local service for web clients such as the srs-lab control room ([service.md](service.md); contract `api/openapi.json`): `serve --repo <programme>`, on a literal loopback address only, answering only its own `Host` names (`CLERK_HOSTS` adds published ones). Each read runs the command of the same name; the sync job fast-forwards the programme and the clerk when clean and rewrites the programme snapshot (`CLERK_SYNC_MINUTES`, 5) and the desk snapshot (`CLERK_DESK_MINUTES`, 30). `POST /api/sync` needs the `x-control-room` header | Always on (systemd user unit); human | everything the read commands read; the programme and clerk checkouts | `CLERK_STATE_DIR` (`~/.local/state/clerk`): snapshots, `sync.json`, a lock, `acts.jsonl`; `git pull --ff-only` on clean checkouts | owner; the srs-lab control room |
| `snapshot` | The programme as one snapshot: records with field values, relations, containers with their ordered outlines (`--json`) | `clerk serve`; human | programme records (srs CLI) | nothing | `clerk serve` |
| `groups` | Print the working groups chartered in the records (`--json`; bash: `clerk groups --json \| jq -r '.[].label'`) | Human; `queue` | `governance/role` records with a `group_label`, the agents `authorised-by` them, the group's log container | nothing | every group-aware script |
| `labels` | Every governed repo's labels against the programme's label bindings: missing labels, stale descriptions (the definition's first sentence), retired labels still present with their open items, unknown labels. `--apply` creates missing labels and rewrites stale descriptions (never touches an item); per repo, with `--repo-name <r>` and the owner's confirmation, `--migrate` moves open items from a retired label to its successor, then `--delete-retired` deletes the retired labels no open item carries. Exit 1 on drift | Human; `doctor` warns on missing labels | the work-status set and bindings, settings `repos`, groups, each repo's labels and open items | with `--apply` / `--delete-retired`: labels and issue labels | owner |
| `charter` | Charter a working group as draft/proposed records for the owner to ratify: `charter --repo <programme> --title --epic --label --repos --budget --cycle-close --quorum-seats --required-seat [--quorum-min --max-unacked --prefix --from <role id>] [--dry-run]` (handbook stage 10) | Human or orchestrator session | existing groups, the SemanticOps decision log, Suggestions, the compass of the group it copies | via the srs CLI as `SRS_ACTOR`: log, container, role, 4 articles, agents, boundary, charter decision (proposed, also in the SemanticOps log), relations; never `delegates` | owner session |
| `domains` | Every domain's focus, its boundary and the tensions that emerge from it, both poles side by side with their shadows, the principles leaning on each and the problems concerning each (clerk#129, SP-98). A boundary `derived-from` a domain is merged into it (a domain is a boundary, owner ruling 2026-10-22); a group's compass boundary is a context of its own that serves its role's `holds-domain`; any other boundary is untraced; a tension in none has lost its context. Each tension's line is the Stance tension its poles `refine`; two on one line are flagged "a duplicate, or an inner/outer pair?", never judged. `domains [--json]`; `domains affirm-tension <id> [--reason] [--dry-run]` forks the tension and both poles into Affirmed in one act, never a pole alone; `domains place-axes <domain> <t1> <t2> <t3> [--dry-run]` makes them the domain container's first three tensions, creating the container when missing (members add/move, never `container update`). Ids take an 8-character prefix (logic in `lib/practice/domain-field.mjs`) | Human; the srs-lab control room | programme records, relations, domain containers, groups | acts only: forks, comment, domain container entries, via the srs CLI as `SRS_ACTOR` | owner, control room affirmation rounds |
| `settings` | Print the programme settings record (`--json`; bash: `clerk settings --json \| jq -r .githubOwner`) | Human; scripts | programme `com.semanticops.programme/programme` record | nothing | every script below |
| `roadmap` | Derive epic priority from the period ranking | Human; workflows | programme records | with `--apply --yes`: board priority, `parked` label | derive-priority.yml, pages.yml |
| `claim` | Claim an issue as a seat of its group (a chartered group by its label; unlabelled work belongs to the central group, SemanticOps): `claim <repo#n> --as <seat> [--repo <programme>] [--branch <name>] [--dry-run]` (handbook stage 11); exit 2 with the reasons if refused. Refused when already assigned, labelled `status: in progress`, or carrying an open claim comment (a `Claimed by <actor>` comment with no later removal of that label). Only the owner's own actor (settings `owner_actor`) assigns the owner's account; any other actor claims with the label and the comment only, and `--dry-run` says which | Human, local session or routine | the issue and its timeline, open PRs and branches (gh REST), `clerk groups`, the Affirmed problems | assignee (owner's claim only), `status: in progress` label, claim comment `Claimed by <actor> as <seat> of <group> (clerk claim). Branch: <branch>.` (gh REST) | wg-builder, unattended-worker |
| `queue` | Report what the unattended lane would take next (`--json` for data) | Human | GitHub issues and PRs (settings `governed_repos`) | nothing | unattended-worker routine brief |
| `upkeep` | Merge or update PR branches by gate label; a group PR merges only on a quorum for its head commit, within budget, not paused (rules: `lib/practice/upkeep.mjs`); the digest lists conflicts, ungated PRs and group waits (owner merges are on the desk) | Every 15 min | GitHub PRs | merges, branch updates, digest comment on the settings `digest_issue` | pr-upkeep.yml |
| `steward` | Guard against false closes (reopen a completed close with no merged PR, or an epic closed with open children). A merged PR named in a comment after `Landed` counts: `Landed: <repo>#<n>`, also `Landed via <repo>#<n>, #<m>` (a bare `#n` takes the repo of the ref before it on that line, else the issue's repo; refs run to the end of the line; each is checked merged via REST, so an issue number or an unmerged PR is no evidence; URLs are not read) and comment once on an open issue with no `Answers:` / `No affirmed problem yet` line | Daily | closed issues (settings `governed_repos`) | with `--fix`: reopen and comment | srs-programme `derive-priority.yml` (daily 06:15, `--fix`); owner |
| `check` | Method rules: two poles per tension, one tension per principle, boundaries; advisory: a domain with fewer than 3 axes placed | CI, human | programme records | nothing | owner |
| `conformance` | Programme repo is an SRS repo and validates | CI | programme repo | nothing | validate.yml |
| `board` | Story-driven priority on GitHub Project #6 (`gh-project.mjs`; how it works: [board.md](board.md)). `stale-claims` reclaims a silent claim to Ready and, when the issue is assigned to the owner and its latest `Claimed by <actor>` comment names an actor other than `owner_actor` (`GHP_OWNER_ACTOR` in CI), unassigns the owner; with no claim comment it leaves the assignee; slash commands `/roadmap`, `/stories`, `/triage` in `.claude/commands/` are the canonical copies | Hourly; human | issues, board | board fields, mirror labels, comments | board-sync.yml, roadmap |
| `routines` | Drift between cloud triggers (a dump from the RemoteTrigger `list`, with each trigger's `sources`), standing-job records, `routines/*.md`, the settings repos (`sources-missing`) and the clerk's own commands and flags (`unknown-clerk-command`): `routines --check <dump.json> [--repo <programme>] [--json]`; exit 1 on any drift but stale check-ins | Human; `/routines`, `/session` | trigger dump, programme standing-job records, `git ls-files routines/` | nothing | owner |
| `pr-check` | A PR's decisions against the standard (docs/pr-decisions.md): `pr-check <repo#n> [--repo <programme>] [--merging] [--json]`; errors for decision language with no `srs-decisions` block, decision records in the diff with no block, rulings or escalations with no record, merge-blocking asks unanswered (`--merging`); exit 1 on error (logic in `lib/practice/pr-decisions.mjs`) | Builders and reviewers; human | the PR body, its comments and files (gh REST) | nothing | wg-builder, unattended-worker, wg-reviewer briefs |
| `ground` | Advisory PR grounding check and indicator I1: `ground [--repo <programme>] (--pr <repo#n> \| --since YYYY-MM-DD) [--json]`; levels none, issue, problem, problem+persona+domain, epic, group; exit 0 unless input is wrong | Human; daily | merged PRs, closing issues and sub-issue parents (gh), programme records, groups | nothing | ground.yml |
| `wt` | Create, list, prune git worktrees | Human | git | worktrees | `scripts/session`, owner |
| `doctor` | The clerk's self-test where it runs: `doctor [--repo <programme>] [--json] [--post]` checks the GitHub transport (gh or curl, token), the srs CLI, settings, that every settings repo and the report and digest issues are API-readable, each group's state, `SRS_ACTOR` if set, and `/tmp/clerk` in a cloud session; exit 1 on any failure. `--post` records the result (ok too) as a `<!-- clerk-doctor status= env= at= -->` comment on the digest issue, which the desk reads (logic in `lib/practice/doctor.mjs`) | Every routine's first step; the daily canary; human | settings, programme records, GitHub (REST) | with `--post`: one comment on the digest issue | every routine brief, canary.md |
| `fetch-srs` | Download the pinned srs CLI, print `SRS_CLI_PATH=` | Human; CI | `.github/workflows/validate.yml` of the programme repo | `/tmp/srs-cli` | every script and workflow needing srs |

## Scripts (`scripts/`)

| Script | Purpose | Reads | Writes | Called by |
|---|---|---|---|---|
| render-handbook.mjs | Validate `handbook/` (an SRS repository) and render its `handbook` Composition to `docs/handbook.md`; `--check` exits 1 on drift | `handbook/`, `SRS_CLI_PATH` | `docs/handbook.md` | owner, handbook watcher, validate.yml |
| charter.mjs, roadmap.mjs, queue.mjs, steward-check.mjs, check-method.mjs, check-programme-conformance.mjs, fetch-pinned-srs.mjs, gh-project.mjs, upkeep.mjs, group-state.mjs, wt | Behind the commands above | see above | see above | `clerk <name>` |
| lib/pinned-srs.mjs, lib/repo-arg.mjs | Pin lookup; `--repo` resolution | programme `validate.yml` | | scripts |
| session | Fresh programme worktree, pinned srs, then open the clerk | srs-programme master | a worktree | owner, `/session` (`.claude/commands/session.md`) |
| `/ship <repo>#<n>` (`.claude/commands/ship.md`) | A local session takes one issue through the handbook chain as a member (decision f799b6bc): checks for an existing claim or PR, admission (affirmed, user-facing problem), routing, `claim`, dependency gate, decisions, gates, review, PR with `pr-check`, run report; stops at grounding, dependency and decisions | the issue, settings, groups, Affirmed problems | claim, PR, run report comment | owner (local session) |
| routines.mjs | Behind `clerk routines` (logic in `lib/practice/routines.mjs`) | see above | nothing | `clerk routines` |
| serve.mjs, snapshot.mjs | Behind `clerk serve` and `clerk snapshot` (logic in `lib/practice/api.mjs`, `lib/adapters/sync.mjs`, `lib/adapters/snapshot.mjs`, `lib/adapters/desk-detail.mjs`) | see above | see above | `clerk <name>` |
| *.test.mjs | Tests (`npm ci && npm test`; ajv is the only devDependency) | fixtures | | CI |
| test/integration/serve.int.mjs | Tier 2: a real `clerk serve` against a programme checkout, every GET response validated against `api/openapi.json` (`npm run test:integration -- <programme>`; needs `SRS_CLI_PATH` and gh auth) | a programme checkout, GitHub | a temporary state dir | serve-integration.yml |

## Settings

Nothing programme-specific is hard-coded. `lib/adapters/settings.mjs` reads the one `com.semanticops.programme/programme` record (title, github_owner, governed_repos, report_issue, digest_issue, board_project, board_story_repo, owner_actor) from the programme repo; `--repo` picks it. Env wins where CI needs it: `gh-project.mjs` uses `GHP_OWNER`, `GHP_OWNER_ACTOR`, `GHP_PROJECT`, `GHP_STORY_REPO`, `GHP_MIRROR_REPOS` first and reads settings (from `CLERK_REPO` or the cwd) only for what is unset. The programme repo's own slug, worktree base (`$WT_ROOT/<name>`, default `~/dev/.wt/<name>`) and default branch are derived from its git remote. Working-group settings (label, members, quorum, budget, cycle close, pause limit, repos) are not here: they are the charter on each group's role record, read by `lib/adapters/groups.mjs` (`clerk groups`). 

## Cloud sessions

The clerk runs unchanged in a Claude Code cloud session (claude.ai/code, cloud routines). Such a session refuses GitHub GraphQL and the search API, so every GitHub call the clerk makes from a session is repo-scoped REST, through `lib/adapters/github.mjs` (`groupStates` in `lib/adapters/upkeep.mjs`). Closing PRs are read from the issue timeline's cross-references and the PR body's closing keywords (`Closes #n`), which is what GitHub links on merge; a PR linked only by hand in the sidebar is not seen.

- **Agenda, Stalled section** (clerk#38, owner only, read-only, never closes): stale `status: in progress` claims (default 1 day, `CLERK_STALLED_CLAIM_DAYS`), remote branches ahead of the default branch with no open or merged PR (default 14 days, `CLERK_STALLED_DAYS`), epics with no activity in themselves or their sub-issues (same N). Local worktrees are not read.
- **Health:** every routine runs `clerk doctor` first and stops on a failure, posting it with `--post`; the daily canary (`routines/canary.md`) posts a marker either way. The desk flags a failing canary, or none for 26 hours, under Needs you.
- **Works in a session:** `settings`, `groups`, `desk`, `roadmap` (read), `check`, `conformance`, `queue`, `claim`, `session`, `comment`, the agenda (TUI), `steward`, `ground`, `charter`, `routines`, `wt`, `fetch-srs`.
- **Actions only:** `board` (GitHub Projects v2 is GraphQL-only) and `upkeep` (lists PRs with `gh pr list`). `roadmap --apply` also calls `board`. Their workflows run them; nothing in a session needs them.
- **Repositories:** attach every settings `governed_repos` entry to the cloud environment, with write access (`add_repo` with `access: push` in a session). A public repo with read-only git access still refuses API calls. A repo the session cannot reach is skipped with a warning (`queue` prints "this queue is partial"; `steward` and `ground` name it).
- **Paths:** checkouts sit side by side (`/home/user/<repo>`); `wt` finds siblings next to the clerk's own checkout, and worktrees go to `$WT_ROOT` (default `~/dev/.wt`), which `session` reads too.
- **No `gh`:** a session has no `gh` binary. The clerk's `gh api` calls fall back to curl (`lib/adapters/cli.mjs`), authenticated by `GH_TOKEN`/`GITHUB_TOKEN` when set and otherwise by the session's egress proxy; `--jq` and `gh` porcelain have no fallback, so clerk code never uses them. `wt prune` cannot see squash merges without `gh` and keeps those worktrees.
- **srs CLI:** fetched on first use from the programme's pin (`fetch-srs`, cached in `/tmp/srs-cli`); no setup step.
- **Signing:** commits use the environment's configured signing; there is no `ssh-add` in a session.

## Packages

Canonical source of the methodology packages, installed into the programme repo with `srs package install packages/<name> --repo <programme>` (provenance in `.srs-import/`).

| Package | Namespace | Version | Holds | Upstream |
|---|---|---|---|---|
| `packages/method` | com.semanticops.method | 1.0.0 | problems, remedies, tensions, principles, archetypes, domains, personas, clusters, poles, agents | clerk (this copy) |
| `packages/governance` | com.mudemocracy.governance | 1.1.0 | decisions, roles (optional `decision_kind` on decisions; optional working-group charter: `group_label`, `quorum_*`, `budget_per_cycle`, `cycle_close_utc`, `max_unacked_reports`, `governed_repos`), logs | muDemocracy.org `muSrs/packages/governance` (same id and version; differs only in key order) |
| `packages/stewardship` | com.mudemocracy.stewardship | 0.1.0 | agents (optional `actor_id`, `seat`), standing jobs (optional `routine_id`, `brief_path`), run reports | muDemocracy.org `muSrs/packages/stewardship` (the programme's install also carries imported com.thesystem fields) |
| `packages/programme` | com.semanticops.programme `methodology` | 0.2.0 | the `programme` settings type and its fields; the work-status set (lifecycle `work_item`, vocabularies `work_hold`, `merge_gate`, `work_label`) and the `label-binding` type a programme shows it with; the `set-against` relation (decision → the principle it rests on). Proposed under f58db200 and 7ee8fa01; no code reads them yet (clerk#121) | clerk (this copy; the programme's install has no package description) |

The live methodology types (period, objective, epic, stakeholder, session and the relation types serves, responds-to, ratifies, considers, sets-aside, attended-by, receives) are still defined in srs-programme's primary package (`com.semanticops.programme` `primary`, 1.0.0) and will move into `packages/programme` in a later step.

Export a deterministic bundle (not committed; `dist/` is git-ignored):

    srs package export --repo <programme> --selector packages/<name> --published-at 2026-10-10T00:00:00Z --output dist/<name>.srspkg

## Workflows

Reusable (`on: workflow_call`) in `.github/workflows/`; the programme repo holds thin callers (`examples/programme-workflows/`, exactly what to copy) that own the triggers, concurrency and `secrets: inherit`. Each checks out the caller, then the clerk at the `clerk-ref` input, and moves it to `$RUNNER_TEMP/clerk` (outside the programme tree: srs scans the whole repo root, and a clerk inside it collides with the installed packages), which the caller sets to the same SHA as in its `uses:` line (a reusable workflow cannot reliably learn its own pinned ref). Bump both together. The srs CLI pin `SRS_RUST_CLI_TAG` stays in the caller's `validate.yml`.

| Workflow | Purpose | Caller trigger | Runs | Secrets | Writes |
|---|---|---|---|---|---|
| programme-validate.yml | Conformance gate | push, PR | srs `repo validate`, `conformance`, `check`, `roadmap --json` | GITHUB_TOKEN | nothing |
| programme-derive-priority.yml | Apply roadmap priority; daily steward check | push, daily 06:15, dispatch | `roadmap --apply --yes`; `steward --fix` when not a push | BOARD_TOKEN | epic priority, `parked`, reopened issues |
| programme-pr-upkeep.yml | Keep PRs moving, daily digest | every 15 min, 07:20 digest, push, workflow_run, dispatch | `upkeep` | BOARD_TOKEN | merges, digest |
| programme-pages.yml | Publish `roadmap/` with generated roadmap.json | push, dispatch | `roadmap --json` | GITHUB_TOKEN | Pages |
| programme-board-sync.yml | Promote intents, reconcile board and labels | push, hourly, dispatch | `board sync` (project, story repo, mirror repos from settings) | BOARD_SECRET or BOARD_TOKEN | labels, board |
| programme-ground.yml | Grounding report (I1), last 7 days | daily, dispatch | `ground --since` (7 days) to the job summary | GITHUB_TOKEN | nothing |
| test.yml (clerk) | The clerk's own tests | push, PR | `npm ci`, `npm test` | | nothing |
| serve-integration.yml (clerk) | Tier 2 for `clerk serve`: a real service against the real srs-programme (checked out read-only) with the programme's pinned srs; every GET response validated against `api/openapi.json` | push, PR | `npm run test:integration -- programme` | GITHUB_TOKEN | nothing |
| validate.yml (clerk) | The handbook is valid and `docs/handbook.md` matches its records; holds the clerk's own pin `SRS_RUST_CLI_TAG`, bumped in the same PR as srs-programme's `validate.yml` pin so the handbook and the programme read with one build | push, PR | `fetch-pinned-srs --repo .`, `render-handbook --check` | GITHUB_TOKEN | nothing |

## Routines (cloud, briefs in `routines/`; lifecycle in [routines.md](routines.md))

| Routine | Purpose | Trigger | Reads | Writes |
|---|---|---|---|---|
| unattended-worker.md | Ship `lane:unattended` issues as PRs | nightly 00:00 UTC, `trig_01GcbJwYyVfVTAekgYkAxFpJ` | issues (`ready` + lane), `queue` rules | branches, PRs, `status: in progress`, `needs-input` |
| wg-steward.md | Daily cycle close: report, minutes | 11:30 UTC, `trig_015iT3SoLLvJmgADknC7RpfG` | merged PRs, issues | run-report records, a PR, comment on the report issue |
| wg-analyst.md | Analyse and feed the group queue | 12:00 UTC, `trig_01M6mtE5wZJg2FeXFFnZjCSk` | issues, programme records | suggestions and issues |
| wg-builder.md | Build one `wg:third-party-ready` issue | hourly :10 UTC, `trig_01RC6KWkRKzVVsPQxzZWbWpF` (scheduled: GitHub event triggers cannot filter by label through the API; the brief's merge-event path picks the next issue) | issue | branch, PR |
| handbook-watcher.md | Keep the handbook true to code, data and boards; report drift | weekly, Monday 06:00 UTC (trigger not yet created) | clerk and programme history, tests, boards, programme records | handbook records and render (a PR), run report, issues |
| synthesiser.md | Group a domain's unclustered problems into named clusters (suggests only; affirmed clusters are the owner's) | weekly, Tuesday 06:00 UTC (trigger not yet created) | domain containers, problems, clusters, Suggestions | clusters and outline moves in Suggestions (a programme PR), run report, comment on the digest issue |
| wg-reviewer.md | Review open group PRs (up to 3 per run), post quorum | hourly :40 UTC, `trig_017sfYgXA1PXoZRmHDzG69Jz` (scheduled, same reason) | PRs | quorum comment, `gate:auto-merge` |
| bug-fixer.md | Fix one bug from `clerk queue --bugs`, terminal at the PR | every 2 h (trigger to be created; replaces the paused `trig_01HjsX1ohcEytbrLpWtbsENg`) | bug issues, the target repo | branch, PR, run report |
| canary.md | Test the clerk where routines run; leave a marker either way, so a broken cloud is seen the same day | daily (trigger to be created) | settings, every settings repo, group state | one `clerk-doctor` comment on the digest issue |
| working-groups.md | Overview of the group's rules | | | |

## Label contract

What each status, hold, gate and classification means is the work-status set in `packages/programme` (decision f58db200); the label text is the programme's `label-binding` records. This table says who writes and reads each label today. `clerk labels` checks every repo against the bindings, and the label lint test (`test/labels.test.mjs`) fails on a status or gate label written as a literal in code, or a retired label in code or a brief.

| Label | Written by | Read by |
|---|---|---|
| `ready` | board mirror (`board promote`/`reconcile`), never by hand | queue, unattended-worker, wg-builder, steward |
| `promote:ready` | `board topup` (intent) or the owner | `board promote`, which sets Status=Ready and the `ready` mirror |
| `priority: P0` / `P1` / `P2` | `board` (derived from stories and epics; epics from `roadmap`) | queue, unattended-worker (ordering) |
| `parked` | `roadmap --apply` (epic serves no ranked objective) | queue (held), `board` (excluded), `claim` (refuses) |
| `blocked` | `board` mirror of open blocked-by edges | queue (held), `board` (excluded), `claim` (refuses), unattended-worker, wg-builder |
| `needs-input` | a stopping routine (it keeps its claim); the human removes it | queue (held), `board` (never reclaimed), `claim` (refuses), wg-steward |
| `lane:unattended` | owner or filing agent | queue, unattended-worker |
| `gate:auto-merge` | PR author per repo rule; wg-reviewer on approve | upkeep (merge when clean; never beside `gate:owner-merge`) |
| `gate:owner-merge` | PR author or owner | upkeep (keep up to date, never merge, wins over `gate:auto-merge`), clerk Merges section, `desk` (Needs you), wg budget (not counted) |
| `wg:third-party-ready` | owner or steward on issues; builder on PRs | queue (wg lane), wg-builder, wg-reviewer, upkeep (quorum and budget), wg-steward |
| `status: in progress` | `clerk claim` or a routine claiming an issue; `reconcile` moves the board column to match. An agent's claim is this label plus the claim comment, never an assignee | `board` reclaim (unassigns the owner from an agent's claim), `claim` (refuses), `desk` (not listed as assigned), unattended-worker |
| `status: in review` | `board` stale-claims, when an open PR closes the issue | `claim` (refuses), `board` (back to Ready if the PR closes unmerged) |
| `desk` | the owner, on exactly one pinned issue in the settings `digest_issue` repo (semanticops.com#35) | `desk --post` (rewrites that issue's body) |

## Repo lists

queue.mjs, steward-check.mjs, upkeep.mjs, gh-project.mjs (`MIRROR_REPOS`, unless `GHP_MIRROR_REPOS` is set) and the owner-only PR list in `bin/clerk.mjs` all read the settings `governed_repos`, so they agree by construction; the list is whatever the programme's settings record holds. The working-group ready count in `bin/clerk.mjs` (the Next forecast) and the queue's group lane use each group's own `governed_repos` instead.

## Related tools elsewhere

- srs-context hooks (`srs-context/hooks`: session-start, prompt-context, usage-log) give agents project memory.
- srs-web governance shell (`src/lib/governance`) is the editor that will import `lib/practice`.
- srs-gov is retiring (clerk#7).
