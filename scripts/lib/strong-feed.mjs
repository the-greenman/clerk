// Which topup candidates are strong: the Confidence and care policy gives them the care mode build. Script-level because
// the reading is shared with `clerk care` (scripts/lib/care.mjs). Without a policy, or when it cannot be read, none are
// strong and topup keeps the epic-major order alone.
import { careContext, careFor } from './care.mjs';
import { srsCli } from '../../lib/adapters/cli.mjs';
import { loadSettings } from '../../lib/adapters/settings.mjs';
import { resolve } from 'node:path';
import { STRONG_SLOTS_DEFAULT, planStrongTopup } from '../../lib/practice/feed.mjs';

// candidates: rows {key, repo, num} in feed order. Reads in that order and stops at `slots` strong ones or `cap` readings (a strong item deeper than `cap` candidates waits for the epic-major order).
export function strongKeysOf(repo, candidates, slots = STRONG_SLOTS_DEFAULT, cap = 40) {
  const strong = new Set();
  try {
    const cli = srsCli(repo), st = loadSettings(repo, cli);
    if (!st.carePolicyContainer || slots <= 0) return strong;
    const ctx = careContext(repo, cli, st);
    let read = 0;
    for (const c of candidates) {
      if (strong.size >= slots || read++ >= cap) break;
      try { if (careFor(repo, cli, st, c.repo, c.num, ctx).result?.mode?.key === 'build') strong.add(c.key); } catch { /* unreadable: not strong */ }
    }
  } catch (e) { console.error(`topup: strength not read (${e.message}); epic-major order only`); }
  return strong;
}

// The deficit's nominees: strong work in its slots, then the epic-major order. Reads strength only when there is a deficit.
export const topupNominees = (candidates, deficit) =>
  planStrongTopup(candidates, deficit > 0 ? strongKeysOf(resolve(process.env.CLERK_REPO || process.cwd()), candidates) : new Set(), deficit);
