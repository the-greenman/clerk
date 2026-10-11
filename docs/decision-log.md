# What goes in the decision log

The decision log holds the standing choices that govern later choices. It is not a to-do list and not a diary of the work. This page says what qualifies, what the kinds are and how to frame each one. The owner ruled on it on 2026-10-11 (clerk#40; answers SP-63, "The owner receives more decisions than they can judge").

## The rulings

- **D1, definition.** A decision record is one standing, timeless, testable choice that governs future choices. Tasks, applications, plans and bundles are recorded elsewhere, linked to it.
- **D2, kinds.** Purpose, boundary, premise, preference, policy, design, mandate. Adopted to test. A type is valuable only when it carries information, a difference that makes a difference. If practice shows no clear distinction between two kinds, they are merged and the list refined. The belief kind is called "premise"; "principle" stays the name of the method type, which holds a preference.
- **D3, where non-decisions go.** Tasks are issues for now: resolution, owner, due date, project. Applications and plans are issues or records that link to the decision. A task record type is added when the meeting-minute case (decision-logger, muDemocracy) needs one.
- **D4, framing rules.** One thing per record. A timeless statement. A review condition. Technical decisions cite a design principle. This is a convention first (decision e337703b): the session recorder warns and never blocks, until a later decision enforces the rules.
- **D5, the existing log.** Re-express only the five missing decisions and the clear splits, as a sample. Learn from it, then decide on the rest. Leave the rest as history.

## What the feedback says

Read together, the 11 comments make one argument:

> A decision record is **one** standing choice that **governs future choices**. It is stated so it still reads true next month, it says how to apply it to a new case, and it says when we will look at it again.

The comments also name four things that were logged as decisions but are not:

| Not a decision | The owner's words | What it is instead |
|---|---|---|
| **Task** | "this is far more a task"; "tasks need to know who will do them, and how they fit into a project ... a person and some kind of due date" | resolution, owner, due date, project: an issue or a task record |
| **Application** | "an application of the general decision that has been made over and over in this session"; "The actual decision is the same as each of the others" | work done under a standing decision, citing it |
| **Result of ordering** | "a test of a priority order, the reason we ordered things this way, rather than the result of applying the priorities, which is a set of tasks" | the ordered list is a plan; only the ordering rule is a decision |
| **Bundle** | "very mixed set of things"; "mixing the actual decision ... with a task" | split it: one decision plus its tasks |

And three framing rules:

1. **Timeless statement.** "Decision records should not really be citing moments in time and specific issues." Dates, issue numbers and record ids are provenance. They go in relations and context, never in the statement.
2. **Every decision is reviewable.** "Any first design decision should be given a clear review." The two review edits show the shape: a condition you can observe in practice ("when we work out another domain, does it follow this pattern?"; "each new epic is tested against the purpose").
3. **Technical choices cite their design principle.** "Simply stating that we use a function canon() without understanding the principle behind it ... does not help our architecture and design maintain quality over time."

## The test, in one place

A candidate goes in the decision log only if it passes all four:

1. **Reuse.** Would a later choice be settled by pointing at it? If it settles only today's choice, it is a task or a plan.
2. **One thing.** Can it be stated in one sentence without "and"? If not, split it.
3. **Timeless.** Does the statement read true with every date, issue number and id removed?
4. **Testable.** Can someone apply it to a new case and say whether that case conforms? Does it say when to review it?

Anything that fails test 1 is still recorded, but as a task, an application or a plan, linked to the decision it applies.

## The kinds worth keeping

There are seven kinds. Each one is a different promise about the future, so each needs a different frame. The "existing home" column matters: where a type already exists, the decision should **ratify a record of that type**, not restate it in prose. That follows the one-way-per-goal rule and the owner's rule on structured over serialised data.

| Kind | Promise | Frame | Review shape | Existing home | Example from the log |
|---|---|---|---|---|---|
| **Purpose** | what we are for | "We exist to X, for Y." | each new epic is tested against it (f5b4656a's edit) | `purpose` record | f5b4656a Deep context for action |
| **Boundary** | what is inside, and what is not | "X covers A, not B." | when work keeps landing on the edge | `boundary` / `domain` records | b97795ae Writing domain; da7877f3 Programme coordination |
| **Premise** | a belief we hold true enough to act on, and keep maintaining | "We work as if X." | when practice keeps contradicting it | (none: closest is a `principle` with no tension) | 7841bb87 Stance agents: "keep maintaining our theory of boundaries and tensions" |
| **Preference** | a default, with when it yields | "X over Y, unless Z." | when the unless-case keeps firing | **method `principle`** (statement + boundary_clause, governs a tension) | e337703b Convention before enforcement; 071eadb2 No core changes |
| **Policy** | a rule we enforce, with a threshold and a measure | "Every X must Y; measured by I." | the indicator, each cycle | `decision` + `argument/indicator` | 70a05a5c Group session ratifies; 84830ba8 Rendered order |
| **Design** | a structural choice that shapes future options | "We model X as Y, because principle P." | the next case of the same pattern: is it consistent? (e4a9b0ac's edit) | `decision` (+ ADR for code) | a6280447 Domain container; dbaa4716 Domains nest |
| **Mandate** | who may decide or act on what | "Group G may X within M." | at each report | `governance/role` + charter | 00567bf1, 384a704a, b447e8ea |

Two notes on the table:

- **Priority rules are policies**, not a separate kind. "Enablers rank before what they enable" is a policy about ordering. The ranked list it produces is a plan.
- **Premise and Preference are easy to confuse.** In 7841bb87 the owner calls it "a principle that we assume to be true enough to offer value". The method package uses `principle` for "X over Y, unless Z", which is a preference. Using one word for two kinds will cause drift, so the naming has to be ruled (decision D2).

The compass's own `kind:` tags map onto this list: `default` is a Preference, `rule` is a Policy, and `test` is the review shape that every kind carries.

The kind is recorded in the optional `decision_kind` field of `governance/decision` (clerk `packages/governance`).

## Worked example: the log re-read on 2026-10-11

This table puts every decision in the log through the test above. The aim is to check the kinds against real data, not to rewrite the log yet.

| Record | Verdict | The decision inside it | What else it holds |
|---|---|---|---|
| e337703b Convention before enforcement | **Keep. Preference** | Convention over enforcement, unless proven (consistently used, adds value) | Good form already |
| 071eadb2 No core changes | **Keep, restate. Preference** | Extend at the edge (packages, clerk) over changing the core, unless the process has settled | "check-method is clerk code" is a boundary note |
| 1bc2aae1 Package checks flexible now | Application of e337703b | none | a plan for one check |
| 649139e1 Advisory diagnostics | Application of e337703b, plus a Design | an advisory level below warning | |
| 3c8b94d1 Driving work | **Split** | (a) application of e337703b: start with what exists, replace later; (b) **Policy, priority rule:** enablers rank before the work they enable; (c) **Policy, cadence:** daily review and weekly session | tasks: #548, #562, #544, #560, clerk#38, clerk#39 |
| 633d5a52 Two domains walked | Application of e337703b ("sample, learn, then commit") | none of its own | plan; the "leanings confirmed" are other records' design decisions |
| 9a0ab387 Build order | Plan | the rule behind the order is unstated; it reads as "definitions, then checks, then UI" (dependency order) | tasks |
| 24d985d1 Measures I1 to I4 | Task | missing **Policy:** every governing decision names an indicator; indicators are reusable records measured each cycle | the I1 to I4 records and script |
| e3ed9e54 Gate | **Split** | (a) **Policy, threshold:** an affirmed problem is grounded in an affirmed domain; (b) application of e337703b (warn, then error) | (c) technical choice canon(): cites no design principle. The existing principle "Core service over adapter logic" says shared logic is written once at the lowest shared layer. A JS copy is an exception to it under 071eadb2, and the decision should have said so |
| e4a9b0ac held-by to persona-in-domain | **Keep. Design** | A problem's domain is derived (held-by, then in-domain), never stored | review edit already added |
| a6280447 Domain container | **Keep, strip. Design** | A domain is a container whose identity is the domain record; clusters and problems are its outline | tasks: switch buildBoard, delete edges |
| a5012fe0 Objectives address clusters | **Split** | (a) **Design:** features address named clusters, not domains or single problems; (b) **Preference:** affirm meaning over arrangement | (c) application of e337703b: working groups on a trigger |
| bf8016da Persona-in-domain | **Design** | A persona's goals are recorded per domain, in a persona-in-domain that refines the shared persona | application of 071eadb2 (package relation, not core) |
| dbaa4716 Domains nest | **Split. Design** | Domains nest by perspective, not as a fixed hierarchy | task: create Deep context and move three domains under it |
| b97795ae Writing domain | **Boundary** | Evidence-backed writing: one writer, agents respond and never write | tasks: brainstorm problems |
| da7877f3 Programme coordination | **Boundary** | Running the programmes: finishing, consistency, quality, decision load | tasks: add problems |
| f5b4656a Deep context for action | **Keep. Purpose** | Any task is understood within the whole picture; outputs are projections | review edit already added |
| 7841bb87 Stance agents universal | **Premise** | We maintain a theory of boundaries and tensions; agents express universal axes within a domain | |
| f799b6bc Local sessions as members | **Preference** | One way of working for every worker (human, routine, session) over local shortcuts, unless it proves unnecessary or irritating | the mechanics are the policy's application |
| 70a05a5c Session ratifies | **Keep. Policy** | A decision is ratified in exactly one session, at its level | good form, has a review |
| 84830ba8 Rendered order | **Keep. Policy** | Unpredictable output is a bug | good form |
| 00567bf1, 384a704a, b447e8ea | **Keep. Mandate** | | |

**Result:** about 22 records hold about 17 governing decisions. Five of those are not recorded on their own yet: the priority rule, the cadence, the measurement policy, "affirm meaning over arrangement" and the dependency-order rule. About half the session's records were applications of e337703b. The log was busy, but the governance had not moved much.

Open point: comment 999f1afe sits on a6280447 (Domain container) but talks about "a test of a priority order", which fits 9a0ab387 (Build order). The owner has not yet said whether it was meant for 9a0ab387.
