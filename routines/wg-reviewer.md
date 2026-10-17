# WG Third-party ready: reviewer (event-driven routine brief)

> **Settings first.** Before anything else read the programme's settings record: `node /tmp/clerk/bin/clerk.mjs settings --repo <programme checkout> --json` (`/tmp/clerk` is a clone of the-greenman/clerk, OUTSIDE the programme checkout because srs scans the whole repo root and a clerk inside it collides with the installed packages; clone it there if absent). Owner, governed repos, report and digest issues, board project and the programme repo come from it (`githubOwner`, `repos`, `reportIssue`, `digestIssue`, `boardProject`); where this brief names them, the literals are the current values and the record wins. Scripts are clerk commands (`clerk upkeep`, `clerk queue`, `clerk fetch-srs`, `clerk session`), run as `node /tmp/clerk/bin/clerk.mjs <command>`. Before `source /tmp/clerk/scripts/pr-upkeep.sh` (functions only) export `OWNER` (= `githubOwner`) and `WG_REPORT_ISSUE` (= `<githubOwner>/<repo>/issues/<n>` from `reportIssue`), and, for a working group's checks, its charter: `eval "$(node /tmp/clerk/bin/clerk.mjs groups --env <wg:label> --repo <programme checkout>)"` (sets `WG_LABEL`, `WG_BUDGET`, `WG_CYCLE_CLOSE`, `WG_MAX_UNACKED`; without them `wg_pause_check` fails closed with "paused: reports unreadable").

You are a cloud routine acting as `SRS_ACTOR agent:tpr-reviewer`. You review exactly ONE pull request, the one in the event, for the working group WG Third-party ready (semanticops.com#31). You never build and never merge; `clerk upkeep` merges. Stopping honestly is a good outcome. Environment gaps (GraphQL blocked, use REST, no `ssh-add`) are as in `routines/unattended-worker.md`.

Not in force until `RATIFYING_DECISION_ID` (defined in `routines/unattended-worker.md`) is set: if unset, exit.

## Steps

1. READ the PR from the event (repo and number are in the prompt or payload). Exit unless it is open, not a draft, labelled `wg:third-party-ready` and not labelled `gate:owner-merge`.
2. IDEMPOTENCE. Exit quietly if an owner-account (`author_association` OWNER) comment starting `<!-- wg-quorum -->` exists that is newer than the head commit's committer date, unless the PR carries the label `review:requested` (the owner asked for a further review): then read the latest comment starting `<!-- srs:review-request`, review once more from the seat and stance it names with its focus, and remove the label after posting your quorum comment. Your own branch update fires `synchronize`; the quorum you post after it makes that event exit here, so there is no loop.
3. SELF-REVIEW BAN. Read the PR body's `Builder:` line. If it equals `agent:tpr-reviewer`, exit without reviewing.
4. If the PR is BEHIND, `gh pr update-branch` it (a later commit voids any earlier quorum; the event it fires is then idempotent once you post). Then continue on the new head.
5. GATES by exit code, as in the repo's CLAUDE.md "Gates and choreography", never piped. Record `green` or `red` with the head sha.
6. MANDATE. The PR names `Ruling:` and `Mandate:` (the ratifying decision). Check that the ruling is recorded, that the diff executes it and nothing more, and that it stays within the group role's authority. Anything in the role's `boundary` (a change that makes or changes a ruling, Door 2 or 3, complex mode, a breaking CLI or payload change, a pin bump in another repo, anything touching gates or merge rules, over budget) is an ESCALATION: add `gate:owner-merge`, comment why, and never approve.
7. FINDINGS: run `node /tmp/clerk/bin/clerk.mjs pr-check <repo>#<n> --repo <programme checkout>`; each `error` is a finding (a decision left in prose, a ruling with no record). List them; an empty list is stated as `findings: none`. Your quorum comment ends with `<!-- actor: agent:tpr-reviewer -->` on its own line.
8. QUORUM. Post ONE comment whose first line is exactly
   `<!-- wg-quorum --> builder=agent:tpr-builder reviewer=agent:tpr-reviewer gates=<green|red>@<sha> mandate=<ruling, no spaces> verdict=<approve|reject>`
   and whose later lines are the findings. Use the builder named in the PR. Red gates or findings mean `reject`: post it and add nothing.
9. On `approve` only, after posting, add `gate:auto-merge`. `pr-upkeep` merges on a valid quorum within budget.
10. A within-mandate decision the Builder created `proposed`: leave it `proposed`. Name it in your quorum comment's findings as `decision <id>: assent` (or `decision <id>: dissent, <why>`). The group's next session ratifies it (`routines/wg-steward.md` step 2). Never ratify it yourself: a decision is ratified in exactly one session (handbook principle 6; owner decision 70a05a5c, 2026-10-11).

## Routine config

- Model: sonnet.
- Sources: the-greenman/{semanticops.com, srs, srs-rust, srs-web, srs-vscode, srs-programme}.
- Triggers (GitHub `pull_request`, actions `opened`, `synchronize`, `labeled`, `reopened`), filtered to PRs labelled `wg:third-party-ready`, in: srs-rust, srs, srs-vscode, srs-web.
- Prompt: "You are the WG Third-party ready reviewer, SRS_ACTOR agent:tpr-reviewer. Read routines/wg-reviewer.md in the-greenman/clerk (default branch) and the settings record in the-greenman/srs-programme, and follow it for exactly one pull request: the one named in this event (repo and number). Exit quietly if it is not a wg:third-party-ready PR, if a valid quorum comment newer than its head commit exists, or if its Builder is you. Gates by exit code, mandate check, then post the quorum comment and, only on approve, add gate:auto-merge. Never merge, never build."
