// canon: one identity for a record across the Suggestions/Affirmed layers. Pure.
//
// Design principle (ADR-048 one-way-per-goal): the human layer adopts an agent's suggestion by `record fork`, a NEW record
// `derived-from` the suggestion; the fork and its origin are one piece of meaning written down twice. Edges (held-by,
// in-domain, contains) may sit on either copy, so any rule asking "is this the same thing?" must compare identities, not
// instance ids. canon(id) is that identity: follow `derived-from` (fork -> origin) to its root. Every question of the form
// "does A reach B through the layers?" (the principle 2 gate, clerk#35; indicator I1, clerk#25) asks it here and nowhere
// else, so the two can never disagree about what counts as the same record.
// Not a general equivalence: only derived-from chains count, and a record derived from two origins keeps its first (sorted)
// so the answer is stable.
export function canonOf(relations) {
  const parent = new Map();
  for (const r of relations.filter((x) => x.relationType === 'derived-from').sort((a, b) => String(a.targetId).localeCompare(String(b.targetId))))
    if (!parent.has(r.sourceId)) parent.set(r.sourceId, r.targetId);
  const root = new Map();
  const canon = (id) => {
    if (root.has(id)) return root.get(id);
    const seen = new Set([id]);
    let cur = id;
    while (parent.has(cur) && !seen.has(parent.get(cur))) { cur = parent.get(cur); seen.add(cur); }
    for (const s of seen) root.set(s, cur);
    return cur;
  };
  return canon;
}
