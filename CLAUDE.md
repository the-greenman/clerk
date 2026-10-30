# CLAUDE.md

The clerk puts into practice the core practices muDemocracy proposes as essential to human collaboration, and uses them to manage agents of any kind, human or AI. It is tooling for muDemocracy's governance, dogfooded on the SemanticOps programme. It is the prototyping ground for governance. See README.md.

## Rule

Programme and governance code lives here; programme data never does (srs-programme holds data and settings). srs-web imports `lib/practice`, never reimplements it. `lib/practice` stays pure (no Node built-ins, no `process`), guarded by `test/practice-purity.test.mjs`; I/O lives in `lib/adapters`. The ten clerk rules (decision 926c059f) are checked by `test/clerk-rules.test.mjs` against `test/clerk-rules.allowlist.json`, which only shrinks: a new exception fails the build, and so does a listed one that is fixed but not removed. Rules 4 and 9 hold per-file ceilings (lines, GitHub writes) that may fall but never rise.

Every script, workflow, routine and label: `docs/tools.md`. Add to it when you add one.

When the owner explains the work, or starts describing a problem or remedy, capture their words as a Tier-0 vignette in the conversation's container before acting on it, unprompted. Only words that carry meaning, never bare commands or instructions: the handbook's *Narrative explorations: how meaning grows* (decision 77e04b19).

The handbook is an SRS repository, `handbook/`; `docs/handbook.md` is rendered from it by `scripts/render-handbook.mjs`. Never edit the markdown: change the records with the srs CLI, render, and commit both (`validate.yml` fails on drift).

## Gates and git

- `npm ci && npm test`, judged by exit code, never a piped tail. The runtime (`bin`, `lib`, `scripts`) imports only Node built-ins: workflows and routines run it with no `npm install` (`test/runtime-imports.test.mjs`). Dependencies are for tests only.
- Default branch is `main`. Commits are SSH-signed with plain `git commit` (never `--no-gpg-sign`); end messages with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Review the diff before opening a PR. Who merges is srs-programme decision 949ae72d (merge rights follow decision mode and door, the same in every governed repository); label the PR `gate:auto-merge` or `gate:owner-merge` by it, and do not restate the rule here.
- Worktrees only via `scripts/wt new clerk <issue#-slug>`.
- Never run write modes (`roadmap --apply`, `steward --fix`, `upkeep --apply`, `board` writes) to test.
