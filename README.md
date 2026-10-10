# clerk

A small terminal tool that lets the owner act **by role** on an SRS programme without getting lost in data. Prototype: rough but working.

```
SRS_ACTOR='{"kind":"human","id":"human:you","name":"You"}' \
  clerk --repo <srs-programme checkout or worktree> --as owner [--dry-run]
```

Needs Node >= 20, `gh` (logged in), and the repo's `scripts/fetch-pinned-srs.mjs`. No dependencies. `SRS_ACTOR` must be `kind: human`; the clerk refuses otherwise.

## What it shows

One screen of counts, plus a status line per working group (running or paused, merged/10 this cycle):

1. **Ratify**: `proposed` decisions in the SemanticOps decision log.
2. **Decide**: escalations: `proposed` decisions in a group log made by `agent:tpr-steward` that are not yet in the SemanticOps log.
3. **Acknowledge**: working-group report comments on semanticops.com#31 without your +1.
4. **Merge**: open, clean `gate:owner-merge` PRs.

Pick a section and the items come **one at a time**, essentials only. Read-only until you press a key.

| Section | Keys |
|---|---|
| Ratify | `r` ratify, `s` set aside, `o` full record, `n` next, `q` quit |
| Decide | `a` accept recommendation, `c` choose other (asks for resolution text), `d` defer, `o`, `n`, `q` |
| Acknowledge | `a` +1 via `gh api` (acts now), `o` open in browser, `n` |
| Merge | `m` `gh pr merge --merge` (acts now), `o`, `n` |

Ratify and Decide choices are collected. On quit/end session the clerk creates ONE `com.semanticops.programme/ratification-session` record as you in a fresh srs-programme worktree, adds `ratifies` / `sets-aside` relations, transitions each decision (ratified or abandoned), adds accepted escalations to the SemanticOps log, validates, commits (signed), pushes and opens a `gate:auto-merge` PR, then prints its URL. `--dry-run` prints the summary instead of doing any of it.

## Principles

- Each mind gets information fit for its cognition; too much information is noise. Counts first, then one item at a time.
- Decisions taken on the fly are recorded at once as `proposed` and ratified at a session, like approving the minutes.
- Ratification is never an agent act: the actor must be a human, and the record is attributed to them.

Concept: srs-programme `source-documents/agent-democracy-2026-10-10/concept.md`.

## Test

`node --test test/` (agenda building from fixture JSON; no network).
