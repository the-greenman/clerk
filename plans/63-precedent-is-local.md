# 63: Precedent is local

Issue: the-greenman/clerk#63 (part of #19). Answers SP-43; suggested SP-69, SP-70, SP-72. Spec gate: this is programme and clerk tooling (lib/practice, scripts, routines, charter), not a change to the SRS spec, schemas or CLI contract. No RFC.

## Ruling executed
Owner, 2026-10-09 and 2026-10-12: a rule holds at the boundary that made it; agents decide within the framework and only no-precedent or against-policy decisions reach the owner. Convention before enforcement (e337703b): the chain check only warns while boundaries are unaffirmed.

## Facts verified (srs-programme master a5a8398, pinned CLI build 502)
- Logs are containers whose identity is a `decision_log`: central 7fa3525e (84be7e34), TPR f6db54e2 (88c32389), Agent-supported editor 0ea1e1ce (e509eb61). A group's log container is also its group container (role, 4 articles, agents, decisions).
- Boundary chain by `narrows`: 841b9c0f (TPR) and 5739852c (AE) -> b3bcd516 (SRS implementation) -> b65cefc9 (SRS standard) -> fe501405 (SemanticOps). None is in Affirmed.
- A group's log -> boundary link already exists structurally: the group's 4 articles are `within-boundary` its boundary (4 + 4). The central log has no such link.
- 5 decisions sit in two logs (central + TPR): 84830ba8, 1bc2aae1, e337703b, 649139e1, b447e8ea. 384a704a (AE charter) sits in central + AE. 4 sit in none: 35299e1d, 5f2530ca, 8fdcc082, ee59155b.
- `mandate=\S+` (pr-upkeep.sh wg_verdict) is only regex-matched.
- charter.mjs copies the first group's `narrows` and tensions (adapters/charter.mjs `context`).
- Dual membership is not an accident: it is the designed escalation path (`routines/wg-steward.md` "Logs by context", `agenda.mjs` `escalationItems` and `ratifyItems`, `charter.mjs` op `member`). See D1.

## Design (structure, no new fields)
- A decision's scope = the one log container it is a member of. No scope field.
- A log's boundary = the `within-boundary` target of that log container's members. One rule for every log. Central needs one relation (decision_log 84be7e34 `within-boundary` fe501405), added as srs-programme data.
- Precedent chain for group G citing decision d: every log holding d has a boundary that is G's boundary or an ancestor of it by `narrows`. Never sideways, never from a child. d in no log, in a log with no boundary, or not a programme decision: `not covered: escalate`. d in several logs: covered if ANY log passes the chain; `logIssues` warns on several logs (reviewer finding 2; moot once D1 gives one log per decision). A log whose members point at 0 or more than 1 distinct boundary is `no boundary` / `ambiguous boundary`: not covered, and warned by `clerk check`. `provisional: true` when any boundary on the path is not in Affirmed.
- Resolution order: id resolves to a `governance/decision` -> checked; matches `^(RFC|ADR|I)-\d+` -> `not checked` (external record, exit 0); anything else, including a typo -> `not covered`. The central group is addressed as `--group central` (it has no label).

## Phases (each ends with `npm test` by exit code)
1. Pure core: `lib/practice/precedent.mjs` (no Node built-ins). `logsOf(d, logs)`, `boundaryOfLog(log, withinBoundary)`, `ancestors(b, narrows)` (cycle-safe), `covers({group, cited, logs, relations, affirmed})` -> `{covered, why, provisional, path}`, `logIssues(decisions, logs)` -> decisions in zero or several logs. Tests `test/precedent.test.mjs` on fixtures extending `test/groups.fixture.mjs`: own log, ancestor log, sideways (AE cites TPR), child, none, several, id prefix, unresolved, cycle, provisional. Purity test already guards the folder.
2. Adapter + command: `lib/adapters/precedent.mjs` loads decisions, containers (`container get` members), `within-boundary`/`narrows` relations, Affirmed members. `clerk precedent <id> --group <label> [--json]` (exit 0 covered or not checked, 2 not covered) registered in `bin/clerk.mjs` TOOLS and `docs/tools.md`. `check-method.mjs` main prints `!` warnings from `logIssues` (decision in zero or several logs) and from boundary-chain breaks (a group log with no boundary); warnings only, exit unchanged.
3. Quorum check: `scripts/pr-upkeep.sh` new `wg_precedent <label> <mandate>` (calls `clerk precedent`), used in the group-PR branch after `wg_verdict` returns ok; a not-covered result prints `WARN  <pr> mandate <id> not covered (<why>)` and is listed in that group's digest section; it does not change `why` (warn-only; enforcing later is a code change under its own owner decision, no switch built now). Quorum line gains `ruling=<decision id | RFC-n | n/a>` after `mandate=` (the existing `mandate=` is the charter decision, trivially covered; `Ruling:` is what is executed); `wg_verdict`'s regex takes `ruling=` as optional so older comments still parse; the check reads `ruling=`. `scripts/pr-upkeep.test.sh` gains covered, uncovered and warn-only cases.
4. Charter: `planCharter` takes `--narrows <boundary id>` (required once any boundary exists; replaces `--from`) and creates the boundary with `narrows` and NO `holds-tension` and no copied articles; adapters/charter.mjs stops reading the first group's compass. The charter decision is a member of the parent (owner) log only, like 00567bf1 (today it is also put in the group log). Dry-run output states "compass empty: the group builds it". Tests in `test/charter.test.mjs`. Needs D3. Also: `check-method.mjs` rule change (a boundary that `narrows` another and holds 0 tensions is a `!` warning "compass pending", not an error; 1-2 tensions or a root with <3 stays an error) with a case in `check-method.test.mjs`; `scripts/charter.mjs`, usage text and `docs/tools.md` lose `--from`; tests that read `ctx.compass` are rewritten; the first group also has a parent boundary, so `--narrows` is simply required; the group's article a-minutes and wg-steward wording say the charter belongs to the parent log.
5. Routines and docs: wg-builder.md (PR body `Mandate:`/`Ruling:` cite a decision in the group's own log or an ancestor's; run `clerk precedent` before building; not covered = escalation), wg-reviewer.md (step 6 runs it; not covered = escalate, never approve; quorum `mandate=` is the decision id), wg-steward.md (decided-within-mandate section; "Logs by context" per D1), docs/tools.md, handbook records for Working groups (via srs CLI, then `render-handbook`, commit both). Agent decisions recorded within mandate need no owner act; nothing here routes a decision to the owner.
6. Agenda follow-up per D1 (`escalationItems`, `ratifyItems`), only if D1 is answered A.

## Sequence
Data PR first for the clear rows and the central `within-boundary` relation (so phases 2-3 do not warn on known-fixable data); D2 rows stay in two logs until answered, so the warning fires for them meanwhile (acceptable, warn-only). BLOCKED on owner: D1 gates phases 2 (what the several-logs warning flags), 5 (steward wording) and 6; D3 gates phase 4. Phase 1 and the clear-row data PR can proceed now.

## Data PR (separate, srs-programme; pinned CLI; never `container update`)
Per decision, `container members remove|add` only, then `repo validate` (0 errors) and `clerk check`:
| Decision | Now in | Evidence | Target log |
|---|---|---|---|
| b447e8ea Analyst for TPR | central + TPR | content is TPR's own queue; relayed from TPR's first report | TPR |
| 384a704a Charter AE | central + AE | charters are granted by the parent (00567bf1 is central only); ratified in owner session d4c96839 | central |
| e337703b Convention before enforcement | central + TPR | general norm; cited by programme decisions ee59155b and e56d6893 (derived-from) | central |
| 84830ba8 Rendered order | central + TPR | srs rendering behaviour; ratified in owner session d588a950; no SRS-level log exists | AMBIGUOUS (D2) |
| 1bc2aae1 Package checks | central + TPR | srs-rust package check; same session; no SRS-level log | AMBIGUOUS (D2) |
| 649139e1 Advisory diagnostics | central + TPR | spec and programme warnings; same session | AMBIGUOUS (D2) |
| 35299e1d id canonicalisation | none | refines e3ed9e54, derived-from 071eadb2 (both central) | central |
| 5f2530ca enablers first | none | refines 3c8b94d1 (central) | central |
| 8fdcc082 daily review | none | refines 3c8b94d1 (central) | central |
| ee59155b grounded in domain | none | refines e3ed9e54, derived-from e337703b (central) | central |
Also: relation 84be7e34 `within-boundary` fe501405 (central log's boundary). The 3 ambiguous rows wait for D2.

## Architecture decisions
| Decision | Choice | Source |
|---|---|---|
| Where the check lives | one pure function in lib/practice; pr-upkeep and check call it through the CLI | CLAUDE.md rule, one way per goal |
| Scope representation | log membership + existing `within-boundary` and `narrows`; no field | structured over serialised; two levels of rules |
| Strictness | warn-only until a separate owner decision | e337703b |
| New ADR | none (clerk has no ADR dir; the rule is a handbook principle) | |

## Out of scope
Affirming the boundary chain (owner act, on the agenda); PR authority (SP-71); a log per boundary level (D2); enforcing the check.

## Owner decisions needed
- D1 Where an owner ruling on a group escalation lives (one log vs the designed both-logs path).
- D2 Scope of 84830ba8, 1bc2aae1, 649139e1.
- D3 Does the D6 rule (boundary holds >= 3 tensions) apply to a fresh group boundary that starts empty?
