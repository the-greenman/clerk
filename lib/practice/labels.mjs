// The label check (clerk#121 PR C): pure. One repo's GitHub labels against the programme's bindings (decision f58db200).
import { labelDescription } from './workflow.mjs';

// Labels the clerk does not own and never reports: GitHub's defaults and the families the work_label vocabulary leaves out.
const NOT_OURS = /^(bug|documentation|duplicate|enhancement|good first issue|help wanted|invalid|question|wontfix|accessibility)$|^(complexity|milestone|story|size|epic-\d+):/;

// W: workflowFrom(...); have: the repo's labels [{name, description}]; inUse: {retired label name: open items carrying it};
// groupLabels: the chartered groups' wg: labels. -> {missing, stale, retired, unknown}, each a list (empty means in line).
export function planLabels(W, have, inUse = {}, groupLabels = []) {
  const names = new Map(have.map((l) => [l.name, l]));
  const want = W.labels.map((l) => ({ name: l.name, description: labelDescription(l.description) }));
  const known = new Set([...want.map((l) => l.name), ...W.retired.map((r) => r.name), ...groupLabels]);
  return {
    missing: want.filter((l) => !names.has(l.name)),
    stale: want.filter((l) => names.has(l.name) && (names.get(l.name).description ?? '') !== l.description)
      .map((l) => ({ ...l, have: names.get(l.name).description ?? '' })),
    retired: W.retired.filter((r) => names.has(r.name)).map((r) => ({ ...r, open: inUse[r.name] ?? null })),
    unknown: have.map((l) => l.name).filter((n) => !known.has(n) && !NOT_OURS.test(n)),
  };
}
