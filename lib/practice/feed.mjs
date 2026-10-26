// The topup feed: which candidates fill the Ready deficit. Pure. Epic-major order is the default; strength (a care mode of
// build, read by the Confidence and care policy) earns up to `slots` of the nominations whatever the epic's rank (clerk#196).
export const STRONG_SLOTS_DEFAULT = 2;

// candidates: feed order, each with a `key`. strongKeys: Set of the keys whose care mode is build. -> nominees, at most `deficit`.
// First up to min(slots, deficit) strong candidates in feed order, then the epic-major remainder; none nominated twice.
export function planStrongTopup(candidates, strongKeys, deficit, slots = STRONG_SLOTS_DEFAULT) {
  const room = Math.max(0, deficit);
  const strong = candidates.filter((c) => strongKeys.has(c.key)).slice(0, Math.max(0, Math.min(slots, room)));
  const picked = new Set(strong.map((c) => c.key));
  return [...strong, ...candidates.filter((c) => !picked.has(c.key))].slice(0, room);
}
