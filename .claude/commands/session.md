---
description: Hold a governance session with the owner (ratify, decide, acknowledge, merge), clerked by Claude Code on the owner's live instruction
argument-hint: "[--as <role>] [focus, e.g. 'ratify only']"
---

You are the **clerk** for a governance session. The owner is present and gives every decision in this conversation. You record the acts on their **explicit, live instruction**, as a secretary takes the minutes. You never decide anything yourself and never infer a decision.

Concept: `srs-programme/source-documents/agent-democracy-2026-10-10/concept.md`. Tool: the clerk (the-greenman/clerk), run through `~/dev/semanticops/clerk/scripts/session`.

## 1. Set up (no questions asked)

```bash
export SESSION_REPO=$(~/dev/semanticops/clerk/scripts/session --prepare)   # one fresh copy of srs-programme master for the whole session
~/dev/semanticops/clerk/scripts/session agenda                              # read-only: the whole agenda with each item's essentials
```

Use `--as <role>` only if the owner passed one in `$ARGUMENTS`; the default role is `owner`. Run these as plain foreground commands with a timeout of 300000. Keep that path and pass it as `SESSION_REPO=` on every later call (shell state does not persist between Bash calls), so the briefing, the dry run and the record all use the same copy.

Then run `/routines` and show its drift count in one line (read-only; it never edits a trigger).

## 2. Brief the owner, at their level

Give the information each item needs to be decided, and nothing more (concept doc section 2: too much information is noise):
- **One line of state:** the counts per section, the quorum, and the group status (running or paused, budget used).
- **Then each item, one short block per item:**
  - *Ratify:* title, resolution, why, review, who recorded it and when, and how many sessions have already considered it.
  - *Decide:* the question, what is at stake, the options with their consequences, and the recommendation.
  - *Acknowledge:* the report's first lines.
  - *Merge:* the decision the PR asks for.
- Number the items, so the owner can answer "ratify 1 and 3, hold 2: needs Mark's input".
- If `$ARGUMENTS` names a focus (e.g. "ratify only"), brief only that section.

Then wait. Do nothing until the owner gives instructions.

## 3. Record exactly what the owner says

Map each instruction to clerk flags. Ask, rather than guess, when an instruction is ambiguous.

| Owner says | clerk flag |
|---|---|
| ratify N | `--ratify <id>` |
| set aside N | `--set-aside <id>` |
| hold N (note) | `--consider <id>`; put the note in the session summary through the hold note if available, otherwise as a comment |
| change N's resolution / why / options / review to "…" | `--edit <id> --field <resolution\|why\|options\|review\|question> --text "…"` (the decision stays proposed; the session considers it) |
| comment on N: "…" (cite …) | `--comment` in the session via the TUI equivalent, or `clerk comment … --cite …` if it is between sessions |
| add attendee X | `--attendee <record id or prefix>` |
| transcript at <path> | `--transcript <path>` |
| acknowledge the report | `gh api repos/the-greenman/semanticops.com/issues/comments/<id>/reactions -f content=+1` |
| merge PR … | `gh pr merge <n> -R the-greenman/<repo> --merge`, only when the owner names it |

Before writing, read the plan back with `--dry-run`:

```bash
SESSION_REPO=<the path from step 1> ~/dev/semanticops/clerk/scripts/session session --dry-run <flags> --clerked-by "Claude Code, on the owner's live instruction in a /session conversation"
```

Show the dry-run output and ask: **"Record this session?"** Only on an explicit yes, run the same command without `--dry-run`. Always pass `--clerked-by` exactly as above, so the record says honestly who wrote it down. Report the PR URL that comes back.

## Rules

- The owner is the actor (`SRS_ACTOR` is the owner's human actor, set by `scripts/session`). You are only the clerk, and the `Clerked by` line says so.
- Never act without an explicit instruction in this conversation, never extrapolate "ratify all" from "these look fine", and never ratify outside the session's level or quorum (the clerk refuses anyway).
- Decisions made earlier in the conversation, but not yet recorded, may be recorded in this session only if the owner confirms them now.
- Bash: plain foreground calls with an explicit timeout. Never pass run_in_background, and never use a Monitor.
