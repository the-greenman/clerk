---
description: Check cloud routines against standing-job records and briefs (drift report; read-only)
argument-hint: "[programme repo path]"
---

Report drift between the account's cloud triggers, the programme's standing-job records and the briefs in `routines/`. Lifecycle and the thin-prompt rule: `docs/routines.md`.

1. Call the RemoteTrigger tool with action `list`. Write a JSON array to a temp file (scratchpad), one object per trigger: `{id, name, enabled, cron_expression, prompt, sources}` where `prompt` is `derived_state.prompt` and `sources` is `job_config.ccr.session_context.sources` (or save the raw `list` response: the check reads both). Known API limit: `list` returns 20 triggers with `has_more` and no working cursor, so say in the report if `has_more` is true (the check then misses triggers beyond the first 20).
2. Run, from the clerk checkout (`SRS_CLI_PATH` from `clerk fetch-srs --repo <programme>` if unset):

   ```bash
   node bin/clerk.mjs routines --check <dump.json> --repo <programme repo, default $ARGUMENTS or the session repo>
   ```

3. Report the drift count and the lines grouped by kind. `stale-check-in` is housekeeping and never blocks; any other kind exits 1.
4. Never create, update, enable, disable or delete a trigger on your own. Propose the change (which trigger, which field, from what to what) and wait for the owner's explicit confirmation in this conversation. A prompt that is not thin is fixed by the owner pasting the thin prompt, never by editing the brief to match.
