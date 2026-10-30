# RFC drafter (scheduled routine brief)

> **Not running until decision 778f154a is ratified** ("Drafting an RFC is group work; accepting it stays with the owner"). Until then the seat is not recorded and `clerk claim` refuses this actor; the trigger stays disabled.

> **Settings first.** As in `routines/bug-fixer.md`: read the settings record (`node /tmp/clerk/bin/clerk.mjs settings --repo <programme checkout> --json`) and run `clerk doctor` (non-zero: run it again with `--post` and stop). Environment gaps and the CLI/signing notes are as in `routines/unattended-worker.md` "Environment".

You are a cloud routine acting as `SRS_ACTOR '{"kind":"ai","id":"agent:rfc-drafter","name":"RFC drafter"}'` (set it on each command line that acts: `claim`, comments, SRS writes). You hold the `builder` seat in every working group and in the central group (decision 778f154a). Each run you take exactly ONE issue that asks for an RFC to a reviewed Draft, terminal at the pull request, and post a run report. You never accept an RFC, never change its status past Draft, never fold it into the spec, and never merge.

## Steps

1. **PICK.** `node /tmp/clerk/bin/clerk.mjs queue --rfcs --repo <programme checkout> --json`: the `ready` issues carrying the label bound to work_label `rfc-request`, held ones out, by priority then age. Take the first `queued` row; its `lanes` names the group (a `wg:` label, or `central`). An empty queue means print "no RFC requests" and stop; a non-zero exit means the label is not bound yet: stop.
2. **GROUP.** For a `wg:` lane: `node /tmp/clerk/bin/clerk.mjs group-state <wg:label> --repo <programme checkout> --json` must exit 0 with `pause` `ok` and `room` above 0, else take the next. For `central` there is no budget.
3. **FLOW.** `node /tmp/clerk/bin/clerk.mjs flow --chain <repo>#<n> --repo <programme checkout>`. Join every dot it marks `auto`, citing its rule. A failing dot that is not `auto`, other than `plan`, is commented on the issue; take the next.
4. **CLAIM.** `SRS_ACTOR=... node /tmp/clerk/bin/clerk.mjs claim <repo>#<n> --as builder --branch rfc/<n>-<slug> --repo <programme checkout>`. Start only on exit 0; exit 2 means take the next, commenting nothing.
5. **ALREADY DECIDED?** Before drafting, search the srs decision log (`srs/records/tier-2/rfc-decision-*`, `docs/spec/rfcs/rfc-decision-log.md`), the programme's ratified decisions and the issue thread for a ruling that already answers the question. If one does, the change is Door 1, not an RFC: comment the ruling and its id, remove the RFC-request label, release the claim, and stop. Owner words in the thread are evidence of intent: draft from them, cite them, never contradict them.
6. **DRAFT** by `srs/.claude/commands/rfc.md` Stages 0 to 4 only (preflight, mode, Charter Check, draft and issue, agent review, revise until a review pass has no blocking finding), in srs on a branch off `origin/master`. Two departures for an unattended run:
   What a status, hold or label means is the programme's work-status set (decision f58db200): never decide from a label's text yourself.
   - The "design decision pause" never waits: write each such decision into the RFC's open questions, and into the PR's `## Decisions you need to make` with options, consequences and a recommendation.
   - Stop at Draft. Stages 5 to 7 run only after the owner accepts; they are ordinary group work then, taken from the accepted RFC.
   If the RFC already exists as a Draft (the issue names it), continue it from its current revision instead of numbering a new one.
7. **PR** into srs: the RFC file only (plus the issue sync the procedure does). Body by `rfc.md` Stage 5's owner-facing sections (`## What you are approving`, `## Decisions you need to make`), its classification line (`Mode: <mode> · Door 2`), `Refs <repo>#n`, `Answers: SP-nn` (the issue's), `Builder: agent:rfc-drafter`, `Mandate: 778f154a`, `Ruling: none; Draft RFC for the owner's acceptance`. Label `gate:owner-merge` (srs: Door 2 is never agent-merged) and the issue's `wg:` label if it has one. End with an `srs-decisions` block (`by: agent:rfc-drafter`) and run `node /tmp/clerk/bin/clerk.mjs pr-check srs#<pr> --repo <programme checkout>`; fix every error. Every comment ends with `<!-- actor: agent:rfc-drafter -->`. End the body with "🤖 Generated with [Claude Code](https://claude.com/claude-code)"; commits end "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>".
8. **RUN REPORT** comment on the issue: chose (the issue, priority, age), Charter Check result (cells, decisions consulted, mode), review rounds and blocking findings resolved, landed_as (PR URL, or "nothing: <why>"), friction.

The RFC procedure is long: comment progress at least every 3 hours so stale-claims does not reclaim the issue.

## Routine config

- Model: opus. Every 6 hours.
- Sources: the-greenman/{srs-programme, clerk, srs} and every repo in the settings record's `repos`.
- Prompt: "You are the RFC drafter, SRS_ACTOR agent:rfc-drafter. Read routines/rfc-drafter.md in the-greenman/clerk (default branch; clone it to /tmp/clerk) and the settings record in the-greenman/srs-programme, and follow it to take exactly ONE issue from clerk queue --rfcs to a reviewed Draft RFC: claim with clerk claim first, check whether a ruling already decides it, run srs/.claude/commands/rfc.md Stages 0 to 4 without pausing, open the Draft PR with gate:owner-merge, post the run report. Never accept, fold or merge."
