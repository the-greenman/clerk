# Decisions in pull requests (clerk#77)

**Aim:** no decision is lost in a PR's prose. Every choice a PR makes or needs is in its `srs-decisions` block (spec/pr-annotation.md), classed by what it constrains. Only decisions that constrain later choices go to a decision log.

This builds on what the clerk handbook already rules: the four tests (Reuse, One thing, Timeless, Testable), "anything that fails Reuse is recorded as an issue, an application or a plan", "recorded at once, acted on inside the group's remit", "ratified once, at the level that owns it", the Doors, and principles as this-over-that leanings.

## Three classes

| Class | Test | Who decides | Where it lives | Ratified? |
|---|---|---|---|---|
| **choice** | Fails **Reuse**: nothing later will be settled by pointing at it. Local, and reversible inside this PR's scope. | The builder, at once. | The PR's block only (`made`, `class: "choice"`). An *application* in handbook terms. | Never. |
| **ruling** | Passes all four tests, inside the group's mandate (Door 1, or non-normative). | The group: the builder proposes, the reviewer assents in the quorum comment. | A `proposed` decision record in the **group's own log**, named in the block (`made`, `class: "ruling"`, `id`). | At the group's session, at cycle close. |
| **escalation** | Passes the four tests and is **outside** the mandate: a new ruling, Door 2 or 3, complex mode, gates or merge rules, over budget. | The level that owns it (the parent group; at the top, the owner). | A `proposed` decision in the **parent's log**, plus an `asks` entry with options and a recommendation. | At the parent's session. Merge waits if `blocks: "merge"`. |

When in doubt, it is a ruling. A choice that turns out to be reused is promoted to a ruling by the next PR that leans on it.

## Principles make choices automatic

A choice that sits on one of the group's tension axes cites the lean it follows, as `principle` (an affirmed principle) or `lean` (the group's pole on that axis). Such a choice needs no one: it is the group's compass applied. Three cases:

- **Follows the lean:** a choice. Cite it.
- **Against the lean:** never a choice. It is an ask: the group, or its parent, must say whether the lean still holds here.
- **On an axis where the group has no lean:** a ruling, so the group decides once and the next PR can cite it.

So the richer a group's soil (affirmed tensions, principles, its trigram), the more of its work is plain choice, and the fewer asks reach a human.

## What a check enforces

`clerk pr-check <repo#n>` (`lib/practice/pr-decisions.mjs`) reports:

| Level | Finding |
|---|---|
| error | Decision language in the PR prose ("we decided", "chose", "instead of", "Decision asked", "trade-off") with no `srs-decisions` block. |
| error | A `ruling` or `escalation` with no record `id`. |
| error | An `ask` with no question, or with `blocks: "merge"` and no answer, on a PR that is about to merge. |
| warn | A `choice` that says it constrains later work (`constrains: true`): it should be a ruling. |
| warn | A `choice` with no `principle` or `lean` on a PR whose group has a trigram: say which way it leans, or make it a ruling. |
| error | An ask option that is a disposition (ratify, set aside, hold, shelve, accept, deny, approve, reject, merge, defer): what is done *with* an ask is never one of its options. |
| error | An ask with fewer than two options. |
| warn | An ask with no status-quo option ("Do nothing: …"), an option that does not say what it leads to, no `tension` and no `why_unplaced`, or a `recommend` that names none of its options. |
| info | A decision record named in the prose but not in the block. |

## Well-formed asks

A decision presents real courses of action, and the owner chooses between them (semanticops.com#37, clerk#85).

- **Options are courses of action.** There are at least two, and one is the status quo: "Do nothing: what stays, and what it costs". Each says what it leads to, as `"Do X: leads to Y"` or `{ "action", "leads_to", "pole" }`.
- **Dispositions are not options.** Ratify, set aside, hold, shelve, accept, deny, approve, reject and merge are what is done *with* an ask: the owner's answer, a hold for the session, a `review:requested`, or a session's ratify / set aside. "Accept option A / Shelve / Deny" is one option dressed as three.
- **Place it where the domain allows.** `tension` names the trade-off: a group tension, or for spec and implementation work a compass axis from `srs/docs/charter/decision-compass.md` (for example `3-9`). Each option's `pole` says which way it leans. `layer` names the plane and layer, or the boundary, it lives in. Two decisions that take opposite poles on one tension conflict only within one layer; across layers, the difference is a boundary. When nothing fits, say why in `why_unplaced`. A complex decision links a consequence map instead of naming one tension.
- **The recommendation is one of the options.** It follows the lean, or quotes the boundary clause that lets it go against it.

## Actors

Every block and every agent comment names its actor (`"by": "agent:<id>"` in the block, `<!-- actor: agent:<id> -->` atop a comment). Agents post through the owner's token, so without this an agent's words read as the owner's.

## The block and the replies

````markdown
```srs-decisions
{
  "answers": ["SP-91"],
  "made": [
    { "id": "3c8b94d1" },
    { "title": "Stalled means 14 days without a commit", "kind": "preference", "why": "matches the board's stale-claim window" }
  ],
  "asks": [
    { "key": "A1", "id": null, "question": "Are the 14d / 1d defaults right?", "tension": "Reviewable ↔ fast",
      "options": ["Keep 14d / 1d: stalled claims surface after two weeks, as today",
                  "7d / 1d: stalled claims surface twice as fast, with more false alarms",
                  { "action": "Make them settings", "leads_to": "each group sets its own rhythm", "pole": "fast" }],
      "recommend": "Make them settings", "why": "Groups differ in rhythm", "blocks": "merge" }
  ],
  "review": { "builder": "agent:clerk-builder", "focus": "the stalled-claims query" }
}
```
````

| Key | Meaning |
|---|---|
| `answers` | Problem ids (SP-nn) the PR answers. Same as the clerk's `Answers:` line. |
| `made` | Decisions the PR made or executes: a decision record (`id`, 8-hex or full) or an inline one (`title`, `kind` from the seven kinds, `why`). Inline decisions that pass the four tests should become records. |
| `asks` | Decisions it needs from the owner. `key` is unique within the PR. `id` names a `proposed` decision record when there is one. `options` and `recommend` make the ask answerable in one click; `blocks` says whether merge waits on it (`merge` or `none`). See [Well-formed asks](#well-formed-asks). |
| `review` | Who built it and what a reviewer should look at. |

## Replies, as PR comments

An owner's answer (posted from the control room, or by hand):

```markdown
<!-- srs:answer ask=A1 choice="Make them settings" -->
**Decision A1:** Make them settings
<optional note>
```

A request for a further agent review:

```markdown
<!-- srs:review-request seat=reviewer stance=Challenger -->
Please review again, focusing on: <focus>
```

Every comment an agent posts ends with its actor, on its own line, because agents post through the owner's token and the author alone cannot tell them apart:

```markdown
<!-- actor: agent:tpr-reviewer -->
```

A review request also adds the label `review:requested`. The WG reviewer routine already fires on `labeled`. To honour the request it must skip its idempotence exit once while that label is present, then remove the label. `routines/wg-reviewer.md` step 2 does this.

Status: proposed. The rulings are srs-programme#160 (bbb23e36, e3505ded, 70a84bb7, 21ee9352, ea96a678); until an owner session ratifies them, this is the convention agents try, not a rule.
