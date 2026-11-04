# Taking registry writes to main

A registry server (`srs mcp serve --registry`, RFC-049) serves several repositories through one interface. It writes files and knows nothing about git. If those repositories are git repositories with a protected main branch, something else has to take each write from the file on disk to the branch everyone else reads, and keep read-only copies current. This page describes one way to do that. It answers SP-154.

`clerk save` is a **proof of concept**. The clerk is an internal workflow experiment, and anyone running a multi-repository server will meet this need, so the rule, layout, steps and status below are meant to outlast it. The code is one module, `lib/adapters/registry-save.mjs`, whose only inputs are the registry file and its arguments. It uses only `git` and `srs`, and takes the code host as a small object it's given: find an open pull request, create one, merge one. Extract it when someone outside this workspace wants it, or when these steps and the status shape have gone unchanged through two cycles of real use.

## The rule

**A server accepts a write only where that write can reach main on its own.**

- A repository that works like a shared database, where pull requests merge once checks pass, is writable.
- A repository that needs review is `readOnly` in the registry, and changes through a pull request from a worktree.
- The registry's `readOnly` flag is the whole policy. There is no other configuration.

## The layout

Each registry entry points into its own full clone that no person or session works in, for example `~/.local/share/srs/served/<repo>/`.

| Entry | Clone sits on | Shows |
|---|---|---|
| read-only | the default branch | `origin/<default>` |
| writable | a local branch named `served` | `origin/<default>` plus writes not merged yet, so writers read their own writes |

Create a writable clone with `git clone <url> <dir> && git -C <dir> checkout -b served origin/<default>`. Don't use a shallow clone.

## One pass

Each entry is handled on its own. A failure in one never stops the others.

**Read-only entry:** `git pull --ff-only`.

**Writable entry:**

1. Refuse if the clone isn't on `served`, so a pass can never commit onto someone's working branch.
2. If anything is uncommitted:
   1. Stop if a changed file is under 2 minutes old: writes are still arriving.
   2. Run `srs repo validate`. Errors hold the pass.
   3. Commit everything, signed as usual. A signing failure holds the pass; signing is never bypassed.
3. Fetch and rebase `served` onto `origin/<default>`. On conflict, abort the rebase and hold.
4. If nothing is ahead of `origin/<default>`, stop: the earlier writes have merged and `served` is back on main.
5. Force-push to `writes/<host>`. The branch belongs to this machine and each pass rebuilds it, which also keeps its pull request up to date under strict branch protection.
6. Open a pull request if none is open, then ask it to merge itself when checks pass. A repository with no required checks merges directly.

A hold loses nothing: the write stays in the clone and is still served. The next pass tries again.

## Status

`clerk save --json` prints one object per entry:

| Field | Meaning |
|---|---|
| `id` | the repository id |
| `path` | the served path |
| `readOnly` | the registry's flag |
| `uncommitted` | files written but not yet committed |
| `pending` | commits not yet on `origin/<default>` |
| `behind` | commits on `origin/<default>` not yet in the clone |
| `pr` | the pull request this pass opened or found, or `null` |
| `held` | why this entry stopped, in words, or `null` |

The pull request's label is `--label`, else the programme's auto-merge gate when `--repo` names one, else none. The label is how the clerk's upkeep finds the pull request; the merge request doesn't depend on it.

The command exits 0 whenever the pass ran, because a hold is data. It exits 2 on bad usage or an unreadable registry.

## What it doesn't do

- **Lost updates.** Two sessions changing the same record can still lose a write, because each stdio session runs its own server process. That needs a per-repository lock file the server and the pass share (SP-144); it would replace the 2-minute wait.
- **Feature-branch writes.** A session on a feature branch writes with the CLI and `--repo` in its own worktree.
- **Other hosts.** The clerk's command supplies only GitHub, through its signed adapter (`lib/adapters/github.mjs`). The pass itself doesn't change for another host.
- **Running on a schedule.** It's a command. It joins `clerk serve` when it meets ruling `a1b06725`.
