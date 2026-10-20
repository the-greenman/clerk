# The service layer: `clerk serve`

`clerk serve` is the clerk's local service. It keeps the programme's state current without a dev server, and lets a web client reach the clerk's functions. It is **one more thin adapter**, over `lib/practice` (pure rules) and `lib/adapters` (reads and writes), beside the CLI. It holds no semantics of its own: the clerk's version of srs's capability layering (`srs-rust/docs/architecture/capability-layering.md`), where `srs mcp serve` sits over `srs-repository` the same way.

The first client is the control room in srs-lab, the owner's programme dashboard. The client stays in srs-lab while its views change. This layer exists for semanticops.com#38 (One always-on owner desk; remedy 6858b178), which answers SP-61, SP-63, SP-59 and SP-49.

Status: **planned**. The rules below are proposed rulings in the SemanticOps decision log, until a session ratifies them. Building starts with clerk#97.

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

In clerk#94's layer map, **service** consumes **commands** and sits above **deployment**.

## Rules

1. **One function per endpoint, no semantics in the server.** If the service and the CLI could disagree about an answer, the logic is in the wrong place: it belongs in `lib/practice`.
2. **Command first, then endpoint.** A capability enters the service only after it is a `clerk` command with `--json` output, tests, and a line in [tools.md](tools.md).
3. **Graduation** (proposed ruling `a1b06725`): a capability leaves srs-lab only after it is a command, has been used for real (for affirmation rounds, two or more real rounds), has gone a cycle unchanged, and has tests at every layer it touches. Until then it stays in the lab.
4. **The spec leads** (proposed ruling `46bb7a8c`): `api/openapi.json` (OpenAPI 3.1) is the single source of the contract.
   - Routes and request validation derive from it: startup fails if an operation has no handler, or a handler has no operation.
   - Clients generate their types from it.
   - `clerk … --json` outputs share its schemas.
   - No schema is opaque (`{}`): SRS data refers to the canonical entity schemas from the pinned srs release.
   - Conformance is checked against live responses, not fixtures, and a breaking change needs a major version.
   - These close the three gaps through which srs-rust's interface drifted: opaque schemas (srs-rust#818, #1258), hand-written client types checked only against fixtures, and cross-repo checks that skip.
5. **Reach** (proposed ruling `e745e9b2`): the service acts with the owner's authority (signed commits, the owner's GitHub token), so reaching it is reaching that authority.
   - `clerk serve` binds to **loopback only**.
   - The control room is published only to loopback and the owner's **private ZeroTier network**, as `https://control.semanticops.com` through the desktop's Caddy, which drops every other source.
   - Network membership, which the owner authorises, is the access control. Acts also need the `x-control-room` header, a guard against other sites driving the browser.
   - Scoped tokens (`read`, `act`) come when a second client runs its own app.
6. **Never duplicate the shared schedules.** Upkeep, board sync, priority and pages stay in GitHub Actions. The service runs only what is local to the owner.
7. **`node:http`, no framework.** The one runtime dependency is ajv, which validates requests against the spec at the trust boundary.

## Inventory: the control room's server functions

Where each one goes. The control room's own copy is deleted when it graduates.

| In srs-lab today | Status | Goes to |
|---|---|---|
| Live sync: fast-forward srs-programme and the clerk when clean, re-extract the snapshot and desk, under a pid lock with atomic swaps | stable | **clerk#97**: the service's scheduler |
| Read allowlist: settings, groups, roadmap, explain, queue, check, desk, ground | stable (already commands) | **clerk#97**: endpoints calling the functions in-process |
| Desk snapshot (`extract/desk.mjs`, which already uses `gatherDesk` and `deskBody`) | stable | **clerk#97**: `clerk desk --json` |
| Programme snapshot, record and similar reads | stable, but SRS-generic | **srs**: the service runs the srs CLI. A whole-graph read and lineage are srs-rust#1415 and #1416 |
| Affirmation rounds (start, publish through the CI gates, finish) | first real round 2026-10-20 (srs-programme#180) | **clerk#98**, after a second real round |
| Method acts: affirm, set aside as a human fork, hold for review, restore, comment | corrected after srs-programme#170 | **clerk#99**, next to `scripts/check-method.mjs` |
| PR answers and review requests (`srs:answer`, `srs:review-request`) | prototype | with clerk#99, next to `lib/practice/pr-decisions.mjs` |
| Judgement and weight, tensions, growth, scenarios, learning feed | experimental | **stays in srs-lab** |

## Testing

A capability graduates with tests at every layer it touches. The clerk's conventions hold: `node --test`, fixtures, adapters tested with injected functions, and CI with no srs CLI on PATH.

- **Tier 1** (`npm test`):
  - pure practice;
  - adapters with recording fakes (for example, publish stops at the first failed gate and pushes nothing);
  - the server on an ephemeral port: routes, the error envelope, loopback-only binding, refusals, the sync lock, atomic swaps;
  - no opaque schemas, and every response validated against the spec;
  - an import-contract test for each clerk module srs-lab imports.
- **Tier 2** (a separate CI job with `clerk fetch-srs`): a real `clerk serve` and real git against a fixture programme, a local bare remote and a fake `gh`. It drives a full round, with `srs repo validate` and `clerk check` after each step, and the failure paths.
- **Tier 3** (srs-lab CI, srs-lab#7):
  - the control room's model tests;
  - a headless smoke of every view against a stub, with every write intercepted;
  - generated client types, regenerated and diffed;
  - the clerk checked out at its pinned commit, with no skip.

Each bug the lab has met becomes a regression test when its capability graduates. The list lives on clerk#97 to #99.

## Running it (once clerk#97 lands)

A systemd user unit on the owner's desktop runs `clerk serve` on loopback, with the owner's SSH agent for signed commits and `gh` auth from the user. Caddy publishes the control room. Until clerk#97 lands, `npm run dev:desk` in srs-lab serves the control room on `127.0.0.1:5180`.

## Not here

- SRS-generic capabilities: they go down into srs-rust (srs-rust#1415, #1416).
- Method rules that are really constraints ("a tension contains exactly 2 poles"): they become package data where RFC-048 can express them (srs#820), and stay in `check-method` until then.
- A hosted or shared view.
