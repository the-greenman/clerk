# clerk

A small terminal tool that lets the owner act **by role** on an SRS programme without getting lost in data. Prototype: rough but working.

Sessions, not meetings: a session has attendees, a date and time (`held_at`, UTC), and is often **ad hoc**. Decisions made *between* sessions are recorded at once as `proposed` and may be acted on, because they fall within the group's remit; they are **ratified at a session**. The rules are the same for humans and AI agents, so the tools are human tools too: authority comes from the **role** held, not the kind of mind.

```
# interactive (TUI)
SRS_ACTOR='{"kind":"human","id":"human:the-greenman"}' clerk --repo <srs-programme checkout> --as owner [--dry-run]

# non-interactive (agents, scripts, or a human who knows what they want): same code path as the TUI's end of session
SRS_ACTOR='{"kind":"ai","id":"agent:tpr-steward"}' \
  clerk session --repo <srs-programme checkout> --as tpr-steward [--attendee <record-id>]... [--ratify <id|all>]... [--set-aside <id>]... [--dry-run]
```

`--as <role>`: `owner`, `tpr-steward`, `tpr-builder`, `tpr-reviewer` (prototype mapping in `lib/roles.mjs`). The actor in `SRS_ACTOR` must hold that role (owner = `human:the-greenman`; `agent:tpr-*` hold the matching group role) or the clerk refuses, naming role and actor. The owner's session is recorded in the SemanticOps decision log, a group's in its own log. Escalation, report acknowledgement and PR merge sections are owner-only.

Needs Node >= 20, `gh` (logged in), and the repo's `scripts/fetch-pinned-srs.mjs`. No dependencies. Requires the `com.semanticops.programme/session` type on srs-programme master.

## What it shows

One screen of counts, plus a status line per working group (running or paused, merged/10 this cycle):

1. **Ratify (decisions since the last session)**: `proposed` decisions in the SemanticOps decision log.
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

Ratify and Decide choices are collected. The TUI header reads `Session: <date time UTC> (ad hoc) · attendees: <names>`; attendees default to the acting role and `+` adds more (roles and stewardship agents). On end session the clerk creates ONE `com.semanticops.programme/session` record (title `Session <YYYY-MM-DD HH:MM UTC>: <context>`, status `ended`) as the acting actor in a fresh srs-programme worktree, adds `attended-by` relations to each attendee and `ratifies` / `sets-aside` to each decision, transitions each decision (ratified or abandoned), adds accepted escalations to the SemanticOps log, validates, commits (signed), pushes and opens a `gate:auto-merge` PR, then prints its URL. `--dry-run` prints the summary instead of doing any of it.

## Principles

- Each mind gets information fit for its cognition; too much information is noise. Counts first, then one item at a time.
- Decisions taken on the fly are recorded at once as `proposed` and ratified at a session, like approving the minutes.
- Authority follows roles, not kinds of mind; the record is attributed (`createdBy`) to whoever acted.

Concept: srs-programme `source-documents/agent-democracy-2026-10-10/concept.md`.

## Test

`node --test test/` (agenda building from fixture JSON; no network).
