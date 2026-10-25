// The dots a work item needs before work can flow (clerk#126): each one holds, or names its gap and the fix. Pure.
// A missing dot that a recorded rule can supply is `auto` (an agent joins it, citing the rule); anything else is a gap a
// person or a brief must fill. Confidence never stops work (the care policy grades care); only a missing dot does.

const REF = /(?:\b([\w.-]+)\/)?(?:\b([\w.-]+))?#(\d+)\b/g;
// refs on every line starting with `label:` (e.g. "Part of", "Blocked by"), up to a ';', as repo#n; a bare #n is in the item's repo
const refsAfter = (body, label, repo) => [...(body ?? '').matchAll(new RegExp(`^[\\s>*_-]*${label}:?\\s*(.+)$`, 'gim'))]
  .flatMap((l) => [...l[1].split(';')[0].matchAll(REF)].map((m) => `${m[2] ?? repo}#${m[3]}`)); // a ';' ends the list: "…; builds on #591" is not a blocker

// Is it routed to a lane a routine reads? The central lane label, or the label of a group that works in the item's
// repository. groups null (unknown): any wg: label counts. The one feed rule, shared with topup (gh-project hasLane); the lane
// dot also passes an item that holds work (an epic, story or plan) or is held by its assignee, which topup never feeds.
export function routed(labels = [], { lane, groups = null, repo } = {}) {
  return labels.some((l) => (lane && l === lane) || (groups ? groups.some((g) => g.label === l && (!g.repos || g.repos.includes(repo))) : l.startsWith('wg:')));
}

// item: {ref: repo#n, body, labels:[name], subIssues?: count, assigned?: bool, parents:[repo#n] nearest first, parentsUnknown?: reason, blockedBy:[{ref, open}] | {unknown: reason}}
// facts: care-policy itemFacts(); epics: roadmap derive() epics [{refs, parked}]; groups: loadGroups() [{label, domains, repos}];
// wf: workflow labels {lane, holds}; care: evaluate() result {mode, rule} | null (no care policy).
// -> [{dot, ok, gap?, fix?, rule?, auto, note?}]
export function dotsFor({ item, facts, epics = [], groups = [], wf, care = null }) {
  const labels = item.labels ?? [], dots = [], repo = item.ref?.split('#')[0];
  const add = (dot, ok, more = {}) => dots.push({ dot, ok, auto: false, ...more });

  const { answers } = facts;
  // a problem that is unknown or set aside grounds nothing: it neither passes the dot nor routes the item
  const usable = facts.problems.filter((p) => p.layer && p.layer !== 'set-aside');
  const unusable = facts.problems.filter((p) => !usable.includes(p));
  if (!answers.problems.length) add('problem', false, answers.none !== undefined
    ? { gap: `says no affirmed problem yet (${answers.none})`, fix: 'suggest the problem in the method layer, then name it in Answers:' }
    : answers.stated ? { gap: 'its Answers: line names no SP-nn', fix: 'name the problem by its id, "Answers: SP-nn"' }
    : { gap: 'no Answers: line', fix: 'add "Answers: SP-nn" naming the problem it answers' });
  else if (unusable.length) add('problem', false, { gap: unusable.map((p) => `${p.id} is ${p.layer ? 'set aside' : 'not a known problem'}`).join('; '),
    fix: 'name a problem that is suggested or affirmed' });
  else add('problem', true);

  if (facts.epic) add('epic', facts.epic.ranked, facts.epic.ranked ? {} : { gap: `${facts.epic.ref} is not ranked (parked)`, fix: 'rank its objective, or move the issue to a ranked epic' });
  else {
    const refs = refsAfter(item.body, 'Part of', repo), parked = new Set(epics.filter((e) => e.parked).flatMap((e) => e.refs ?? [e.ref]));
    const ranked = new Set(epics.filter((e) => !e.parked).flatMap((e) => e.refs ?? [e.ref]));
    const named = refs.find((r) => ranked.has(r)), namedParked = refs.find((r) => parked.has(r)), top = (item.parents ?? []).at(-1);
    // GitHub allows one parent: an item that already has one, or whose parents cannot be read, is never re-parented
    add('epic', false, named && item.parentsUnknown ? { gap: `says "Part of ${named}", but its parent chain is unreadable (${item.parentsUnknown})`, fix: 'read its parents again before linking it' }
      : named && top ? { gap: `says "Part of ${named}", but its parent chain ends at ${top}`, fix: `link ${top} as a sub-issue of ${named}, if that is where it belongs` }
      : named ? { gap: `says "Part of ${named}" but is not its sub-issue`, fix: `link it as a sub-issue of ${named}`, rule: 'Part of names the parent', auto: true }
      : namedParked ? { gap: `says "Part of ${namedParked}", a parked epic`, fix: 'rank its objective, or name a ranked epic' }
      : { gap: 'no parent reaching a roadmap epic', fix: 'make it, or its top parent, a sub-issue of the epic that implements its remedy' });
  }

  const works = (g) => !g.repos || g.repos.includes(repo);
  const wrong = groups.filter((g) => g.label && labels.includes(g.label) && !works(g)).map((g) => g.label);
  // An epic or sequence is not work for a lane: its tasks are routed, not it. An assigned item is held by its assignee (clerk#201).
  if (routed(labels, { lane: wf.lane, groups, repo })) add('lane', true);
  else if (item.subIssues > 0 || ['epic', 'user-story', 'plan'].some((l) => labels.includes(l))) add('lane', true, { note: 'holds work: its tasks are routed, not it' });
  else if (item.subIssues === undefined) add('lane', false, { gap: 'its sub-issues are unread, so it may be an epic', fix: 'read it again before routing it' });
  else if (item.assigned) add('lane', true, { note: 'assigned: its assignee holds it (an abandoned claim that leaves the assignment is cleared by stale-claims)' });
  else if (!usable.length) add('lane', false, { gap: `no lane${wrong.length ? `: ${wrong.join(', ')} does not work in ${repo}` : ''}`, fix: 'route it once it names a usable problem' });
  else {
    const domains = new Set(usable.flatMap((p) => p.domains ?? []));
    const holders = groups.filter((g) => (g.domains ?? []).some((d) => domains.has(d)) && works(g));
    const gap = wrong.length ? `labelled ${wrong.join(', ')}, which does not work in ${repo}` : 'no lane or group label, so no routine will take it';
    // two groups holding the domain is a choice for a person, never a rule
    add('lane', false, holders.length > 1 ? { gap: `${gap}; ${holders.map((g) => g.label).join(' and ')} both hold its domain`, fix: 'choose the group, then label it' }
      : { gap, fix: `label it ${holders[0]?.label ?? wf.lane}`, auto: true,
          rule: holders.length ? `the group that holds the problem's domain takes it (D4, D5, D15)` : 'no group that holds the problem\'s domain works in this repository, so it goes to the central lane (D4, D5, D15)' });
  }

  if (facts.plan.section || facts.plan.steps) add('plan', true);
  else add('plan', false, { gap: 'no technical plan', fix: 'write a "## Technical plan" section (where the change lives, what it calls, how it is tested)' });

  if (item.blockedBy?.unknown) add('blockers', false, { gap: `dependencies unreadable (${item.blockedBy.unknown})`, fix: 'read them again; until then the blockers are unknown' });
  else {
    const deps = item.blockedBy ?? [], linked = new Set(deps.map((b) => b.ref));
    const unlinked = [...new Set(refsAfter(item.body, 'Blocked by', repo))].filter((r) => !linked.has(r));
    const open = deps.filter((b) => b.open).map((b) => b.ref);
    const gaps = [unlinked.length && `"Blocked by ${unlinked.join(', ')}" is only text`, open.length && `waits on ${open.join(', ')}`].filter(Boolean);
    const fixes = [unlinked.length && 'record each as a blocked-by dependency', open.length && `move ${open.join(', ')} first`].filter(Boolean);
    // one dot per item: recording the text is mechanical, an open blocker is not
    add('blockers', !gaps.length, gaps.length ? { gap: gaps.join('; '), fix: fixes.join('; '), ...(unlinked.length && !open.length ? { rule: 'Blocked by names the dependency', auto: true } : {}) } : {});
  }

  const held = labels.filter((l) => (wf.holds ?? []).includes(l));
  add('hold', !held.length, held.length ? { gap: `held: ${held.join(', ')}`, fix: 'answer or release the hold' } : {});

  if (care) add('care', true, { note: care.mode ? `${care.mode.key ?? care.mode} (${care.rule?.title ?? care.rule})` : 'no care rule matches it' });
  return dots;
}

// Can a routine take it once ready? Every dot holds. -> {flows, gaps, auto}
export function flowState(dots) {
  const gaps = dots.filter((d) => !d.ok);
  return { flows: gaps.length === 0, gaps: gaps.length, auto: gaps.filter((d) => d.auto).length };
}
