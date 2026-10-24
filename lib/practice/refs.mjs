// Issue and PR refs named in text: pure. steward-check and pr-tree read prerequisites here and nowhere else.
export const REF_RE = /(?:([\w.-]+)\/)?([\w.-]+)?#(\d+)/g;

const BLOCKED_BY_RE = /^\W*Blocked by\b:?([^\n]*)/gim;
const DEPENDS_ON_RE = /^\W*Depends on\b:?([^\n]*)/gim;
const ONCE_RE = /\bonce\s+((?:[\w.-]+\/)?[\w.-]*#\d+)\s+lands\b/gi;

// Prerequisites named in text (clerk#113): refs on a "Blocked by:" line, and "once <ref> lands"; with dependsOn, "Depends on" lines too.
// A bare #n takes the repo of the ref before it on the line, else `repo` (the text's own). -> ['repo#n'], deduped.
export function prereqRefs(body, repo, { dependsOn = false } = {}) {
  const out = new Set(), add = (tail) => { let last = repo; for (const m of tail.matchAll(REF_RE)) { last = m[2] ?? last; out.add(`${last}#${m[3]}`); } };
  const text = String(body ?? "");
  for (const [, tail] of text.matchAll(BLOCKED_BY_RE)) add(tail);
  if (dependsOn) for (const [, tail] of text.matchAll(DEPENDS_ON_RE)) add(tail);
  for (const [, ref] of text.matchAll(ONCE_RE)) add(ref);
  return [...out];
}
