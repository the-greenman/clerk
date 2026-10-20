# The service layer: `clerk serve`

`clerk serve` is the clerk's local service. It keeps the programme's state current without a dev server, and lets a web client reach the clerk's functions. It is **one more thin adapter**, over `lib/practice` (pure rules) and `lib/adapters` (reads and writes), beside the CLI. It holds no semantics of its own: the clerk's version of srs's capability layering (`srs-rust/docs/architecture/capability-layering.md`), where `srs mcp serve` sits over `srs-repository` the same way.

The first client is the control room in srs-lab, the owner's programme dashboard. The client stays in srs-lab while its views change. This layer exists for semanticops.com#38 (One always-on owner desk; remedy 6858b178), which answers SP-61, SP-63, SP-59 and SP-49.

Status: **planned**. Building starts with clerk#97. The rules cite three decisions proposed in the SemanticOps decision log (two rulings and one escalation the owner has answered), which hold as proposals until a session ratifies them.

## Where it sits

```
control room (srs-lab: views, experiments)
   │  /api/*  → clerk serve        (graduated capabilities)
   │  /lab/*  → lab middleware     (experiments, until they graduate)
clerk serve   (node:http; loopback only)
   ├─ jobs: owner-local schedules (sync srs-programme and the clerk; desk snapshot)
   ├─ endpoints: one clerk function each
   └─ lib/adapters (gh, git, srs CLI) → lib/practice (pure)
GitHub Actions and cloud routines: unchanged (upkeep, board, priority, pages)
```

In clerk#94's layer map, **service** is a transport **beside commands**: both sit over **rules** (`lib/practice`) and **reads and writes** (`lib/adapters`), and an endpoint calls those in-process rather than shelling out to a command. **Deployment** runs it (a systemd user unit, Caddy).

## Rules

1. **One function per endpoint, no semantics in the server.** If the service and the CLI could disagree about an answer, the logic is in the wrong place: it belongs in `lib/practice`.
2. **Graduation** (ruling `a1b06725`, proposed): a capability enters the service only after it is a `clerk` command with `--json` output, has been used for real, has not changed shape since the last session of the group that holds it, and has tests at every layer it touches. It also gets a line in [tools.md](tools.md). Until then it stays in srs-lab.
3. **The spec leads** (ruling `46bb7a8c`, proposed): `api/openapi.json` (OpenAPI 3.1) is the single source of the contract. Routes, request validation and client types derive from it. Gates in clerk#97 enforce it:
   - no opaque `{}` schemas: SRS data refers to the canonical entity schemas from the pinned srs release;
   - conformance checked against live responses, not fixtures;
   - a version bump for any breaking change.

   These close the gaps through which srs-rust's interface drifted (srs-rust#818, #1258).
4. **Reach** (escalation `e745e9b2`, answered by the owner on 2026-10-20, proposed for ratification):
   - `clerk serve` binds to **loopback only**.
   - The control room is published only to loopback and the owner's **private ZeroTier network**, as `https://control.semanticops.com` through the desktop's Caddy, which drops every other source.
   - Network membership is the access control. The service acts with the owner's authority (signed commits, the owner's GitHub token).
   - Acts also need the `x-control-room` header, a guard against other sites driving the browser.
5. **Never duplicate the shared schedules.** Upkeep, board sync, priority and pages stay in GitHub Actions. The service runs only what is local to the owner.
6. **`node:http`, no framework.** The one runtime dependency is ajv, which validates requests against the spec at the trust boundary.

## Inventory: the control room's server functions

Where each one goes. The control room's own copy is deleted when it graduates.

| In srs-lab today | Status | Goes to |
|---|---|---|
| Live sync: fast-forward srs-programme and the clerk when clean, re-extract the snapshot and desk, under a pid lock with atomic swaps | stable | **clerk#97**: the service's scheduler |
| Read allowlist: settings, groups, roadmap, explain, queue, check, desk, ground | stable, all commands; `check`, `queue` and `desk` have no `--json` yet | **clerk#97**: endpoints calling the functions in-process, after the missing `--json` outputs are added |
| Desk snapshot (`extract/desk.mjs`: `gatherDesk` and `deskBody`, plus epics with their tasks and PR detail) | stable | **clerk#97**: a new `clerk desk --json`. The epics and PR detail it adds move with it, or stay a lab extract until they settle |
| Programme snapshot, record and similar reads | stable, but SRS-generic | **srs**: the service runs the srs CLI. A whole-graph read and lineage are srs-rust#1415 and #1416 |
| Affirmation rounds (start, publish through the CI gates, finish), the workbench state (`/api/workbench`) and its snapshot (`publishSnapshot`, `dropWorkbenchEntry`) | first real round 2026-10-20 (srs-programme#180) | **clerk#98**, after a second real round |
| Method acts: affirm, set aside as a human fork, hold for review, restore, comment | corrected after srs-programme#170 | **clerk#99**, next to `scripts/check-method.mjs` |
| PR answers and review requests (`srs:answer`, `srs:review-request`) | prototype | with clerk#99, next to `lib/practice/pr-decisions.mjs` |
| Judgement and weight, tensions, growth, scenarios, the learning ledger and feed (`/api/ledger`, `/api/feed`) | experimental | **stays in srs-lab** |

## Testing

A capability graduates with tests at every layer it touches. The clerk's conventions hold: `node --test`, fixtures, adapters tested with injected functions, and CI with no srs CLI on PATH.

- **Tier 1** (`npm test`): practice, adapters with recording fakes, and the server on an ephemeral port. The cases are listed on clerk#97.
- **Tier 2** (a CI job with `clerk fetch-srs`): a real `clerk serve` and real git against a fixture programme, a local bare remote and a fake `gh` (clerk#97, clerk#98).
- **Tier 3** (srs-lab CI): the control room as a typed client (srs-lab#7).

## Running it (once clerk#97 lands)

A systemd user unit on the owner's desktop runs `clerk serve` on loopback, with the owner's SSH agent for signed commits and `gh` auth from the user. Caddy publishes the control room. Until clerk#97 lands, `npm run dev:desk` in srs-lab serves the control room on `127.0.0.1:5180`.

## Not here

- SRS-generic capabilities: they go down into srs-rust (srs-rust#1415, #1416).
- Method rules that are really constraints ("a tension contains exactly 2 poles"): they become package data where RFC-048 can express them (srs#820), and stay in `check-method` until then.
- A hosted or shared view.
