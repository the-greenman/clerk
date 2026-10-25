---
description: Take one issue through the clerk handbook chain (ground → route → claim → build → review → PR → report) as a local member session.
argument-hint: <repo>#<n>  (e.g. srs-web#576)
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, TodoWrite, WebFetch, Skill
---

# /ship — one issue through the clerk handbook

> $ARGUMENTS

The process is `clerk/docs/handbook.md`, flow rows 6 to 12: issue admission, routing, claim and build, review, merge, report. This command is how a local session goes through it. A local session acts as a **member under the same rules** as the routines (decision f799b6bc). With the owner present, it follows one of two briefs: `clerk/routines/wg-builder.md` for a working-group issue, or `clerk/routines/unattended-worker.md` "Per issue" for the central group. If this file disagrees with the handbook or a brief, the handbook or brief wins: follow it and note the drift in the run report.

Track the stages with TodoWrite. Do not stop between stages, except at these **three checkpoints**:

| # | Checkpoint | When |
|---|---|---|
| A | Grounding | the issue names no usable problem (none, unknown or set aside) |
| B | Dependency | it needs a spec change, a new core capability or a WASM binding first |
| C | Decisions | an escalation, or a ruling with long-term consequences |

The terminal state is **PR open, gates green, run report posted**. Never wait for the merge: the `Closes` line closes the issue.

Below, "stage N" means this command's stages, not the handbook's.

Shorthands: `SO=$HOME/dev/semanticops`, `CLERK="node $HOME/dev/semanticops/clerk/bin/clerk.mjs"`, `PROG=$HOME/dev/semanticops/srs-programme`, `ME='{"kind":"human","id":"human:the-greenman"}'`. `ME` is the owner's actor, the same as `settings.ownerActor`. The login shell is fish, so wrap bash idioms in `bash -c`. In a cloud session the checkouts sit at `/home/user/<repo>` (`CLERK="node /home/user/clerk/bin/clerk.mjs"`, `PROG=/home/user/srs-programme`); `ME` is unchanged. Shell state does not persist between commands: write the values out on each command line.

---

## 0 — Preflight

1. Check that the signing key is loaded: `ssh-add -l | grep -q "SHA256:vHuO6si5w3RLL4IJZofWbyvEi42WA2fYX7bM"`. If it is not, stop. `gh auth status` must succeed.
2. Make sure the practice and the data are fresh: `git -C $SO/clerk pull --ff-only` and `git -C $SO/srs-programme pull --ff-only`. If either checkout is dirty or has diverged, stop: do not work from stale rules.
3. Run `$CLERK settings --repo $PROG --json`. Where it differs from a value written here (owner, governed repos, report issue), the settings record wins.
4. Load project memory: run the `srs-context` skill, and `find` on the component and on the issue's subject. Read the target repo's `CLAUDE.md`, including "Gates and choreography" where the repo has one.

## 1 — Admission: is the issue grounded? (checkpoint A)

Read the issue: `gh issue view <n> --repo the-greenman/<repo>`.

**First, is someone already on it?** Look for a `Claimed by …` comment, a `status: in progress` label, an assignee, an open PR that closes it (`gh pr list --repo the-greenman/<repo> --search "<n>" --state open`), or a branch named for it. A group's builder routine may have taken it since you last looked. If any of these exists, do not build. Report the claim or the PR, with its CI and review state, and stop. Getting an open PR to merge is the group's reviewer's job and then the owner's, not a second builder's.

**Then read its dots and its care mode.** `clerk flow` reads the same dots as every other command and brief, and `clerk care` reads the same mode as `clerk claim` (decision 9d50126b, *Confidence grades care, it does not gate work*):

```bash
$CLERK flow --chain <repo>#<n> --repo $PROG    # each dot: problem, epic, lane, plan, blockers, hold
$CLERK care <repo>#<n> --repo $PROG            # the care mode: Build, Careful, Careful group-reviewed or Probe
```

The issue's first line is `Answers: SP-nn`, naming a problem that is suggested or affirmed. Affirmation is not a gate: how sure the grounding is sets the care mode, and you work in that mode. Stop at checkpoint A only when the **problem** dot fails.

**A problem is a user's need, never a technical concern.** It is held by a persona in a domain and says what is wrong *for them*. "Code lives in the wrong layer", "this is duplicated" or "another app can't reuse this" are not problems. They are implementation principles the work upholds, such as capability layering (`srs-rust/docs/architecture/capability-layering.md`) and ADR-048. Cite them as the `principle` in the decisions block (this command's stage 5). A technical issue answers the user-facing problem whose work it serves or unblocks: ask *whose need is this work for, and in which domain?*

If the problem dot fails (no `Answers:` line, `No affirmed problem yet: …`, or a problem that is unknown or set aside):

1. Name the user and the need behind the work, and the domain where it happens. Then look through the problems for that need, affirmed ones first. Read titles and statements with `srs record list --repo $PROG --type com.semanticops.method/problem`. Use `$CLERK roadmap --explain` to see which problems serve a ranked objective.
2. **Ask the owner.** Offer at most three candidates, each with one line on why it fits. Then:
   - **A problem fits:** change the issue's first line to `Answers: SP-nn`. Keep the old sentence below it as context, restated as the principle it upholds where it was a technical concern. Continue in the mode `clerk care` gives.
   - **No problem holds the user's need:** search for duplicates first. Then add a problem **suggestion** to srs-programme's Suggestions through the CLI, with `SRS_ACTOR` set to an AI actor and a `held-by` link to a persona-in-domain where one exists. Name it in `Answers:` and continue in the mode `clerk care` gives (an agent's own suggestion grades low, so this is usually Probe). Never affirm it yourself, and never file a technical concern as a problem. Never ask the owner to affirm records in chat; affirmation is its own layer, in the affirmation editor (srs-web#617) and at Affirmation review meetings (handbook, *Narrative explorations*, step 6).

## 2 — Routing: join the dots

The problem's domain decides the group (handbook "How an issue reaches a group", decisions D4, D5 and D15). `clerk flow` already says which dots are missing. **Join every dot it marks `auto`**, citing the rule it names: the lane or group label, the sub-issue link that a "Part of" line names, the blocked-by link that a "Blocked by" line names. A dot that is not `auto` is a choice. For example, two groups both hold the domain, the issue already has a parent, or the epic is parked. Put that choice to the owner in one line. Run `flow --chain` again until only the dots you cannot join remain.

- **A group takes it** (its `wg:` label, and the group works in this repository):
  - **Mandate** (`routines/wg-builder.md` step 5): the issue must name the recorded ruling, RFC, invariant or affirmed remedy it executes, or be non-normative. If not, go to the escalation in stage 5.
  - **Pause and budget** (wg-builder step 1):
    ```bash
    $CLERK group-state <wg:label> --repo $PROG --json    # pause must be ok, room above 0, exit 0
    ```
    Paused or over budget: comment on the issue, add `needs-input`, stop.
- **Otherwise:** the work belongs to the **central group** (SemanticOps, the Owner role), labelled `lane:unattended`, and the owner's session holds its builder seat.
- **Linking a parent:** `CLERK_REPO=$PROG $CLERK board link <parent-repo>#<n> <repo>#<n>` (`board` reads the programme from `CLERK_REPO`, not `--repo`).

## 3 — Claim

```bash
SRS_ACTOR=$ME $CLERK claim <repo>#<n> --as builder --branch <n>-<slug> --repo $PROG
```

Start only if this exits 0. Exit code 2 prints the reasons for the refusal: fix the cause in stage 1 or 2, or stop. Never assign or label the issue by hand.

**Guards.** If the issue lists a guard or a "check first" step, do it now, before any code. If it trips, comment the evidence and stop.

**On any stop from here on**, follow the briefs: add `needs-input` to the issue, put the exact question in the run report (stage 9, `landed_as: nothing: needs owner: <question>`), and leave the claim comment in place.

## 4 — Dependency gate (checkpoint B)

Before planning, ask whether the work needs something that does not exist yet:

- a **spec change** (data model, validation semantics, schema or the canonical CLI contract): run `/rfc`;
- a **core capability** (query, filter, traverse, validate or project): it is built once in `srs-repository` and exposed through both the CLI and WASM, as in `srs-rust/docs/architecture/capability-layering.md`. A client never re-implements it;
- a **WASM binding** that srs-web does not have.

If any of these is needed:

1. File the dependency issue, with its own `Answers:` line.
2. Link it as blocking this issue, and comment on this issue.
3. Label this issue `blocked` and stop.

If none is needed, say so in one sentence and go on.

## 5 — Plan and decisions (checkpoint C)

1. Create the worktree with `scripts/wt new <repo> <n>-<slug>`, never `git worktree add`. Then `git rev-list --count HEAD..origin/<default>` must print 0. The default branch is `master` for srs, srs-rust, srs-vscode and srs-programme, and `main` for srs-web, clerk and semanticops.com.
2. Post a short plan as an issue comment: what "done" means, the files to touch and the gates to run. For a large change, also do the repo's own planning stage: `srs-rust/.claude/commands/ship.md` stage 2 (plan template and ADR check) or `srs-web/.claude/commands/ship-web.md` stage 2.
3. Classify every decision the work makes into one of three classes (`clerk/docs/pr-decisions.md`):
   - **Choice:** nothing later will point at it. Make it, and cite the `principle` or `lean` it follows.
   - **Ruling:** it passes the four tests (Reuse, One thing, Timeless, Testable) and is inside the mandate. Create a `proposed` `governance/decision` in the group's log through the CLI. Fill `decision_question` and at least Resolution, Why, Options (including doing nothing) and Review. Act on it now; the group's session ratifies it later.
   - **Escalation:** it is outside the mandate. That means a new ruling for the parent, Door 2 or 3, a breaking CLI or payload change, a change to gates or merge rules, or going over budget. Create one `proposed` decision in the parent's log, written at the owner's level, as `routines/wg-builder.md` "Escalation" describes. Add `needs-input` to the issue. **Stop and put it to the owner.** This is the one design pause. Do not build the escalated part until it is answered.

## 6 — Build and gates

1. Implement only what "done" requires. Commit at milestones with messages ending `(<repo>#<n>)`, using plain signed `git commit`, and end each message with the `Co-Authored-By:` trailer for the model running the session (the briefs name Sonnet because the routines run on it).
2. Run the gates **by exit code, never piped**:
   - srs and srs-rust: the gates in the repo's `CLAUDE.md` "Gates and choreography".
   - srs-web: the stage 6 gates in `ship-web.md`: `npm run typecheck && npm run lint && npm run build && npm test`.

   If a gate was already red on the last green commit of the default branch, report that with evidence instead of fixing it here. Never weaken a test.
3. Before review, run `git fetch && git rebase origin/<default>`, then run the gates again.
4. In the same PR, update any docs the change makes wrong, as in the repo pipeline's docs pass.
5. File an issue for anything in SRS or the tools that slowed you (principle 9, dogfood everything). Give each its own `Answers:` line and a parent.

## 7 — Review

- **Central group:** spawn a reviewer subagent; never review your own work. Give it the issue, the plan comment and `git diff origin/<default>...HEAD`. It checks correctness, completeness against "done", anything missed (other callers, goldens, bindings, docs), over-engineering, and decisions missing from the `srs-decisions` block. Fix what it finds and run the gates again.
- **Working group:** do the same self-review. Then leave the quorum to the group's reviewer routine (`routines/wg-reviewer.md`), which posts `<!-- wg-quorum -->` and the gate label. Never post your own quorum.

## 8 — PR

Push, then open the PR with `gh pr create --base <default>` and this body:

````
<the classification line the repo's CLAUDE.md prescribes (Mode, Cell, Door), if it has one>

Closes the-greenman/<repo>#<n>
Answers: SP-nn
Part of <epic or story>
Builder: human:the-greenman (local /ship session)
Mandate: <the group's charter decision id, or "central group">
Ruling: <the ruling, RFC, invariant or affirmed remedy executed, or "none; non-normative">

## What
…

## Gates
<command> → exit <code>   (one line per gate)

## Review
<each finding and what was done about it>

```srs-decisions
{ "by": "human:the-greenman", "answers": ["SP-nn"], "made": [ … ], "asks": [ … ], "review": { "builder": "human:the-greenman", "focus": "…" } }
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
````

Labels:

- **Working group:** its `wg:` label and **no** `gate:` label.
- **Central group, clear or complicated mode, and Door 1 or non-normative:** `gate:auto-merge`.
- **Central group, anything else** (mode complex, Door 2 or 3, a new dependency, a user-visible product change, or anything you are unsure of): `gate:owner-merge`, with the question for the owner as an `asks` entry in the block, well formed per `docs/pr-decisions.md` (two or more courses of action including "Do nothing", never dispositions, placed on a tension where one fits).

Then `$CLERK pr-check <repo>#<pr> --repo $PROG` must exit 0; fix every error it reports.

Watch CI with `gh pr checks --watch`. Fix failures until every check is green or you hit a real blocker. If a failure is a flake that predates this PR, say so in a PR comment.

## 9 — Report and capture

1. Post a **run report** as a comment on the issue (handbook "Routines review, report and allocate"), with these lines:
   - **chose:** what you did, and the decisions with their ids
   - **figures:** each gate and its exit code, files changed, lines added and removed
   - **landed_as:** the PR URL, or "nothing: needs owner: <question>"
   - **friction:** what slowed you or was missing
   - **what we learned:** which part of the process held and which did not (the handbook's "Report what you learned" rule for every report)
2. Record what you learned (decisions, traps, conventions) in srs-context through its skill. In a worktree, write with the CLI and `--repo` pointing at the worktree's context path, not through MCP.
3. Report to the owner:
   - the issue, the problem it answers and the group;
   - the claim;
   - the decisions: choices, ruling ids and asks;
   - the PR URL and its CI state;
   - any follow-up issues you filed.

   If you stopped early, name the checkpoint and the exact question.
