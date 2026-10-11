---
description: Sequence a program's issues into iterations by gate/phase, bounded by story release windows.
argument-hint: "<program: an epic #N or milestone>"
allowed-tools: Bash, Read
---

# /roadmap — sequence a program into iterations

Canonical copy (the-greenman/clerk). How the board works: [docs/board.md](../../docs/board.md). Board is GitHub Project #6 "SemanticOps"; stories and epics live in `the-greenman/semanticops.com`.
Program: **$ARGUMENTS** (an epic issue or a milestone).

**Epic priority is never set here.** It is derived by `clerk roadmap` from the srs-programme period/objective ranking (the only writer of epic priority). This command only sequences child issues into iterations.

Iterations are delivery windows on the project. **GitHub has no API to create iterations** — if a phase needs a window that doesn't exist yet, stop and ask the human to add it in the project UI.

## Tool

`gh-project` is `clerk board <subcommand>` (run from a programme checkout so settings resolve), or without a checkout:
`node ~/dev/semanticops/clerk/scripts/gh-project.mjs <subcommand>` (called `GHP` below).

## Stage 1 — Map the program

- Read the epic/milestone and its children (`gh issue view`, `GHP tree <story#>`).
- Identify the **gate/phase structure** from the epic body and milestones.
- Inspect iterations: `GHP fields`; current epic order: `GHP epics` and `clerk roadmap`.

## Stage 2 — Sequence

Assign each child issue to an iteration by phase, respecting dependencies and **bounded by the served story's release window**:

```bash
GHP set <repo> <issue#> --iteration "Iteration N"
```

Priorities stay derived — run `/triage` (or `GHP rollup --fix`) rather than hand-setting.

## Stage 3 — Report

Per-iteration table for the program. **Flag any phase with no available iteration** and ask the human to create it.
