# clerk

The clerk puts into practice the core practices muDemocracy proposes as essential to human collaboration, and uses them to manage agents of any kind, human or AI. It draws on the practices of guilds, the Quakers and unions, and on learning from ancient China, systems science and cybernetics. It is tooling for muDemocracy's governance, dogfooded at speed on the SemanticOps programme.

The clerk is the prototyping ground for governance: its packages and its practice library (`lib/practice`) define the practice srs-web's governance editors will later adopt, by importing the library, never by reimplementing it. A programme repo (srs-programme is the first) holds only data and settings; programme code lives here.

## Method

The whole process, stage by stage (theory, practice, gaps, open questions, measures): [docs/handbook.md](docs/handbook.md).

The programme is run as a chain, from why to what:

period -> ranked objectives -> epics -> remedies -> problems

- A **period** is a focus span. Its **objectives** are ranked; the ranking alone derives epic priority (rank 1 is P0, 2 is P1, 3 and below P2; an epic serving no ranked objective is parked).
- **Epics** carry **remedies**; each remedy answers one or more **problems**. Problems group into **clusters** and are held by **personas**.
- Records live in layers: **Affirmed** (the owner's, with priority), **Suggestions** (agents and others propose problems and remedies, attributed to the actor) and **Set aside**.
- Work is done by **working groups**: a mandate delegated by the owner, a quorum, a cycle with a budget, and reports back. Groups meet in **sessions**.

## Sessions

A small terminal tool that lets the owner act **by role** on an SRS programme without getting lost in data. 

A session is sometimes a meeting, sometimes a working session or a review at a desk. It has attendees, a date and time (`held_at`, UTC), and is often **ad hoc**. Decisions made *between* sessions are recorded at once as `proposed` and may be acted on, because they fall within the group's remit. A decision is **ratified in exactly one session**: its attendees are who was involved. Before that it may pass through many sessions as a proposal (needing different human input), each recording `considers`. **Drafts are in-place edits; git keeps the history.** There are no draft records. The rules are the same for humans and AI agents, so the tools are human tools too: authority comes from the **role** held, not the kind of mind.

```
# interactive (TUI)
SRS_ACTOR='{"kind":"human","id":"human:the-greenman"}' clerk --repo <srs-programme checkout> --as owner [--dry-run]

# non-interactive (agents, scripts, or a human who knows what they want): same code path as the TUI's end of session
SRS_ACTOR='{"kind":"ai","id":"agent:tpr-steward"}' \
  clerk session --repo <srs-programme checkout> --as tpr-steward [--attendee <record-id>]... [--ratify <id|all>]... [--set-aside <id>]... [--consider <id>]... [--edit <id> --field <resolution|why|options|review|question> --text <text>]... [--dry-run]
```

`--as <role>`: `owner`, `tpr-steward`, `tpr-builder`, `tpr-reviewer`, `tpr-analyst` (prototype mapping in `lib/practice/roles.mjs`; the analyst's adding decision b447e8ea is still `proposed`, so it holds a role but does not count toward quorum). The actor in `SRS_ACTOR` must hold that role (owner = `human:the-greenman`; `agent:tpr-*` hold the matching group role) or the clerk refuses, naming role and actor. The owner's session is recorded in the SemanticOps decision log, a group's in its own log. Reports, escalation and PR merge sections are owner-only.

Needs Node >= 20 and `gh` (logged in); the pinned srs CLI is fetched by `clerk fetch-srs`. No dependencies. Requires the `com.semanticops.programme/session` type on srs-programme master.

## What it shows

One screen of counts, plus a status line per working group (running or paused, merged/10 this cycle):

The agenda follows a meeting's order:

1. **Decisions since the last session**: `proposed` decisions in the SemanticOps decision log, to ratify (like approving the minutes).
2. **Reports from working groups**: owner only. One item per working-group report you have not yet received: the group's `run-report` record, paired by cycle date with its marked comment on semanticops.com#31 (a report that exists only as a comment is shown and marked "comment only"). A group role gets an empty section.
3. **Exercises**: open discussions asking for input (the governance `exercise` type, listed in your log; open = not closed or abandoned). `c` give input, `e` edit a field in place, `p` propose (a new `proposed` decision `derived-from` the exercise, in the same log). Never ratified, no quorum; the session `considers` each one taken up.
4. **Decisions for this session**: escalations: `proposed` decisions in a group log made by `agent:tpr-steward` that are not yet in the SemanticOps log. The report's "Decisions for you" count points here.
5. **Merges**: open, clean `gate:owner-merge` PRs.

**Receiving a report** means the parent context (you, as owner) has taken the group's report in: it is noted for the session, and when the session ends a `receives` relation runs from the session record to the run-report record (nothing goes into SRS for a comment-only report; the summary says so). It needs no quorum beyond the acting role being present. The 👍 on the #31 comment is only the mechanical side effect, added at once so `pr-upkeep.sh`'s pause rule (2 unacknowledged reports) sees it: "received; acknowledged on #31 so the group keeps running". There is no separate Acknowledge section.

Pick a section and the items come **one at a time**, essentials only. Read-only until you press a key.

| Section | Keys |
|---|---|
| Decisions since the last session | `r` ratify, `s` set aside, `c` comment, `v` view discussion, `e` edit a field in place (decision stays proposed), `h` hold for a later session (optional note), `o` full record, `n` next (skip, nothing recorded), `q` quit |
| Decisions for this session | `a` accept recommendation, `c` choose other (asks for resolution text), `m` comment, `v` view discussion, `e` edit a field, `h` hold, `d` defer, `o`, `n`, `q` |
| Exercises | `c` comment (input), `v` discussion, `e` edit a field (thinking/tensions/questions/blocking/next), `p` propose a decision, `o`, `n`, `q` |
| Reports | `r` receive (noted for the session; +1 on the comment at once), `c` comment (on the run-report record when the session ends; a reply on #31 if there is no record), `o` open the whole report, `n`, `q` |
| Merges | `m` `gh pr merge --merge` (acts now), `o` open in browser, `n`, `q` |
| Section menu | `1`-`5` open a section, `+` add attendee, `t` attach transcript, `e` end session, `q` quit |

Decision choices and received reports are collected. The TUI header reads `Session: <date time UTC> (ad hoc) · attendees: <names>`; attendees default to the acting role and `+` adds more (roles and stewardship agents). On end session the clerk creates ONE `com.semanticops.programme/session` record (title `Session <YYYY-MM-DD HH:MM UTC>: <context>`, status `ended`) as the acting actor in a fresh srs-programme worktree, adds `attended-by` relations to each attendee and `ratifies` / `sets-aside` to each decision, transitions each decision (ratified or abandoned), adds accepted escalations to the SemanticOps log, validates, commits (signed), pushes and opens a `gate:auto-merge` PR, then prints its URL. `--dry-run` prints the summary instead of doing any of it.

**Level and quorum.** A decision is ratified or set aside only in a session at the level of the context that owns it (a decision also in the SemanticOps log is the owner's) and whose attendees meet that context's quorum: SemanticOps needs the Owner role; WG Third-party ready needs two distinct member records, one the reviewer agent (prototype rules in `lib/practice/roles.mjs`). Below quorum `r`/`s` (and `clerk session --ratify/--set-aside`, exit 1) are refused, naming what is missing; `e` and `h` still work. The header shows `quorum: met` or `quorum: not met (needs ...)`. A session records `attended-by` per attendee and `ratifies` / `sets-aside` / `considers` per decision taken up (transitions only for ratify and set aside); a session that ratified nothing is still a valid record. Each decision's screen shows its history: `Considered in N earlier sessions (dates)`.

## Three kinds of minute

- **Report**: a working group tells its parent how it is going. It is *received* (a `receives` relation), not decided.
- **Exercise**: an open discussion with no decision attached. A group looks ahead at possible issues and asks for input before making a real decision; the minute records the ongoing discussion so it can feed proposals (`derived-from`). Never ratified.
- **Decision**: ratified (or set aside) in exactly one session, at the right level and quorum.

Each report screen also shows **Next**: ready group issues (top 3 in the builder's order), PRs in flight, budget left, and a forecast ("Queue fed for about N cycles" or "Queue running dry ... Needs feeding.", also on the agenda status line).

## Principles

- Each mind gets information fit for its cognition; too much information is noise. Counts first, then one item at a time.
- Decisions taken on the fly are recorded at once as `proposed` and ratified at a session, like approving the minutes.
- Authority follows roles, not kinds of mind; the record is attributed (`createdBy`) to whoever acted.

Concept: srs-programme `source-documents/agent-democracy-2026-10-10/concept.md`.

## Discussion

Humans and agents comment on proposals the same way: a `com.semanticops.comments/comment` record (`comment_text`) with a `comments-on` relation to the decision, or to another comment for a reply. The author is the comment's `createdBy`, the session actor, whoever holds the role. The item screen shows `Discussion: N comments` and the latest 3 (replies indented); `[v]` shows the whole thread, `[c]omment` adds one (any attendee, no quorum). A comment is the session taking the decision up, so the session records `considers` on it.

- **Citations** are `sourceRefs` on the comment, a provenance pointer and not a relation: a source-document id (`repository-document`), a URL (`external-document`) or `transcript`, with `sourceRole` `evidence` (default) or `quoted-from` (default for the transcript); a passage locator goes in the sourceRef `note`.
- **Transcripts**: `clerk session --transcript <file>` (TUI `[t]`) stores the file as a source document under `sessions/<date>`, links it to the session record (`attaches`), and lets a comment in that session cite `transcript`.
- **Agents**: `clerk comment --repo <path> --as <role> --on <id> --text <...> [--reply-to <commentId>] [--cite <docId|url|transcript>] [--role-of-cite quoted-from|evidence] [--transcript <file>] [--dry-run]`. It writes the comment code shared with the TUI, but records no session.

Comments between sessions are discussion: `clerk comment` writes only the comment (and its `comments-on` relation) in its own `gate:auto-merge` PR titled "Comment on <decision>", with no session record and no quorum. Taking a decision up in a session is what counts as considering it.

## Run

```
git clone git@github.com:the-greenman/clerk && cd clerk
npm test                      # all tests, no network, no srs CLI needed
node bin/clerk.mjs help       # every subcommand
node bin/clerk.mjs roadmap --repo <srs-programme checkout> --json
```

Programme tools take `--repo <programme path>` and default to the current directory. Every script, workflow, routine and label, with what reads and writes it, is in [docs/tools.md](docs/tools.md).
