# Working groups: how decisions are made

A working group is an epic run like a co-op subcommittee. The owner delegates a mandate to the group, and the group decides and merges inside it. Anything outside the mandate comes back to the owner as one decision. The first group is **WG Third-party ready** (semanticops.com#31).

The rules live in the group's charter records in this repository: the group role (what it decides, what it escalates) and four standing orders (Membership and quorum, Cycle and report, Budget, Reporting and minutes). The briefs that agents follow are `wg-builder.md`, `wg-reviewer.md`, `wg-steward.md`, `wg-analyst.md` and `unattended-worker.md` (fallback sweep). The merge check is `scripts/pr-upkeep.sh`. If this page and those disagree, the records and the script win.

The group has four members: Steward, Builder, Reviewer and the Analyst (scout), whose standing job is to keep the queue fed. It acts only when the latest cycle report forecasts "Queue running dry", finds ruling-backed work in conformance gaps and unimplemented rulings, and files it as ready issues for the Builder. It never builds, reviews, merges or sets a priority; anything needing a new ruling becomes an exercise, not work.

Current settings: cycle closes daily at 11:30 UTC · budget 10 delegated merges per cycle · pause after 2 unacknowledged reports.

## 1. Who acts, and what starts them

```mermaid
flowchart LR
  subgraph Events
    E1["Issue labelled ready<br/>(wg:third-party-ready)"]
    E2["Group PR opened, updated,<br/>labelled or reopened"]
    E3["Group PR merged"]
  end
  subgraph Clocks
    C1["Daily 11:30 UTC"]
    C2["Every 15 minutes"]
    C3["Nightly 00:00 UTC"]
    C4["Daily 12:00 UTC check:<br/>'Queue running dry'?"]
  end
  E1 --> B["Builder<br/>agent:tpr-builder"]
  E3 --> B
  E2 --> R["Reviewer<br/>agent:tpr-reviewer"]
  C1 --> S["Steward<br/>agent:tpr-steward"]
  C2 --> U["pr-upkeep<br/>(script, no AI)"]
  C3 --> N["Nightly lane<br/>fallback sweep"]
  C4 --> AN["Analyst (scout)<br/>agent:tpr-analyst"]
  AN -->|files ready issues| E1
  B -->|opens PR| R
  R -->|quorum comment| U
  U -->|merges| E3
  S -->|cycle report on #31| O(["Owner"])
  N -.->|missed events| B
  N -.->|missed events| R
```

## 2. The decision process

Most decisions are settled by the group's compass inside its mandate. Only what falls outside reaches the owner, as one proposed decision with its context.

```mermaid
flowchart TD
  Q["A question or piece of work<br/>(an issue in the group)"] --> M{"Inside the mandate?<br/>executes a recorded ruling,<br/>mode clear or complicated,<br/>in the group's repos"}
  M -->|yes| G["Group decides<br/>Builder builds, Reviewer checks quorum"]
  G --> L["Recorded in the group's decision log<br/>(Builder proposes, Reviewer ratifies;<br/>plain tasks need no record)"]
  L --> RP["Listed in the next cycle report"]
  M -->|no: new or changed ruling, Door 2/3,<br/>complex mode, breaking contract,<br/>cross-repo pin, gate or merge rules,<br/>over budget| X["Steward writes ONE proposed decision<br/>(fact, why it matters, action needed, urgency)"]
  X --> RP
  RP --> O{"Owner"}
  O -->|affirm| A["Decision ratified in Affirmed<br/>work proceeds under it"]
  O -->|set aside| SA["Declined, reversible"]
  O -->|amend the charter| CH["New owner decision<br/>changes mandate, rhythm or budget"]
```

## 3. Builder: one issue per run

```mermaid
flowchart TD
  T(["Issue labelled ready, or a group PR merged"]) --> F{"Charter ratified?<br/>(RATIFYING_DECISION_ID set)"}
  F -->|no| Z0(["Stop: group not in force"])
  F -->|yes| P{"Group paused?<br/>(wg_pause_check)"}
  P -->|paused| Z1(["Stop: no new builds"])
  P -->|ok| BU{"Delegated merges this cycle<br/>+ open group PRs < 10?"}
  BU -->|no| Z2(["Stop: budget spent"])
  BU -->|yes| PK["Pick the issue<br/>(event issue, or next ready by priority, then oldest)"]
  PK --> CL{"Already claimed,<br/>or a branch or PR exists?"}
  CL -->|yes| Z3(["Stop"])
  CL -->|no| CM["Claim: assign and comment the branch"]
  CM --> GD{"Guard in the issue trips?"}
  GD -->|yes| Z4(["Stop: evidence comment, needs-input"])
  GD -->|no| MD{"Inside the mandate?"}
  MD -->|no| ESC["One proposed decision as agent:tpr-steward<br/>issue gets needs-input<br/>no PR"]
  MD -->|yes| IM["Implement, naming the ruling it executes"]
  IM --> GT{"Gates green by exit code?"}
  GT -->|no, cannot fix in scope| Z5(["Stop: run report, needs-input"])
  GT -->|yes| PR["Open PR: label wg:third-party-ready, no gate label<br/>body: Builder, Mandate, Ruling, gate results"]
  PR --> RR(["Run report on the issue"])
```

## 4. Reviewer: one PR per run

```mermaid
flowchart TD
  T(["Group PR opened, updated, labelled or reopened"]) --> W{"Open, not draft,<br/>labelled wg:third-party-ready,<br/>not gate:owner-merge?"}
  W -->|no| Z0(["Exit"])
  W -->|yes| ID{"Valid quorum comment<br/>newer than the head commit?"}
  ID -->|yes| Z1(["Exit quietly<br/>(stops the reviewer's own push from looping)"])
  ID -->|no| SB{"PR's Builder is the reviewer?"}
  SB -->|yes| Z2(["Exit: never review your own work"])
  SB -->|no| BH{"Branch behind base?"}
  BH -->|yes| UP["Update branch<br/>(fires one more event, which exits at the check above)"]
  BH -->|no| GT
  UP --> GT["Run the repo's gates by exit code"]
  GT --> MD{"Inside the mandate,<br/>and names the ruling it executes?"}
  MD -->|no| ESC["Escalate: add gate:owner-merge,<br/>comment why. Never approve."]
  MD -->|yes| V{"Gates green and<br/>no blocking findings?"}
  V -->|no| RJ["Quorum comment: verdict=reject<br/>with findings"]
  V -->|yes| AP["Quorum comment: verdict=approve"]
  AP --> AM(["Add gate:auto-merge"])
```

The quorum comment's first line is exactly:

```
<!-- wg-quorum --> builder=agent:tpr-builder reviewer=agent:tpr-reviewer gates=green@<sha> mandate=<ruling> verdict=approve
```

## 5. Quorum and merge: what pr-upkeep checks

A group PR merges only when every check passes. Anything else leaves it listed under "Working group: waiting" in the daily digest, with the reason.

```mermaid
flowchart TD
  S(["pr-upkeep, every 15 minutes"]) --> L{"Labelled wg:third-party-ready?"}
  L -->|no| ORD(["Ordinary rules"])
  L -->|yes| OM{"Labelled gate:owner-merge?"}
  OM -->|yes| ORD2(["Escalated: waits for the owner"])
  OM -->|no| AL{"Labelled gate:auto-merge?"}
  AL -->|no| W1(["Wait: awaiting group review"])
  AL -->|yes| QC{"Latest quorum comment<br/>posted by the owner account?<br/>(strangers' comments are ignored)"}
  QC -->|none| W2(["Wait: no quorum comment"])
  QC -->|yes| DA{"Builder and reviewer<br/>are different actors?"}
  DA -->|no| W3(["Wait: same actor"])
  DA -->|yes| VA{"Verdict approve?"}
  VA -->|no| W4(["Wait: rejected"])
  VA -->|yes| NW{"Newer than the head commit?"}
  NW -->|no| W5(["Wait: quorum is stale"])
  NW -->|yes| PA{"Group paused?"}
  PA -->|yes| W6(["Wait: paused"])
  PA -->|no| BU{"Delegated merges this cycle < 10?"}
  BU -->|no| W7(["Wait: over budget"])
  BU -->|yes| CL{"Mergeable and checks green<br/>(CLEAN)?"}
  CL -->|no| W8(["Wait for state"])
  CL -->|yes| MG(["Merge, count 1 against the budget"])
```

Group PRs are never branch-updated by pr-upkeep: a new commit voids the quorum, so the reviewer updates and re-reviews instead. If the budget count or the reports cannot be read, the group is treated as over budget or paused (fail closed).

## 6. Cycle, report and pause

```mermaid
flowchart TD
  C(["11:30 UTC: cycle closes"]) --> G["Steward gathers the cycle:<br/>merged PRs with their quorum lines,<br/>decisions taken, escalations, stops, budget used"]
  G --> D["Decisions and run report written to the decision log<br/>(one srs-programme PR, auto-merge)"]
  D --> P["Report posted on semanticops.com#31<br/>first line: wg-report marker"]
  P --> A{"Owner reacts with a thumbs-up?"}
  A -->|yes| OK(["Acknowledged: group keeps going"])
  A -->|no| K{"The last 2 reports<br/>both unacknowledged?"}
  K -->|no| GO(["Group keeps going, within budget"])
  K -->|yes| PS["Paused: no new builds, no group merges.<br/>Reviews and escalations continue."]
  PS --> A2{"Owner thumbs-up on a report"}
  A2 --> GO
```

The budget resets at each cycle close. A group PR the owner merged (gate:owner-merge) never counts against it.

## 7. Where the authority comes from

```mermaid
flowchart LR
  OW["Owner role<br/>(human, Affirmed)"] -->|delegates| GR["Group role<br/>WG Third-party ready"]
  RD["Ratifying decision<br/>(owner, signed commit)"] -.->|puts in force| GR
  GR --> SO["Standing orders<br/>quorum, cycle, budget, minutes"]
  GR --> CP["Compass<br/>boundary, tensions, leanings, layers"]
  GR --> AG["Members<br/>steward, builder, reviewer"]
  CP -->|narrows| B2["SRS implementation"]
  B2 -->|narrows| B1["SRS standard"]
  B1 -->|narrows| B0["SemanticOps"]
```

Only the owner amends the charter, with a new owner decision. Until the ratifying decision exists, the charter is agent testimony and the group is not in force.

## Known limits

- Every agent posts as the owner's GitHub account. The builder and reviewer names in the quorum comment are therefore stated by the routines, not proven by GitHub. Separate sessions started by separate events keep the roles apart in practice. A separate agent identity is needed before any charter widens a mandate beyond the repository's own merge rules.
- Two reviewer sessions can occasionally review the same PR. The latest quorum comment decides, so a duplicate is harmless.
