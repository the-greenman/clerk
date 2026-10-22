# The service layer: `clerk serve`

`clerk serve` is the clerk's local service. It keeps the programme's state current without a dev server, and lets a web client reach the clerk's functions. It is **one more thin adapter**, over `lib/practice` (pure rules) and `lib/adapters` (reads and writes), beside the CLI. It holds no semantics of its own: the clerk's version of srs's capability layering (`srs-rust/docs/architecture/capability-layering.md`), where `srs mcp serve` sits over `srs-repository` the same way.

The first client is the control room in srs-lab, the owner's programme dashboard. The client stays in srs-lab while its views change. This layer exists for semanticops.com#38 (One always-on owner desk; remedy 6858b178), which answers SP-61, SP-63, SP-59 and SP-49.

Status: **phase 1 built** (clerk#97): reads, the sync job and the snapshots. Rounds (clerk#98) and method acts (clerk#99) graduate later. The rules cite three decisions proposed in the SemanticOps decision log (two rulings and one escalation the owner has answered), which hold as proposals until a session ratifies them.

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

In clerk#94's layer map, **service** is a transport **beside commands**: both sit over **rules** (`lib/practice`) and **reads and writes** (`lib/adapters`), and an endpoint runs the clerk command of the same name as a child process, so the server holds no logic of its own. **Deployment** runs it (a systemd user unit, Caddy).

## Rules

1. **One function per endpoint, no semantics in the server.** If the service and the CLI could disagree about an answer, the logic is in the wrong place: it belongs in `lib/practice`.
2. **Graduation** (ruling `a1b06725`, proposed): a capability enters the service only after it is a `clerk` command with `--json` output, has been used for real, has not changed shape since the last session of the group that holds it, and has tests at every layer it touches. It also gets a line in [tools.md](tools.md). Until then it stays in srs-lab.
3. **The spec leads** (ruling `46bb7a8c`, proposed): `api/openapi.json` (OpenAPI 3.1) is the single source of the contract. Routes, request validation and client types derive from it. Gates in clerk#97 enforce it:
   - no opaque schemas, and every object closed (`additionalProperties` said explicitly): an extra or renamed field fails. The one escape is `x-clerk-any` with its reason (an SRS field value, typed by its record's Type). When an endpoint first returns raw SRS entities, it refers to the canonical entity schemas from the pinned srs release;
   - conformance checked against live responses, not fixtures;
   - `info.version` names the contract; a breaking change bumps its major version. Review holds this today, not a gate.

   These close the gaps through which srs-rust's interface drifted (srs-rust#818, #1258).
4. **Reach** (escalation `e745e9b2`, answered by the owner on 2026-10-20, proposed for ratification):
   - `clerk serve` binds to a **literal loopback address only**, and answers only requests whose `Host` names it (plus `CLERK_HOSTS`). Loopback alone doesn't stop a web page that rebinds its own domain to 127.0.0.1; the `Host` check does.
   - The control room is published only to loopback and the owner's **private ZeroTier network**, as `https://control.semanticops.com` through the desktop's Caddy, which drops every other source.
   - Network membership is the access control. The service acts with the owner's authority (signed commits, the owner's GitHub token).
   - Acts also need the `x-control-room` header, a guard against other sites driving the browser.
5. **Never duplicate the shared schedules.** Upkeep, board sync, priority and pages stay in GitHub Actions. The service runs only what is local to the owner.
6. **`node:http`, no framework, no runtime dependencies.** srs-programme's workflows and the cloud routines run `node bin/clerk.mjs` from a bare checkout with no `npm install`. So query parameters are checked by `lib/practice/api.mjs`, which derives the checks from the spec and refuses at startup any parameter rule it can't enforce. ajv is a devDependency, used by the tests to validate every response against the spec. Ruling `c04d8164` (proposed); `test/runtime-imports.test.mjs` holds the line.
7. **Each cadence fits its cost.** The programme snapshot reads only the srs CLI and refreshes every `CLERK_SYNC_MINUTES` (5). The desk reads GitHub heavily, about 150 API calls with several per open PR, so it refreshes every `CLERK_DESK_MINUTES` (30). Refreshing it every 5 minutes exhausted the 5,000-an-hour limit on 2026-10-22. `POST /api/sync` refreshes both.

## Inventory: the control room's server functions

Where each one goes. The control room's own copy is deleted when it graduates.

| In srs-lab today | Status | Goes to |
|---|---|---|
| Live sync: fast-forward srs-programme and the clerk when clean, re-extract the snapshot and desk, under a pid lock with atomic swaps | stable | **clerk#97**: the service's scheduler |
| Read allowlist: settings, groups, roadmap, explain, queue, check, desk, ground | stable, all commands | **clerk#97, done**: each endpoint runs the command. JSON where the command prints it (`settings`, `groups`, `roadmap`, `queue`, `ground`); `explain` and `check` return their text and exit code. The desk is served only from its snapshot (`/api/data/desk`): a live desk costs about 150 GitHub calls a request |
| Desk snapshot (`extract/desk.mjs`: `gatherDesk` and `deskBody`, plus epics with their tasks and PR detail) | stable | **clerk#97, done**: `clerk desk --json` (srs-lab's `CR_CLOSED_DAYS` is `CLERK_CLOSED_DAYS` here) |
| Programme snapshot, record and similar reads | stable, but SRS-generic | **srs**: the service runs the srs CLI. A whole-graph read and lineage are srs-rust#1415 and #1416 |
| Affirmation rounds (start, publish through the CI gates, finish), the workbench state (`/api/workbench`) and its snapshot (`publishSnapshot`, `dropWorkbenchEntry`) | first real round 2026-10-20 (srs-programme#180) | **clerk#98**, after a second real round |
| Method acts: affirm, set aside as a human fork, hold for review, restore, comment | corrected after srs-programme#170 | **clerk#99**, next to `scripts/check-method.mjs` |
| PR answers and review requests (`srs:answer`, `srs:review-request`) | prototype | with clerk#99, next to `lib/practice/pr-decisions.mjs` |
| Judgement and weight, tensions, growth, scenarios, the learning ledger and feed (`/api/ledger`, `/api/feed`) | experimental | **stays in srs-lab** |

## Testing

A capability graduates with tests at every layer it touches. The clerk's conventions hold: `node --test`, fixtures, adapters tested with injected functions, and CI with no srs CLI on PATH.

- **Tier 1** (`npm test`): practice, adapters with recording fakes, and the server on an ephemeral port. The cases are listed on clerk#97.
- **Tier 2** (`serve-integration.yml`, on pull requests and on demand): a real `clerk serve` with the pinned srs against the real srs-programme, read-only (no pulls). Every GET response is validated against the spec. clerk#98 adds a round against a local bare remote and a fake `gh`.
- **Tier 3** (srs-lab CI): the control room as a typed client (srs-lab#7).

## Running it

```sh
clerk serve --repo ~/dev/semanticops/srs-programme     # http://127.0.0.1:5181/api/health
```

| Variable | Default | What |
|---|---|---|
| `CLERK_PORT` | `5181` | the port |
| `CLERK_BIND` | `127.0.0.1` | a literal loopback address only (`127.0.0.1` or `::1`): anything else, `localhost` included, is refused (decision `e745e9b2`) |
| `CLERK_HOSTS` | (none) | extra `Host` names the service answers to, comma-separated (for example `control.semanticops.com` behind Caddy). Every other `Host` is refused, which stops DNS rebinding |
| `CLERK_SYNC_MINUTES` | `5` | the programme snapshot's cadence; `0` turns the job off |
| `CLERK_DESK_MINUTES` | `30` | the desk's cadence |
| `CLERK_STATE_DIR` | `~/.local/state/clerk` | `programme.json`, `desk.json`, `sync.json`, the lock, and `acts.jsonl` (each act with its remote address; behind a proxy, that is the proxy) |

The snapshots come from two commands, which also work on their own: `clerk snapshot --json` (the programme) and `clerk desk --json` (the desk as data). Output that is not JSON never replaces the last good snapshot. Only one sync runs at a time on the machine (an atomic pid lock; a lock whose holder is gone, or older than 30 minutes, is stale). When a sync fast-forwards the clerk itself, the service exits with code 75 so systemd restarts it onto the new code; run by hand, restart it yourself.

As a systemd user service (`~/.config/systemd/user/clerk-serve.service`, then `systemctl --user enable --now clerk-serve`):

```ini
[Unit]
Description=clerk serve: the owner's desk
After=network-online.target

[Service]
ExecStart=/usr/bin/node %h/dev/semanticops/clerk/bin/clerk.mjs serve --repo %h/dev/semanticops/srs-programme
# signed commits (later acts) and gh need the owner's agent and login
Environment=SSH_AUTH_SOCK=%t/ssh-agent.socket
Environment=SRS_CLI_PATH=%h/.cargo/bin/srs
Restart=on-failure
# exit 75 after the sync updates the clerk: restart onto the new code
RestartSec=2

[Install]
WantedBy=default.target
```

Caddy publishes the control room at `https://control.semanticops.com`. Until srs-lab#7 points the control room at this service, `npm run dev:desk` in srs-lab still serves the control room with its own sync. Don't run both syncs: the two desk refreshes together exhaust GitHub's rate limit.

## Not here

- SRS-generic capabilities: they go down into srs-rust (srs-rust#1415, #1416).
- Method rules that are really constraints ("a tension contains exactly 2 poles"): they become package data where RFC-048 can express them (srs#820), and stay in `check-method` until then.
- A hosted or shared view.
