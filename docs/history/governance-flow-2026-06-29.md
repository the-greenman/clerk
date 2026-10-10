> Historical (2026-06-29): governance UI design written for srs-web and srs-gov, kept as input to the clerk practice library and the srs-web governance editors. Recovered from the unversioned parent folder on 2026-10-10.

# Governance Flow — Information Hierarchy and UI Pattern

This document establishes how a governance UI (srs-web, srs-gov) is built from the components available in the SRS core. It uses the `com.mudemocracy.governance` package and the gallery-project-v2 example as its concrete reference. The current `srs-gov` terminal UI is a read-only foundation: it navigates containers and records, but the detail pane is still shallow and does not yet render a full schema-driven field table.

---

## 1. Layers of the information hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│  PACKAGE  (com.mudemocracy.governance @1.0.0)                   │
│  Field definitions + Type definitions + Blueprint + Views       │
│  Immutable vocabulary — defines what can exist                  │
└─────────────────────────┬───────────────────────────────────────┘
                          │ packageRef
┌─────────────────────────▼───────────────────────────────────────┐
│  REPOSITORY  (.srs/ + manifest.json)                            │
│  A specific organisation's governance document                  │
│  containerIndex  ←  instanceIndex  ←  relationsPath            │
└──────┬─────────────────────────────────────────────────────────-┘
       │
       ├── CONTAINERS  (grouping boundaries with identity)
       │     Articles container   (containerType: document)
       │     Roles container      (containerType: document)
       │     Decision Log         (containerType: decision_log)
       │
       ├── RECORDS  (type-bound instances)
       │     root record   — gives the container its identity title
       │     member records — the actual content
       │
       ├── RELATIONS  (semantic edges between instances)
       │     supersedes, depends-on, precedes, …
       │
       └── DOCUMENT VIEWS  (column spec + ordering for list rendering)
             decision-log view → columns: [Decision, Alternatives, Rationale, Revisit]
```

Each layer is independent: the Package is immutable vocabulary; the Repository is a live, mutable instantiation of it.

---

## 2. The governance package

The package (`com.mudemocracy.governance`) ships four types, one blueprint, and three document views.

### Types

```
governance/decision_log @1   5a061505
  fields: title

governance/decision      @1   1fcad6a2
  fields: title, decision_question, context, friction,
          alternatives_considered, key_requirements,
          decision_statement, rationale, revisit_when,
          next_steps, owner

governance/article       @1   a1142ac3
  fields: article_number, title, article_text,
          rationale, amendment_rule, protected_status,
          revisit_when

governance/role          @1   e53dce11
  fields: title, role_holder, authority, boundary,
          source_of_authority, revisit_when
```

The shared `title` field has a stable UUID: `d7e82557` — used across all types and referenced by document views as the `titleFieldId`.

### Blueprint

`governance/decision-log` blueprint defines the *intended structure* of a decision-log container:

```
Blueprint: governance/decision-log  (e2e09a77)

  rootTypes:      [ governance/decision_log @1 ]   ← one root record of this type
  requiredTypes:  [ governance/decision      @1 ]   ← at least one decision must exist
  structure:
    decision  --[depends-on]-->  decision   (many-to-many, optional)
    decision  --[supersedes]-->  decision   (one-to-one, optional)
```

The blueprint describes intent, not enforcement. A Container is instantiated from a blueprint; the blueprint is not re-checked every write.

### Document views

| View name | rootTypeRefs | Purpose |
|---|---|---|
| `decision-log` | `decision_log @1` | Compact list: Decision · Alternatives · Rationale · Revisit |
| `decision-deliberation` | _(none)_ | Full deliberation view — all decision fields |
| `articles-and-roles` | _(none)_ | Articles and Roles side-by-side |

`rootTypeRefs` is the UUID-anchored join used by `container resolve-view`: the view binds to any container whose root instance is of type `decision_log @1`.

---

## 3. Container anatomy

A Container is a grouping boundary with two distinct roles:

```
Container: Decision Log  (138e2fac)
containerType: decision_log

  rootInstanceIds:    [ bf64442b ]   ← the "header" record
  memberInstanceIds:  [ bf64442b,    ← root is also a member
                        3be7b057,    ← decision
                        4a989562,    ← decision
                        9054911c,    ← decision
                        … ]
```

**Root record** (`bf64442b`, type `governance/decision_log`):
- Title: "Limoma Project Decision Log"
- Gives the container its display name and identity
- Has only a `title` field; it is the container's "cover page"

**Member records** (type `governance/decision`):
- Each is a full decision with all eleven fields
- The root is included in `memberInstanceIds` — it is both root and member

**Articles container** has a different pattern: its root is itself a `governance/article` (the first article, "What this is"). Both root and members share the same type. The root distinguishes itself only by being listed in `rootInstanceIds`.

**Key invariant**: `containerId` ≠ any `instanceId`. Containers are not records. Relations connect instance IDs; container IDs are only used in container operations.

---

## 4. How the UI is built — layer by layer

### 4.1 Navigation (sidebar)

```
srs-repository
  list_containers()
        │
        ▼
  [ ContainerSummary ]   containerId · title · containerType
        │
        ▼  (srs-web: buildContainerSections)
  [ ContainerSection ]   key=containerId · title · icon · containerType
        │
        ▼  (GovernanceShell nav)
  NavItem per container  label=title  id=icon
```

The sidebar is **purely container-driven**. No hardcoded type UUIDs; no client-side type registry for navigation. If a new container is added to the repository (e.g. a "Policies" container), it appears automatically.

Icon assignment is the only local mapping: `decision_log → ⊕`, `document → §`, unknown → `◻`.

### 4.2 List pane (container view)

```
srs-repository
  container_resolve_view(containerId)
        │
        ▼
  ContainerView {
    root:    { instanceId, displayLabel }
    members: [ { instanceId, displayLabel }, … ]
    columns: [ { displayLabel, fieldId }, … ]  ← from DocumentView
  }
        │
        ▼  (srs-gov / future srs-web#94)
  List pane: column headers from view · one row per non-root member
```

`resolve_view` does the heavy lifting in the core:
1. Finds the DocumentView bound to this container's root type (via `rootTypeRefs`)
2. Orders members by the view's section ordering spec
3. Provides core-computed `displayLabel` for every member (priority: `title → name → label → typeName`)

The UI adds no label derivation logic of its own — that is the layering principle.

### 4.3 Record detail

```
srs-repository
  record_get(instanceId)       → Record { typeId, typeVersion, fieldValues[] }
  type_schema(typeId, version) → JSON Schema with x-srs-order, x-srs-field-id, title
        │
        ▼  (srs-web: RecordDispatch → ArticleView / DecisionView / RoleView / RecordView)
  Field rows in schema order
  label = schema property "title"  (core-provided display label)
  value = fieldValues[fieldId]
```

The record detail view uses the type schema for field labels and ordering. It never derives labels from field names — the schema's `title` property is the label.

In the current `srs-gov` TUI foundation, the detail pane stays intentionally lighter-weight: it shows the selected record's id, lifecycle state, tags, and a short summary. The schema-driven field table above is the shared pattern that richer editors should adopt next.

### 4.4 Create

```
User: "New Decision"
        │
        ▼
1. containerId  ←  activeSection.containerId
2. memberType   ←  first non-root member's typeId  (or DocumentView.rootTypeRefs if empty)
3. typeSchema(typeId, version)  →  field list with required flags
        │
        ▼
4. RecordForm renders required fields
5. createRecord(repo, typeId, version, { fieldValues })
   + addContainerMember(repo, containerId, newInstanceId)
   (or: --container flag does both in one step via the CLI)
```

### 4.5 Terminal UI foundation

`srs-gov tui` is the interactive shell around the same repository and query layers:

```
srs-repository
  repo_navigation()        → identity + ordered sections
  container_resolve_view() → root + ordered members + column spec
  find()                   → runtime text/tag/lifecycle filtering
        │
        ▼
  srs-gov tui
    sections pane  → navigation between governance containers
    records pane   → member list for the selected container
    detail pane    → selected record summary
    status/footer  → filters, sort, and key hints
```

The TUI is read-only at this stage. It is intentionally thin and should not accumulate package-specific semantics beyond rendering and routing.

Current keybindings:
- `j` / `k` or arrow keys: move in the active pane
- `Tab`: switch panes
- `Enter`: open the selected section or record
- `Esc`: back out one level
- `/`: search
- `s`: toggle sort order
- `a`: toggle show-all vs authored defaults
- `q`: quit

Edit and export actions are intentionally out of scope for this foundation. They should appear only after the read-only navigation and projection paths are stable.

---

## 5. The full composition diagram

```
Package  ──────────────────────────────────────────────────────────
  Field: title          d7e82557
  Field: decision_stmt  de1296e0
  Field: rationale      3340532b
  …17 more fields…
  Type: decision_log    5a061505  [ title ]
  Type: decision        1fcad6a2  [ title, question, … statement, rationale, … ]
  Type: article         a1142ac3  [ article_number, title, article_text, … ]
  Type: role            e53dce11  [ title, role_holder, authority, … ]
  Blueprint: decision-log         rootTypes=[decision_log] required=[decision]
  DocumentView: decision-log      rootTypeRefs=[decision_log@1]
                                  columns=[statement · alternatives · rationale · revisit]

Repository (e.g. Limoma Governance) ──────────────────────────────
  Container: Decision Log  (138e2fac)   containerType=decision_log
    └─ root:    bf64442b  decision_log  "Limoma Project Decision Log"
    └─ member:  3be7b057  decision      "Eye level standard"
    └─ member:  4a989562  decision      "Pilot duration"
    └─ member:  …

  Container: Articles  (f7562aa3)       containerType=document
    └─ root:    ad159754  article       "What this is"
    └─ member:  0482c489  article       "How we make decisions"
    └─ member:  …

  Container: Roles  (b30db206)          containerType=document
    └─ root:    5bbf9209  role          "R-001 Building Authority"
    └─ member:  448d64d4  role          "R-003 Clerk"
    └─ member:  …

  Relations:
    3be7b057 (decision) --[supersedes]--> earlier-decision
    3be7b057 (decision) --[depends-on]-->  4a989562 (decision)

UI (srs-web / srs-gov) ────────────────────────────────────────────
  Sidebar
    ⊕  Decision Log    [list_containers → ContainerSection]
    §  Articles
    §  Roles

  List pane (Decision Log selected)
    root header: "Limoma Project Decision Log"
    columns: Decision · Alternatives · Rationale · Revisit
             [from DocumentView via resolve_view — field IDs de1296e0, 636ce948, 3340532b, c04b7f84]
    rows:  displayLabel (title)       | Decision (decision_statement)
           Eye level standard         | Centre of all works at 165cm…
           Phase 1 scope              | …
           Pilot duration and review  | …
           [displayLabel from record_display_label(title→name→label→typeName)]

  Detail pane (record selected)
    Title:                Eye level standard
    Decision Question:    Where should works be hung?
    Decision Statement:   Centre of all works at 165cm from floor.
    Rationale:            Establishes a consistent baseline…
    [field order and labels from type schema, not client-side]
```

---

## 6. Capability layering — what lives where

```
srs-repository (Rust core)
  ├─ record_display_label()    canonical label: title → name → label → typeName
  ├─ container_resolve_view()  root + ordered members + displayLabels + column spec
  ├─ list_containers()         ContainerSummary[]: containerId · title · containerType
  ├─ list_records({ containerId }) member records scoped to a container
  ├─ type_schema()             JSON Schema with x-srs-order, x-srs-field-id, title
  └─ validate()                diagnostics, no side effects

srs-cli / srs-bindings (JSON contract)
  container resolve-view  →  containerView { root, members[], columns[] }
  container list          →  containers[]  { containerId, title, containerType }
  record list --container →  records[]     scoped to container
  type schema             →  schema        with field labels + order
  record get              →  record        with fieldValues keyed by fieldId

srs-web / srs-gov (presentation only)
  ├─ Nav items        ←  list_containers() title + containerType
  ├─ List rows        ←  resolve_view() members[].displayLabel
  ├─ Column headers   ←  resolve_view() columns[].displayLabel
  ├─ Field labels     ←  type_schema() property.title
  ├─ Field order      ←  type_schema() x-srs-order
  └─ View component   ←  typeName → ArticleView / DecisionView / RoleView
                         (presentation dispatch, not semantic derivation)
```

**The rule**: if the client is computing something about *what data means* (what is the title of this record? what fields does this type have? which records belong to this container?), that computation belongs in `srs-repository`. Clients receive already-computed answers and add only presentation: which icon, which CSS class, which Svelte component.

---

## 7. Open gaps

| Gap | Issue | Description |
|---|---|---|
| `record_display_label` not in list payload | srs-web#91 | CLI `record list` and WASM `list_records` do not return `displayLabel`; clients re-derive it client-side. Fix: add `displayLabel` to `RecordListEntry` payload. |
| `resolve_view` not in WASM bindings | — | `container resolve-view` exists in the CLI (srs-rust#254); WASM `SrsRepository` does not yet expose it. Until then, srs-web calls `getContainer` + `listRecords` + `documentViewsForContainer` separately. |
| Icon / nav taxonomy | srs#92 | Containers have no `icon` or `navOrder` field. srs-web uses a local `containerType → icon` map as a placeholder. RFC needed to define the nav taxonomy. |
| List pane column spec in srs-web | srs-web#94 | srs-web list pane currently ignores `DocumentView.sections`. Columns shown are client-hardcoded per type. Fix: consume `resolve_view` column spec once the WASM binding lands. |
| `containerType` soft-deprecated (RFC-009) | — | RFC-009 marks `containerType` as a hint only. The authoritative join is `rootTypeRefs` UUID chain: Container.rootInstanceIds → Record.typeId → DocumentView.rootTypeRefs. String-based joins should be replaced with UUID joins as `resolve_view` usage spreads. |
