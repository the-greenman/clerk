// Chartering a working group: pure. Options + the groups that already exist -> the ordered list of writes that make a new group,
// as DRAFT/PROPOSED records for an owner session to ratify. adapters/charter.mjs performs them. Refs ("@role") name records the
// adapter has created earlier in the plan. Shape and wording follow WG Third-party ready (srs-programme f6db54e2).
const SEATS = {
  steward: 'convene each cycle, close it at the rhythm set in the Cycle and report article, write the report and the minutes, and open escalations as proposed decisions. You never build or review the group\'s PRs and never decide a ruling.',
  builder: 'execute lane issues that carry the group label and name the ruling they execute, up to 3 per run, stopping at the budget. Open PRs without a gate label, with Builder and Mandate lines. Never review your own run\'s PRs. Local Claude Code sessions act as builders alongside any routine, under the same rules (owner decision f799b6bc, proposed): own SRS_ACTOR, same mandate, same budget, same quorum.',
  reviewer: 'review open group PRs built by an earlier run or session in a fresh context, run the gates yourself, list findings, and only then post the quorum comment and add gate:auto-merge. An empty findings list is itself reported. A group session ratifies its builders\' within-mandate decisions (owner decision 70a05a5c, proposed).',
};
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const fail = (m) => { throw new Error('clerk charter: ' + m); };

export function validateCharter(o, groups = []) {
  for (const k of ['title', 'epic', 'label', 'budget', 'cycleClose']) if (o[k] === undefined || o[k] === '') fail(`--${k === 'cycleClose' ? 'cycle-close' : k} is required`);
  if (!/^[\w.-]+#\d+$/.test(o.epic)) fail(`--epic must look like repo#n, got "${o.epic}"`);
  if (!/^wg:[a-z0-9-]+$/.test(o.label)) fail(`--label must look like wg:some-name, got "${o.label}"`);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(o.cycleClose)) fail(`--cycle-close must be HH:MM, got "${o.cycleClose}"`);
  if (!Number.isInteger(o.budget) || o.budget < 1) fail('--budget must be a positive integer');
  if (!o.repos?.length) fail('--repos needs at least one repository');
  const seats = o.quorumSeats ?? [];
  if (!seats.length || new Set(seats).size !== seats.length) fail('--quorum-seats needs distinct seats, e.g. builder,reviewer');
  if (!seats.every((s) => /^[a-z][a-z-]*$/.test(s))) fail('seats are lowercase words');
  if (!o.requiredSeat || !seats.includes(o.requiredSeat)) fail(`--required-seat "${o.requiredSeat ?? ''}" must be one of the quorum seats (${seats.join(', ')})`);
  const min = o.quorumMin ?? Math.min(2, seats.length);
  if (!Number.isInteger(min) || min < 1 || min > seats.length) fail(`--quorum-min must be between 1 and ${seats.length}`);
  const t = o.title.toLowerCase();
  for (const g of groups) {
    if (g.label === o.label) fail(`label ${o.label} already belongs to "${g.title}"`);
    if (g.title.toLowerCase() === t) fail(`a group titled "${g.title}" already exists`);
  }
  return { ...o, quorumMin: min };
}

// o: {title, epic, label, repos[], budget, cycleClose, quorumSeats[], requiredSeat, quorumMin?, maxUnacked?, prefix?}
// ctx: {ownerLogId, groups, compass?: {narrows: id, tensions: [id]}, existingActors?: []}
// -> [{op: 'create'|'relate'|'member'|'transition', ref?, type?, container?, fieldValues?, ...}]
export function planCharter(options, ctx) {
  const o = validateCharter(options, ctx.groups ?? []);
  const prefix = o.prefix ?? o.label.slice(3), slug = o.label.slice(3), maxUnacked = o.maxUnacked ?? 2;
  const actor = (s) => `agent:${prefix}-${s}`;
  for (const s of o.quorumSeats) if ((ctx.existingActors ?? []).includes(actor(s))) fail(`actor ${actor(s)} already exists; pick another --prefix`);
  const who = o.quorumSeats.map((s) => `${cap(s)} (${actor(s)})`).join(', ');
  const status = 'proposed', amend = 'Owner only: an amendment needs a new owner-ratified decision.', prot = 'Agent testimony until the owner ratifies the charter decision.';
  const art = (ref, title, article_text, rationale) => ({ op: 'create', ref, type: 'governance/article', container: '@group', fieldValues: { title, article_text, rationale, amendment_rule: amend, protected_status: prot, status } });
  const epicLine = `Epic ${o.epic} (the epic record and this role are not related by any relation type: ${o.epic} is named here)`;
  const w = [
    { op: 'create', ref: 'log', type: 'governance/decision_log', fieldValues: { title: `${o.title}: decisions` } },
    { op: 'container', ref: 'group', title: o.title, name: `wg-${slug}`, identity: '@log',
      description: `Charter records of the ${o.title} working group (${o.epic}): role, standing orders, agents and the decision log.` },
    { op: 'create', ref: 'role', type: 'governance/role', container: '@group', fieldValues: {
      title: o.title, role_holder: `${who}; the owner is the parent role`,
      authority: `Decides itself and auto-merges any change that executes a recorded ruling, RFC or invariant and names it; in mode clear or complicated; within ${o.repos.join(', ')}; with green gates; at most ${o.budget} delegated merges per cycle, and only while the group is not paused (${maxUnacked} consecutive unacknowledged cycle reports). ${epicLine}.`,
      boundary: 'Escalates, one proposed decision each: any change that would make or change a ruling; Door 2 or Door 3; complex mode; a breaking CLI or payload change; a pin bump in another repo; anything that touches gates or merge rules; going over budget. Outside: new rulings and RFCs.',
      source_of_authority: 'Owner (delegation, once ratified by the owner\'s charter decision)',
      revisit_when: `The epic ${o.epic} closes, or the owner changes the mandate.`, status,
      group_label: o.label, quorum_min_members: o.quorumMin, quorum_seats: o.quorumSeats, quorum_required_seat: o.requiredSeat,
      budget_per_cycle: o.budget, cycle_close_utc: o.cycleClose, max_unacked_reports: maxUnacked, governed_repos: o.repos } },
    art('a-quorum', 'Membership and quorum', `Members: ${who}, each running under its own SRS_ACTOR; the owner is the parent role. Quorum for a merge: the builder plus a different reviewer, as two distinct actors, with green gates. The group never self-reviews: a run or session never reviews a PR it built itself. Local Claude Code sessions act as members under the same rules as routines (owner decision f799b6bc, proposed). A group session ratifies its builders' within-mandate decisions (owner decision 70a05a5c, proposed).`,
      'Keeps the review independent even though all actors share one GitHub identity (owner ruling D7, 2026-10-09).'),
    art('a-cycle', 'Cycle and report', `The cycle is a rhythm set here, not a fixed week. Current rhythm: daily; the cycle closes at ${o.cycleClose} UTC. The owner can amend the rhythm. At each close the steward closes the cycle and posts a short report on the programme's report issue (setting report_issue), a comment whose first line is \`<!-- wg-report cycle=<YYYY-MM-DD> group=${o.label} -->\`. The report uses the standard run-report headings plus figures: PRs merged with their quorum line, PRs open, stops, red gates, budget used and pause state. The owner acknowledges a report with a thumbs-up (+1) reaction from the owner account on the report comment. The group pauses after N=${maxUnacked} consecutive unacknowledged cycle reports. While paused, pr-upkeep merges no group PRs, the builder opens nothing new, and reviews and escalations continue. A thumbs-up on a report lifts the pause.`,
      'The owner sets the rhythm so each report stays one cycle and short; the pause stops delegated work piling up unread.'),
    art('a-budget', 'Budget', `At most ${o.budget} delegated merges per cycle. The count resets at each cycle close (${o.cycleClose} UTC at the current rhythm). Only the group's own delegated merges count: a group PR carrying gate:owner-merge does not. The builder also stops when delegated merges in the current cycle plus open delegated group PRs reach ${o.budget}, and labels the issue needs-input. Going over budget is an escalation.`,
      'A cap keeps the output reviewable (reviewable units over throughput).'),
    art('a-minutes', 'Reporting and minutes', `The group keeps its minutes in its decision log (container ${o.title}). A task gets no decision record; close an issue only with a merged PR. A within-mandate decision that closes options is created proposed by the builder, then ratified in a group session by the reviewer under its own actor. Every escalation is a proposed decision created by the steward, opening with the problem statement; only the owner moves it to ratified. The steward is the only member who opens escalations.`,
      'Minutes are the audit trail for a mandate that rests on testimony, since one GitHub identity does every merge.'),
    ...o.quorumSeats.map((s) => ({ op: 'create', ref: `m-${s}`, type: 'com.mudemocracy.stewardship/agent', container: '@group', fieldValues: {
      title: `${o.title.replace(/^WG /, '')} ${s}`, actor_id: actor(s), seat: s,
      brief: `You are the ${cap(s)} of the ${o.title} group (${o.epic}), running as SRS_ACTOR ${actor(s)}. ${SEATS[s] ? `Your seat: ${SEATS[s]}` : 'Your seat is defined by the Membership and quorum article; do only what it and the mandate allow.'}` } })),
    { op: 'create', ref: 'boundary', type: 'com.mudemocracy.argument/boundary', container: '@suggestions', fieldValues: {
      title: o.title, purpose: `The group answers epic ${o.epic} and closes the gaps it names.`, inside: `${o.repos.join(', ')}: changes that execute an existing ruling.`, outside: 'New rulings and RFCs.',
      authority_basis: `The owner's delegation, once ratified (${o.epic}). It inherits the compass of the boundary it narrows.`, revision_condition: `The epic ${o.epic} closes, or the owner changes the mandate.` } },
    { op: 'create', ref: 'charter', type: 'governance/decision', container: '@group', fieldValues: {
      title: `Charter: ${o.title}`,
      decision_question: `Does the owner delegate the ${o.title} mandate on the terms in the group role and its four standing orders?`,
      decision_statement: `Ratify: the group role and its standing orders (membership and quorum, cycle and report, budget, reporting and minutes) are the mandate of the ${o.title} working group (${o.epic}). Ratifying also asserts the delegates relation from the Owner role. Amendments need a new owner decision.`,
      rationale: `${o.epic}; drafted by the clerk charter command as the acting actor, for an owner session to ratify.`, owner: 'Peter Brownell', status: 'active' } },
    { op: 'transition', ref: 'charter', to: 'proposed' },
    { op: 'member', container: ctx.ownerLogId, ref: 'charter' }, // one record, listed in the parent log too: never a copy
    ...o.quorumSeats.map((s) => ({ op: 'relate', type: 'com.mudemocracy.stewardship/authorised-by', source: `@m-${s}`, target: '@role' })),
    ...['a-quorum', 'a-cycle', 'a-budget', 'a-minutes'].map((a) => ({ op: 'relate', type: 'com.mudemocracy.argument/within-boundary', source: `@${a}`, target: '@boundary' })),
    ...(ctx.compass?.narrows ? [{ op: 'relate', type: 'com.mudemocracy.argument/narrows', source: '@boundary', target: ctx.compass.narrows }] : []),
    ...(ctx.compass?.tensions ?? []).map((t) => ({ op: 'relate', type: 'com.mudemocracy.argument/holds-tension', source: '@boundary', target: t })),
  ];
  // Not performed: they are the owner's to do, at ratification (TPR precedent: the delegates relation arrived in the ratification commit).
  const ownerSteps = [
    `Ratify the charter decision "Charter: ${o.title}" in a session.`,
    'Assert delegates: Owner role -> the group role (srs relation create, as the owner).',
    'Move the role and the four articles out of draft and set their status to ratified, if the owner wants them to match the decision.',
    `Create GitHub label ${o.label} in: ${o.repos.join(', ')}.`,
    'Create cloud routines (steward, builder, reviewer) and standing-job records, if wanted.',
  ];
  return { writes: w, ownerSteps, actors: o.quorumSeats.map(actor) };
}
