---
description: Maintain the user-story layer that drives priority — sync, surface missing MoSCoW, audit coverage.
argument-hint: "[story #N to inspect its tree]"
allowed-tools: Bash, Read
---

# /stories — maintain the story layer

Canonical copy (the-greenman/clerk). User stories (label `user-story`, in `the-greenman/semanticops.com`) are the human value layer that drives implementation priority on GitHub Project #6. Humans set MoSCoW on stories; everything below them is derived. Epic priority is derived by `clerk roadmap` from the srs-programme period ranking and is never set by hand.

`GHP` = `clerk board` (from a programme checkout) or `node ~/dev/semanticops/clerk/scripts/gh-project.mjs`.

## Sync stories onto the board

```bash
GHP stories sync
```

## Coverage audit (the point of this command)

```bash
GHP coverage
```

Report five things and what to do about each:
1. **Uncovered stories** — open stories with no implementation children. Propose linking or filing the first task.
2. **Unlinked — could get lost** — non-bug implementation issues with no parent story. Propose the story to link under (`GHP link <parent-repo>#<n> <child-repo>#<n>`), or flag as unjustified work.
3. **Bugs — fix ASAP** — bugs carry a P1 floor regardless of story; confirm they're `Ready`.
4. **Orphan stories (no epic)** — `orphan_stories_no_epic`: propose the epic and link it: `GHP epic add-story <epic#> <story#>`.
5. **Unsized issues** — `unsized_issues`: assign from scope: `GHP size <repo> <issue#> <small|medium|large|xl>`.

Also flag any **story missing a MoSCoW value**; you may propose one (Must/Should/Could/Won't) for the human to confirm in the UI.

## Epics

```bash
GHP epics
```

Epics in feed order with coverage flags. An epic is a release; its `Epic NN:` title is identity and roadmap sequence. Do not run `epic set` by hand: epic priority comes from `clerk roadmap` (`--apply --yes`).

## Inspect one story's tree

If given a story number ($ARGUMENTS): `GHP tree $ARGUMENTS` — story → epics → leaf issues, with open/closed state.
