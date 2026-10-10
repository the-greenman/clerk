# CLAUDE.md

The clerk puts into practice the core practices muDemocracy proposes as essential to human collaboration, and uses them to manage agents of any kind, human or AI. It is tooling for muDemocracy's governance, dogfooded on the SemanticOps programme. It is the prototyping ground for governance. See README.md.

## Rule

Programme and governance code lives here; programme data never does (srs-programme holds data and settings). srs-web imports `lib/practice`, never reimplements it. `lib/practice` stays pure (no Node built-ins, no `process`), guarded by `test/practice-purity.test.mjs`; I/O lives in `lib/adapters`.

Every script, workflow, routine and label: `docs/tools.md`. Add to it when you add one.

## Gates and git

- `npm test`, judged by exit code, never a piped tail.
- Default branch is `main`. Commits are SSH-signed with plain `git commit` (never `--no-gpg-sign`); end messages with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Review the diff before opening a PR; the owner reviews and merges.
- Worktrees only via `scripts/wt new clerk <issue#-slug>`.
- Never run write modes (`roadmap --apply`, `steward --fix`, `upkeep --apply`, `board` writes) to test.
