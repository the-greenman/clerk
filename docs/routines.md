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

## Drift check

A routine's standing-job record names its trigger (`routine_id`) and brief (`brief_path`, a path in this repo). `/routines` (or `clerk routines --check <dump.json> --repo <programme>`) compares them with the account's triggers and reports, by kind: `trigger-without-record`, `record-without-trigger`, `record-trigger-disabled`, `brief-missing`, `prompt-not-thin` (an enabled trigger's prompt must name its brief path and the-greenman/clerk), `sources-missing` (an enabled trigger that does not attach every settings repo: the clerk then fails closed on the repo it cannot read), `unknown-clerk-command` (a prompt runs a clerk command or flag that does not exist) and `stale-check-in` (a disabled `Check-in` trigger; housekeeping, does not fail). The trigger list comes from the RemoteTrigger `list` action, which returns 20 with `has_more` and no working cursor, so triggers past the first 20 are not seen. The check never edits a trigger; changes need the owner's explicit confirmation.

## Settings

Briefs read owner, repos, report and digest issues and the board project from the programme settings record (`clerk settings --repo <programme> --json`), not from literals. What is not a programme setting (the ratifying decision id, a working group's budget) stays in the brief until working-group data gets its own record.
