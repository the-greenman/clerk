---
description: Story-driven triage — derive issue priority from user-story MoSCoW, set readiness + iteration, report.
argument-hint: "<scope: a story #N, a repo, or 'all'> (default: all)"
allowed-tools: Bash, Read
---

# /triage — story-driven priority pass

Canonical copy (the-greenman/clerk). Scope: **$ARGUMENTS** (a story `#N`, a repo name, or `all`; default `all`).

Board: GitHub Project #6; story repo `the-greenman/semanticops.com`. Implementation priority is **derived from user stories**, never hand-set. Epic priority is derived by `clerk roadmap` from the srs-programme period ranking, never set here. Run the tool; do not re-implement it.

`GHP` = `clerk board` (from a programme checkout) or `node ~/dev/semanticops/clerk/scripts/gh-project.mjs`. Check it works: `GHP help >/dev/null && echo ready`.

## Stage 1 — Ensure stories are on the board

```bash
GHP stories sync
GHP coverage
```

If any story lacks MoSCoW, **stop and report** which — a human sets MoSCoW in the board UI. (You may propose values.)

## Stage 2 — Derive priorities and releases

```bash
GHP rollup            # dry-run
GHP rollup --fix      # apply priority labels + board Priority mirror
```

`coverage` also reports `orphan_stories_no_epic` (link with `GHP epic add-story <epic#> <story#>`) and `unsized_issues` (effort is a judgement: `GHP size <repo> <issue#> <small|medium|large|xl>`).

## Stage 3 — Readiness + iteration

For each implementation issue in scope: **Ready** iff unblocked, else leave **Backlog**; assign an **Iteration** by the program's phase, bounded by the served story's release.

```bash
GHP set <repo> <issue#> --status Ready --iteration "Iteration 4"
```

Never set Ready on an unlinked non-bug issue — surface it (Stage 4).

## Stage 4 — Reconcile + report

```bash
GHP reconcile --fix
GHP summary           # priority estimates + calculation stages
```

Report: (1) priority estimate summary (`GHP explain <repo> <#>` for surprises), (2) per-iteration table, (3) bugs ASAP lane, (4) unlinked non-bug issues with a proposed story, (5) uncovered stories.

Do not invent priority by hand — if the rollup can't derive it, it belongs in lane 3 or 4.
