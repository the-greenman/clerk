// The work-status set (decision f58db200): what a status, hold or gate means lives in the SRS definitions
// (com.semanticops.programme work_item, work_hold, merge_gate, work_label); how this programme shows it (a GitHub
// label, a board column) lives in its label-binding records. Pure: adapters/workflow.mjs reads both through the srs CLI.
export const NS = 'com.semanticops.programme';
export const BINDING_TYPE = `${NS}/label-binding`;

// GitHub caps a label description at 100 characters: the first sentence of the definition, cut to fit.
export const labelDescription = (text = '') => { const first = text.split(/(?<=\.)\s/)[0]; return first.length <= 100 ? first : `${first.slice(0, 99)}…`; };

// {lifecycles, vocabularies, bindings: [label-binding fieldValues]} -> the labels and board columns the clerk acts on.
// Throws when a definition the clerk acts on has no active binding: a missing label stops the run, never a guess.
export function workflowFrom({ lifecycles = [], vocabularies = [], bindings = [] }) {
  const lc = lifecycles.find((l) => l.namespace === NS && l.name === 'work_item');
  if (!lc) throw new Error(`no ${NS} work_item lifecycle installed in the programme`);
  const terms = (name) => vocabularies.find((v) => v.namespace === NS && v.name === name)?.terms ?? [];
  const defs = new Map([...lc.states, ...['work_hold', 'merge_gate', 'work_label'].flatMap(terms)].map((d) => [d.id, d]));
  const active = bindings.filter((b) => b.binding_status === 'active' && defs.has(b.binds));
  const bound = (key) => active.find((b) => defs.get(b.binds).key === key);
  const label = (key) => {
    const l = bound(key)?.github_label;
    if (!l) throw new Error(`no active label-binding gives "${key}" a GitHub label (programme label bindings)`);
    return l;
  };
  const column = (key) => {
    const c = bound(key)?.board_status;
    if (!c) throw new Error(`no active label-binding gives work_item state "${key}" a board column`);
    return c;
  };
  const columns = Object.fromEntries(lc.states.map((s) => [s.key, column(s.key)]));
  const holds = terms('work_hold').map((t) => label(t.key));
  // board column -> mirror label, for the positions the routines must see (they cannot read the board)
  const statusLabels = Object.fromEntries(lc.states.filter((s) => bound(s.key)?.github_label).map((s) => [columns[s.key], label(s.key)]));
  return {
    columns, statusLabels, holds,
    ready: label('ready'), inProgress: label('in_progress'), inReview: label('in_review'),
    // merge_gate: how a pull request may merge (rules are the owner's, a8bc55ef); upkeep, the desk and sessions read these
    gates: { auto: label('auto-merge'), owner: label('owner-merge') },
    lane: label('lane-unattended'),
    promote: label('promote-request'), needsInput: label('needs-input'), blocked: label('blocked'), parked: label('parked'), bug: label('bug'),
    // optional until the programme binds it (clerk#113): a parked issue that blocks ranked work; null while unbound
    blocksRanked: bound('blocks-ranked')?.github_label ?? null,
    // Held: carries any work_hold label. An assignee or an open pull request is a position, not a hold.
    isHeld: (labels) => labels.some((l) => holds.includes(l)),
    // every active label with the meaning of what it binds (label sync)
    labels: active.filter((b) => b.github_label).map((b) => ({ name: b.github_label, key: defs.get(b.binds).key, description: defs.get(b.binds).description })),
    // retired labels still to migrate: each moves to the active label of the definition it binds (null: no successor, removed)
    retired: bindings.filter((b) => b.binding_status === 'retired' && b.github_label && !active.some((x) => x.github_label === b.github_label))
      .map((b) => ({ name: b.github_label, successor: (defs.has(b.binds) && bound(defs.get(b.binds).key)?.github_label) || null })),
  };
}
