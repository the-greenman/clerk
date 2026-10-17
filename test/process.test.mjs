// One programme cycle end to end (clerk#20). One test group per handbook stage (docs/handbook.md).
// A passing test = the stage's Practice claim holds. A test.todo = the handbook's rule is not implemented yet:
// the todo list is the progress bar. Offline: plain objects shaped like `srs record list` / `srs relation list`.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { derive } from '../scripts/roadmap.mjs';
import { checkMethod, checkGates } from '../scripts/check-method.mjs';
import { classify, lanesFrom } from '../scripts/queue.mjs';
import { checkClaim } from '../lib/practice/claim.mjs';
import { centralGroupFrom } from '../lib/practice/groups.mjs';
import { plan as stewardPlan } from '../scripts/steward-check.mjs';
import { checkRoutines } from '../lib/practice/routines.mjs';
import { authorise, quorum, ROLES, rolesFor } from '../lib/practice/roles.mjs';
import { groups, tprGroup, fxGroup, FX, roles, agents, authorisedBy } from './groups.fixture.mjs';
import { groupsFrom } from '../lib/practice/groups.mjs';
import { take, assertQuorum, summarise } from '../lib/practice/session.mjs';
import * as A from '../lib/practice/agenda.mjs';
import { endSession } from '../lib/adapters/session.mjs';
import { groundPR, i1 } from '../lib/practice/grounding-check.mjs';

// ---- the fixture: one coherent story ----
const M = 'com.semanticops.method', P = 'com.semanticops.programme';
const rec = (instanceId, typeName, fieldValues, extra = {}) => ({ instanceId, record: { typeName, fieldValues, createdBy: { kind: 'human', id: 'human:ada' }, createdAt: '2026-10-11T08:00:00Z', ...extra } });
const rel = (ns, type, sourceId, targetId) => ({ relationType: type === 'contains' ? type : `${ns}/${type}`, sourceId, targetId });
const ada = JSON.stringify({ kind: 'human', id: 'human:ada' });

const records = [
  rec('dom', 'domain', { title: 'Collaborative writing', purpose: 'People writing together', in_scope: 'drafting, review', out_of_scope: 'publishing' }),
  rec('clu', 'cluster', { title: 'Shared drafts' }),
  rec('per', 'persona', { title: 'Co-author', summary: 'writes with others', jobs: 'agree a draft', needs: 'see what changed' }),
  rec('prb', 'problem', { problem_id: 'SP-901', title: 'Co-authors cannot see what changed', statement: 'edits are invisible to the other author' }),
  rec('rem', 'remedy', { title: 'Show changes inline', move: 'Render a change view', falsifier: 'Co-authors still ask what changed', return_when: 'after one period' }),
  rec('obj', 'objective', { title: 'Writing together works' }), rec('obj2', 'objective', { title: 'Second' }), rec('obj3', 'objective', { title: 'Third' }), rec('obj4', 'objective', { title: 'Unranked' }),
  rec('per1', 'period', { title: 'Focus Fixture', starts_on: '2026-10-08', objective_rank: ['obj', 'obj2', 'obj3'] }),
  rec('epc', 'epic', { title: 'Change view epic', issue_ref: ['fixture#1'] }),
  rec('epc2', 'epic', { title: 'Second epic', issue_ref: ['fixture#2'] }), rec('epc3', 'epic', { title: 'Unranked epic', issue_ref: ['fixture#3'] }),
];
const relations = [
  rel(M, 'contains', 'dom', 'clu'), rel(M, 'contains', 'clu', 'prb'), rel(M, 'held-by', 'prb', 'per'), rel(M, 'answers', 'rem', 'prb'),
  rel(M, 'implements', 'epc', 'rem'), rel(M, 'answers', 'epc', 'prb'), rel(M, 'addresses', 'obj', 'clu'),
  rel(P, 'serves', 'epc', 'obj'), rel(P, 'serves', 'epc2', 'obj2'), rel(P, 'serves', 'epc3', 'obj4'),
];
const affirmed = new Set(['dom', 'clu', 'per', 'prb', 'rem']);
const TODAY = '2026-10-11';

// execution half: an issue answering the problem, built by one session member, reviewed by another
const BUILDER = 'agent:fx-builder', REVIEWER = 'agent:fx-reviewer';
const issue = { repo: 'fixture', number: 10, title: 'Add change view', html_url: '', created_at: '2026-10-11T09:00:00Z', labels: [{ name: 'wg:fixture' }, { name: 'ready' }, { name: 'priority: P0' }], body: 'Answers: SP-901' };

const derived = derive(records, relations, TODAY, affirmed);
const e1 = derived.epics.find((e) => e.ref === 'fixture#1');

// ---- 1. Roles and layers ----
describe('stage 1: roles and layers', () => {
  test('a session member acts under the same rules as a routine: only the held role counts, human or AI', () => {
    const held = rolesFor(groups), sessionMember = JSON.stringify({ kind: 'human', id: REVIEWER }); // a local session standing in for the reviewer
    assert.equal(authorise('fx-reviewer', sessionMember, 'human:ada', held).actor, REVIEWER);
    assert.throws(() => authorise('fx-reviewer', ada, 'human:ada', held), /does not hold the role/);
    assert.throws(() => authorise('fx-reviewer', JSON.stringify({ kind: 'ai', id: BUILDER }), 'human:ada', held), /does not hold the role/);
  });
  test('an AI actor cannot be a member of the Affirmed layer (agents suggest, the human layer wins)', () => {
    const ai = records.map((r) => (r.instanceId === 'prb' ? { ...r, record: { ...r.record, createdBy: { kind: 'ai', id: 'agent:scout' } } } : r));
    assert.match(checkGates(ai, relations, affirmed, new Set(), TODAY).errors[0], /AI actor/);
  });
  test('the fixture has no layer errors', () => assert.deepEqual(checkGates(records, relations, affirmed, new Set(), TODAY).errors, []));
  test.todo('handbook stage 1: roles are read from records (governance/role with delegates), not hard-coded in lib/practice/roles.mjs');
  test.todo('handbook stage 1: the analyst is a member role (roles.mjs has steward, builder, reviewer only)');
});

// ---- 2. Domain ----
describe('stage 2: domain', () => {
  test.todo('handbook stage 2: every problem belongs to at least one domain (nothing checks it; no code reads domains)');
  test.todo('handbook stage 2: the domain tells us when a problem occurs (derive/explain carries the domain)');
});

// ---- 3. Persona ----
describe('stage 3: persona', () => {
  test('roadmap explain resolves the persona of an answered problem; unaffirmed persona is marked suggested', () => {
    assert.equal(e1.answers[0].persona, 'Co-author');
    assert.equal(e1.answers[0].personaSuggested, undefined); // affirmed in the fixture
    const sug = derive(records, relations, TODAY, new Set([...affirmed].filter((x) => x !== 'per'))).epics[0];
    assert.equal(sug.answers[0].personaSuggested, true);
  });
  test.todo('handbook stage 3: personas reach issues, priority and assignment (today they are only labels in roadmap --explain)');
});

// ---- 4. Problem ----
describe('stage 4: problem', () => {
  test('roadmap reads only the Affirmed problem; a suggestion-only problem is ignored', () => {
    assert.deepEqual(e1.answers.map((a) => a.problem), ['SP-901']);
    assert.equal(derive(records, relations, TODAY).epics[0].answers, undefined);
  });
  test('the same problem_id twice in the Affirmed layer is refused', () => {
    const dup = [...records, rec('prb2', 'problem', { problem_id: 'SP-901', title: 'dup' })];
    assert.match(checkGates(dup, relations, new Set([...affirmed, 'prb2']), new Set(), TODAY).errors[0], /duplicate problem_id SP-901/);
  });
  test('handbook stage 4 / principle 2: an affirmed problem held by no affirmed persona-in-domain warns (warning until both pilot domains are walked)', () => {
    const r = checkGates(records, relations, affirmed, new Set(), TODAY);
    assert.ok(r.warnings.some((w) => /affirmed but held-by no affirmed persona-in-domain/.test(w)));
    assert.deepEqual(r.errors, []);
  });
  test.todo('handbook stage 4: a problem is closed (solved, set aside or superseded) by a recorded ruling');
});

// ---- 5. Remedy ----
describe('stage 5: remedy', () => {
  test('an affirmed remedy must carry a falsifier', () => {
    const bad = records.map((r) => (r.instanceId === 'rem' ? { ...r, record: { ...r.record, fieldValues: { ...r.record.fieldValues, falsifier: '  ' } } } : r));
    assert.match(checkGates(bad, relations, affirmed, new Set(), TODAY).errors[0], /no falsifier/);
  });
  test('an affirmed remedy must answer an affirmed problem', () => {
    assert.match(checkGates(records, relations, new Set(['rem']), new Set(), TODAY).errors.join('\n'), /answers no affirmed problem/);
  });
  test.todo('handbook stage 5: falsifiers and return_when are evaluated (each report or period close lists the due ones)');
});

// ---- 6. Objective and period ----
describe('stage 6: objective and period', () => {
  test('rank 1 is P0, rank 2 P1, rank 3 P2, unranked is parked', () => {
    const pri = Object.fromEntries(derived.epics.map((e) => [e.ref, e.priority]));
    assert.deepEqual([pri['fixture#1'], pri['fixture#2'], pri['fixture#3']], ['P0', 'P1', null]);
    assert.equal(derived.epics.find((e) => e.ref === 'fixture#3').parked, true);
    assert.deepEqual(derived.objectives.map((o) => o.tier).slice(0, 3), ['P0', 'P1', 'P2']);
  });
  test('exactly one period is active', () => {
    assert.equal(derived.activePeriod.title, 'Focus Fixture');
    assert.throws(() => derive(records, relations, '2026-09-01', affirmed), /0 periods active/);
  });
  test.todo('handbook stage 6: an objective has success criteria before it can be ranked');
  test.todo('handbook stage 6: a period ends with a retrospective (end condition and retrospective decision)');
});

// ---- 7. Epic ----
describe('stage 7: epic', () => {
  test('the epic carries the whole chain: persona, cluster, objective, remedy and problem', () => {
    assert.deepEqual(e1.answers, [{ problem: 'SP-901', persona: 'Co-author', cluster: 'Shared drafts', objective: 'Writing together works' }]);
    assert.deepEqual(e1.remedies.map((r) => r.answers), [['SP-901']]);
    assert.equal(e1.objective, 'Writing together works');
  });
  test('an epic serving a ranked objective with no affirmed problem warns; the grounded epic does not', () => {
    const w = checkGates(records, relations, affirmed, new Set(), TODAY).warnings.filter((x) => /answers no affirmed problem/.test(x));
    assert.equal(w.length, 1);
    assert.match(w[0], /Second epic.*answers no affirmed problem/);
  });
  test.todo('handbook stage 7: an epic is a working group (WG Fixture owns it; the group is read from records)');
  test.todo('handbook stage 7: an epic must implement a remedy before it can serve an objective');
});

// ---- 8. Work item ----
describe('stage 8: work item', () => {
  const open = { repo: 'fixture', number: 10, state: 'OPEN', createdAt: '2026-10-11T09:00:00Z', labels: [], comments: [], closingPrs: [], openChildren: [] };
  const run = (body) => stewardPlan([{ ...open, body }], { now: Date.parse('2026-10-11T12:00:00Z'), since: '2026-10-09T00:00:00Z' });
  test('an issue naming its problem (Answers: SP-nn) passes steward-check; one without is commented', () => {
    assert.equal(run(issue.body).length, 0);
    assert.equal(run('No affirmed problem yet: edits are invisible').length, 0);
    assert.equal(run('Add a change view')[0].rule, 'answers');
  });
  test.todo('handbook stage 8: the problem link is a record or relation, not a line of text');
});

// ---- 9. Priority and queue ----
describe('stage 9: priority and queue', () => {
  test('the epic rank reaches the work item as a priority label, and the queue runs P0 first, then oldest', () => {
    const other = { ...issue, number: 11, created_at: '2026-10-01T00:00:00Z', labels: [{ name: 'wg:fixture' }, { name: 'wg:third-party-ready' }, { name: 'ready' }, { name: 'priority: P1' }] };
    const p0 = { ...issue, labels: [...issue.labels, { name: 'wg:third-party-ready' }] };
    const q = classify([other, p0], []);
    assert.deepEqual(q.queued.map((x) => x.ref), ['fixture#10', 'fixture#11']);
    assert.equal(q.queued[0].priority, e1.priority);
  });
  test('a group sets local priorities by a ratified decision, and they outrank the label', () => {
    const dec = { instanceId: 'ld', record: { lifecycleState: 'ratified', createdAt: '2026-10-11', fieldValues: { title: 'Local priorities: fixture#11', decision_statement: 'Do fixture#11 first, then fixture#10.' } } };
    const local = A.localPriorities([dec]);
    assert.deepEqual(local, ['fixture#11', 'fixture#10']);
    const mk = (n, p, d) => ({ repo: 'fixture', number: n, created_at: d, labels: [`priority: ${p}`] });
    assert.deepEqual(A.orderQueue([mk(10, 'P0', '2026-10-11'), mk(11, 'P1', '2026-10-01')], local).map((i) => i.number), [11, 10]);
  });
  test('a dry queue is reported before it runs dry', () => {
    assert.ok(A.isDry(2, 10));
    assert.match(A.forecast(2, 10), /running dry/);
    assert.match(A.forecast(20, 10), /fed for about 2 cycles/);
  });
  test.todo('handbook stage 9 / principle 2: no persona and domain means not ready (a gate or weight in priority)');
});

// ---- 10. Working groups ----
describe('stage 10: working groups', () => {
  test('a decision listed in a parent log is the parent\'s to ratify, not the group\'s', () => {
    const log = (...ids) => ({ memberInstanceIds: ids.map((instanceId) => ({ instanceId })) });
    const ds = ['mine', 'escalated'].map((id) => ({ instanceId: id, record: { lifecycleState: 'proposed', createdBy: { id: 'agent:fx-steward' }, fieldValues: {} } }));
    assert.deepEqual(A.ratifyItems(ds, log('mine', 'escalated'), [log('escalated')]).map((r) => r.instanceId), ['mine']);
  });
  test('a group is chartered from records: label, members, quorum, cycle, budget, pause limit and repos are read, not hard-coded', () => {
    assert.deepEqual(groups.map((g) => g.title), ['WG Third-party ready', 'WG Fixture']); // the Owner role has no group_label: not a group
    assert.deepEqual([fxGroup.label, fxGroup.budget, fxGroup.cycleClose, fxGroup.maxUnacked, fxGroup.repos], ['wg:fixture', 4, '16:00', 3, ['fixture']]);
    assert.deepEqual(fxGroup.quorum, { min: 3, seats: ['steward', 'builder', 'reviewer', 'scribe'], requiredSeat: 'steward' });
    assert.deepEqual(fxGroup.members.map((m) => [m.actor, m.role]), [['agent:fx-steward', 'steward'], ['agent:fx-builder', 'builder'], ['agent:fx-reviewer', 'reviewer'], ['agent:fx-scribe', 'scribe']]);
    assert.equal(tprGroup.members.length, 4, 'members are the agents authorised-by the group role, the analyst included');
    assert.deepEqual(rolesFor(groups)['fx-scribe'], { actor: 'agent:fx-scribe', roleId: 'fx-role', agentId: FX.scribe, logId: 'c-fx', context: 'WG Fixture' });
  });
  test.todo('handbook stage 10: a group is related to its epic by a relation (no relation type fits an epic and a role; clerk charter names the epic in the role text)');
  test('a group has its own decision log and a duty to report back, both read from its charter', () => {
    assert.deepEqual([tprGroup.logId, fxGroup.logId], ['c-tpr', 'c-fx']); // each group's own log, found by the group's title
    assert.ok(fxGroup.cycleClose && fxGroup.maxUnacked, 'the cycle close and the pause limit are the duty, per group');
    assert.throws(() => groupsFrom(roles, agents, authorisedBy, []), /has no container/);
  });
});

// ---- 11. Assignment and claim ----
describe('stage 11: assignment and claim', () => {
  test('an assigned issue, or one with an open PR, is held, not queued', () => {
    const claimed = { ...issue, number: 12, assignees: [{ login: BUILDER }] };
    const pr = { repo: 'fixture', number: 50, title: 'Closes #10', body: '', head: { ref: '10-change-view' } };
    const q = classify([claimed, issue], [pr]);
    assert.deepEqual(q.queued, []);
    assert.deepEqual(q.held.map((h) => h.held[0]).sort(), [`assigned ${BUILDER}`, 'open PR fixture#50'].sort());
  });
  test('an issue with open blockers (the board mirrors them as `blocked`) is held, not queued', () => {
    const blocked = { ...issue, number: 13, labels: [...issue.labels, { name: 'blocked' }] };
    const q = classify([blocked], []);
    assert.deepEqual(q.queued, []);
    assert.deepEqual(q.held[0].held, ['blocked']);
  });
  test('a clerk command claims an issue: refuses unless free, grounded and the actor holds the seat (clerk claim)', () => {
    assert.equal(checkClaim({ issue: { ...issue, state: 'open' }, groups, affirmed: new Set(['SP-901']), actor: 'agent:fx-builder', seat: 'builder' }).ok, true);
    assert.equal(checkClaim({ issue: { ...issue, state: 'open' }, groups, affirmed: new Set(['SP-901']), branches: ['10-x'], actor: 'agent:fx-builder', seat: 'builder' }).ok, false);
  });
});

describe('stage 11: the central group claims work outside any working group', () => {
  const ca = { instanceId: 'ca', record: { fieldValues: { title: 'c', brief: 'b', actor_id: 'agent:central-builder', seat: 'builder' } } };
  const central = centralGroupFrom(roles.find((r) => r.instanceId === 'owner-role'), [...agents, ca], [...authorisedBy, { sourceId: 'ca', targetId: 'owner-role' }], 'SemanticOps');
  const open = { ...issue, state: 'open', labels: [{ name: 'ready' }] };
  const c = (o) => checkClaim({ issue: open, groups, central, affirmed: new Set(['SP-901']), ...o });
  test('an unlabelled issue is claimable by the owner and by a central-group agent, under "SemanticOps"', () => {
    assert.deepEqual(central.members.map((m) => m.actor), ['agent:central-builder']);
    const o = c({ actor: 'human:owner', seat: 'builder', ownerActor: 'human:owner' });
    assert.equal(o.ok, true); assert.equal(o.group.title, 'SemanticOps');
    assert.equal(c({ actor: 'agent:central-builder', seat: 'builder' }).ok, true);
  });
  test('a non-member cannot claim via the central group, nor can any central actor claim a delegated group\'s issue', () => {
    assert.equal(c({ actor: 'agent:fx-builder', seat: 'builder' }).ok, false);
    const labelled = c({ issue: { ...open, labels: [{ name: 'wg:fixture' }] }, actor: 'agent:central-builder', seat: 'builder', ownerActor: 'human:owner' });
    assert.equal(labelled.ok, false); assert.equal(labelled.group.title, 'WG Fixture');
    assert.equal(c({ issue: { ...open, labels: [{ name: 'wg:unknown' }] }, actor: 'human:owner', seat: 'builder', ownerActor: 'human:owner' }).ok, false);
  });
});

// ---- 12. Execution ----
describe('stage 12: execution', () => {
  test.todo('handbook stage 12: one issue per session in a fresh worktree, gates judged by exit code (briefs and scripts/wt only; no pure function to assert)');
});

// ---- 13. Review and merge ----
describe('stage 13: review and merge', () => {
  const upkeep = fileURLToPath(new URL('../scripts/pr-upkeep.sh', import.meta.url));
  const groupEnv = (g) => ({ ...process.env, WG_LABEL: g.label, WG_BUDGET: String(g.budget), WG_CYCLE_CLOSE: g.cycleClose, WG_MAX_UNACKED: String(g.maxUnacked) });
  const verdict = (builder, reviewer, verdictWord, commentAt, merged) => {
    const body = `<!-- wg-quorum --> builder=${builder} reviewer=${reviewer} gates=green@abc mandate=fixture#10 verdict=${verdictWord}`;
    const comments = JSON.stringify([{ body, created_at: commentAt, author_association: 'OWNER' }]);
    const r = spawnSync('bash', ['-c', `OWNER=o WG_REPORT_ISSUE=o/r/issues/1; source "${upkeep}"; wg_verdict 1 "$1" 2026-10-11T10:00:00Z ${merged}`, '_', comments], { encoding: 'utf8', env: groupEnv(tprGroup) });
    return r.stdout.trim();
  };
  test('a different reviewer approving after the last commit, within budget, is a quorum', () => assert.equal(verdict(BUILDER, REVIEWER, 'approve', '2026-10-11T11:00:00Z', 3), 'ok'));
  test('the builder cannot review their own PR', () => assert.match(verdict(BUILDER, BUILDER, 'approve', '2026-10-11T11:00:00Z', 3), /same actor/));
  test('a stale quorum comment, a rejection, or an exhausted budget each block the merge', () => {
    assert.match(verdict(BUILDER, REVIEWER, 'approve', '2026-10-11T09:00:00Z', 3), /older than the last commit/);
    assert.match(verdict(BUILDER, REVIEWER, 'reject', '2026-10-11T11:00:00Z', 3), /verdict reject/);
    assert.match(verdict(BUILDER, REVIEWER, 'approve', '2026-10-11T11:00:00Z', 10), /over budget/);
  });
  test.todo('handbook stage 13 / principle 6: the reviewer\'s quorum makes a group session in which the decision is ratified (wg-reviewer.md moves a decision to ratified directly)');
  test('pr-upkeep acts on the charter it is given: WG Fixture\'s label, budget, cycle close and pause limit', () => {
    const sh = (script) => spawnSync('bash', ['-c', `OWNER=o WG_REPORT_ISSUE=o/r/issues/1; source "${upkeep}"; ${script}`], { encoding: 'utf8', env: groupEnv(fxGroup) }).stdout.trim();
    assert.match(sh('wg_budget_query 2026-10-09T16:00:00Z'), /label:"wg:fixture" .*merged:>=2026-10-09T16:00:00Z/);
    assert.equal(sh('wg_cycle_start 2026-10-09T15:00:00Z'), '2026-10-08T16:00:00Z'); // closes at 16:00, not 11:30
    assert.equal(sh('wg_cycle_start 2026-10-09T17:00:00Z'), '2026-10-09T16:00:00Z');
    const q = JSON.stringify([{ body: `<!-- wg-quorum --> builder=${BUILDER} reviewer=${REVIEWER} gates=green@abc mandate=fixture#10 verdict=approve`, created_at: '2026-10-11T11:00:00Z', author_association: 'OWNER' }]);
    assert.equal(sh(`wg_verdict 1 '${q}' 2026-10-11T10:00:00Z 3`), 'ok');
    assert.match(sh(`wg_verdict 1 '${q}' 2026-10-11T10:00:00Z 4`), /over budget \(4 of 4 merged this cycle\)/); // WG Fixture's budget is 4, not 10
    const rep = (n) => `{"id":${n},"body":"<!-- wg-report cycle=2026-10-0${n} -->","created_at":"2026-10-0${n}T16:00:00Z","author_association":"OWNER"}`;
    assert.equal(sh(`wg_reactions() { echo '[]'; }; wg_paused '[${rep(6)},${rep(7)}]'`), 'ok'); // limit 3: two unacknowledged reports do not pause
    assert.match(sh(`wg_reactions() { echo '[]'; }; wg_paused '[${rep(6)},${rep(7)},${rep(8)}]'`), /paused: 3 reports unacknowledged/);
  });
  test('the queue lanes are the chartered groups\' labels', () => {
    const lanes = lanesFrom(groups);
    assert.deepEqual(Object.keys(lanes), ['lane:unattended', 'wg:third-party-ready', 'wg:fixture']);
    assert.deepEqual(classify([issue], [], lanes).queued[0].lanes, ['wg']); // issue carries wg:fixture
  });
});

// ---- 14. Report, session and ratification ----
describe('stage 14: report, session and ratification', () => {
  const OWNER_ROLE = { ...ROLES.owner, roleId: 'owner-role', logId: 'L' };
  const decision = { instanceId: 'dec-1', title: 'Adopt the change view', record: { lifecycleState: 'proposed', createdBy: { id: 'agent:fx-steward' }, fieldValues: { title: 'Adopt the change view' } } };
  const runReport = { instanceId: 'rr-1', record: { fieldValues: { title: 'Run 2026-10-11', run_date: '2026-10-11', chose: '3. Done: 1 PR\nWhat we learned: reports are short' } } };
  const group = { memberInstanceIds: [{ instanceId: 'dec-1' }] };

  test('the agenda runs decisions since last, reports, exercises, decisions, merges, in that order', () => {
    const out = A.agendaLines({ ratify: [1], reports: [1], exercises: [], decide: [], merge: [], status: [] }).join('\n');
    const at = ['Decisions since the last session', 'Reports from working groups', 'Exercises', 'Decisions for this session', 'Merges'].map((s) => out.indexOf(s));
    assert.deepEqual(at, [...at].sort((a, b) => a - b));
    assert.ok(at.every((i) => i >= 0));
  });
  test('a run-report is received by the session, needs no quorum, and then leaves the agenda', () => {
    assert.equal(A.reportItems([runReport], new Set(), [], new Set(), 'WG Fixture').length, 1);
    const ch = [];
    take(ch, { instanceId: 'rr-1', title: 'WG Fixture report 2026-10-11' }, { action: 'receive', report: true });
    assertQuorum(ch, { met: false, needs: 'x' });
    assert.equal(A.reportItems([runReport], new Set(['rr-1']), [], new Set(), 'WG Fixture').length, 0);
  });
  test('a session ratifies a proposed decision exactly once, at its own level and with that level\'s quorum', () => {
    assert.deepEqual(A.ratifyItems([decision], group).map((r) => r.instanceId), ['dec-1']);
    const ch = [];
    take(ch, { instanceId: 'dec-1', title: decision.title }, { action: 'ratify' });
    take(ch, { instanceId: 'dec-1', title: decision.title }, { action: 'ratify' }); // asking twice is still one act
    assert.equal(ch.length, 1);
    assert.match(summarise(ch, 'S'), /- Ratified: Adopt the change view \[dec-1\]/);
    assert.throws(() => assertQuorum(ch, quorum(OWNER_ROLE, [{ id: 'someone' }])), /quorum not met \(needs the Owner role\)/);
    const q = quorum(OWNER_ROLE, [{ id: 'owner-role' }]);
    assertQuorum(ch, q);
    const out = [];
    endSession({ role: OWNER_ROLE, choices: ch, attendees: [{ id: 'owner-role', name: 'Owner' }], quorum: q, dryRun: true, log: (m) => out.push(m) });
    assert.match(out[0], /ONE session record in the SemanticOps log/);
    assert.match(out[0], /Ratified: Adopt the change view/);
    assert.deepEqual(A.ratifyItems([{ ...decision, record: { ...decision.record, lifecycleState: 'ratified' } }], group), []); // once ratified it is off the agenda
  });
  test('an exercise yields a proposal, not a ratification, and needs no quorum', () => {
    const ch = [];
    take(ch, { instanceId: 'ex-1', title: 'Looking ahead', exercise: true }, { proposal: { question: 'Should we X?', resolution: 'Yes' } });
    assertQuorum(ch, { met: false, needs: 'x' });
    assert.match(summarise(ch, 'S'), /Exercise: Looking ahead: proposal drafted/);
  });
  test.todo('handbook stage 14: endSession records considers, comments and proposals for an exercise (it returns early today: a known bug)');
  test('a group-level session\'s quorum is read from the group\'s charter', () => {
    const role = rolesFor(groups)['fx-steward'], at = (...ids) => ids.map((id) => ({ id }));
    assert.equal(quorum(role, at(FX.steward, FX.builder), groups).needs, 'three distinct group members');
    assert.equal(quorum(role, at(FX.builder, FX.reviewer, FX.scribe), groups).needs, 'the steward agent'); // WG Fixture requires the steward, not the reviewer
    assert.equal(quorum(role, at(FX.steward, FX.builder, FX.scribe), groups).met, true); // the scribe counts in this group
    assert.equal(quorum(rolesFor(groups)['tpr-reviewer'], at('7f34b620', '6e255308'), groups).met, true); // the other group keeps its own rule
  });
  test.todo('handbook stage 14: the pause rule reads `receives`, not the owner\'s thumbs-up on #31');
});

// ---- 15. Measurement and retrospective ----
describe('stage 15: measurement and retrospective', () => {
  test('routine drift is checkable now (a routine without a record, a missing brief)', () => {
    const d = checkRoutines({ triggers: [{ id: 't1', name: 'X', enabled: true, cron_expression: '0 0 * * *', prompt: 'Read routines/x.md in the-greenman/clerk' }], jobs: [], briefs: new Set(['routines/x.md']) });
    assert.deepEqual(d.map((x) => x.kind), ['trigger-without-record']);
  });
  test('I1 is computed by clerk ground: share of merged PRs grounded to an affirmed problem, and with persona and domain', () => {
    const problems = { 'SP-1': { affirmed: true, persona: 'affirmed', domain: 'affirmed' }, 'SP-2': { affirmed: true, persona: null, domain: null } };
    const is = (body) => ({ ref: 'f#1', body, comments: [], labels: [], parents: [] });
    const rs = [null, is('x'), is('Answers: SP-2'), is('Answers: SP-1')].map((issue) => groundPR({ pr: { labels: [] }, issue, problems }));
    const s = i1(rs);
    assert.deepEqual([s.total, s.grounded, s.full], [4, 2, 1]);
  });
  test.todo('handbook stage 15, I2: delegated merges against budget, plus ready count at cycle close, are computed');
  test.todo('handbook stage 15, I3: days from proposed to ratified (median), and reports awaiting acknowledgement, are computed');
  test.todo('handbook stage 15, I4: reopened issues, false closes and reverted PRs this cycle are computed');
  test.todo('handbook stage 15: when revisit_when falls due, the steward lists the due review clauses and remedy falsifiers on the agenda');
  test.todo('handbook stage 15: a period closes with a retrospective decision keeping, changing or dropping each indicator and practice');
});
