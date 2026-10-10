# Routines

A routine is a cloud agent that runs a brief on a trigger. The brief lives here, in `routines/`; the programme repo holds only the routine's record and the settings the brief reads. Every routine is listed in [tools.md](tools.md).

## Thin prompt

The trigger's prompt is only a pointer, so the brief can change without touching the trigger:

> You are <agent>, SRS_ACTOR <id>. Read routines/<brief>.md in the-greenman/clerk (default branch) and the settings record in <programme repo>; follow the brief.

Rules that bind the agent (guards, budgets, ids) belong in the brief, never in the prompt.

## Lifecycle

- **Create.** Record first (the routine's record in the programme repo), then the trigger, then write its `routine_id` back into the record. A trigger with no record is invisible to the programme.
- **Change.** A pull request to the brief in the clerk. The change takes effect when it merges to the default branch. Never edit a trigger's prompt to change behaviour.
- **Retire.** Transition the record, then disable the trigger. Delete the brief only after both.
- **Never enable a trigger whose brief is not on the clerk default branch.** Wrong door recorded: on 2026-10-10 the analyst trigger `trig_01M6mtE5wZJg2FeXFFnZjCSk` was enabled while its brief existed only on unmerged srs-programme PR #75, so it ran a brief that was not the programme's.
- **One-off check-ins** are named `Check-in: <ref>` and left disabled; the owner enables one only to run it.

## Settings

Briefs read owner, repos, report and digest issues and the board project from the programme settings record (`clerk settings --repo <programme> --json`), not from literals. What is not a programme setting (the ratifying decision id, a working group's budget) stays in the brief until working-group data gets its own record.
