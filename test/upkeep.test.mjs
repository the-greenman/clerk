import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuorum, quorumVerdict, quorumReport, sameChange, budgetVerdict, cycleStart, countMerged, countOpen, pauseReports, pauseState, receivedReportIds, routePR, upkeepPlan, digestBody }
  from '../lib/practice/upkeep.mjs';
const GATES = { auto: 'gate:auto-merge', owner: 'gate:owner-merge' }; // the programme's merge_gate bindings (test/workflow.fixture.json)

const HEAD = '219d484a20b2b4591fd05b1865e92af3b0bebae7';
const q = ({ builder = 'agent:tpr-builder', reviewer = 'agent:tpr-reviewer', gates = 'green', sha = HEAD, verdict = 'approve', at = '2026-10-12T11:00:00Z', assoc = 'OWNER' } = {}) =>
  ({ body: `<!-- wg-quorum --> builder=${builder} reviewer=${reviewer} gates=${gates}@${sha} mandate=srs-rust#1 verdict=${verdict}\nfindings: none`, created_at: at, author_association: assoc });

test('a quorum line parses; anything else is malformed', () => {
  assert.deepEqual(parseQuorum(q().body), { builder: 'agent:tpr-builder', reviewer: 'agent:tpr-reviewer', gates: 'green', sha: HEAD, mandate: 'srs-rust#1', verdict: 'approve' });
  assert.equal(parseQuorum('<!-- wg-quorum --> builder=agent:a reviewer=agent:b gates=green mandate=m verdict=approve'), null, 'gates must name the commit');
  assert.equal(parseQuorum('<!-- wg-quorum --> builder=agent:a reviewer=human:x gates=green@abcdef1 mandate=m verdict=approve'), null, 'the reviewer is an agent seat');
  assert.equal(parseQuorum('<!-- wg-quorum --> builder=robot:a reviewer=agent:b gates=green@abcdef1 mandate=m verdict=approve'), null, 'the builder is an agent or a human');
  assert.equal(parseQuorum('<!-- wg-quorum --> builder=human: reviewer=agent:b gates=green@abcdef1 mandate=m verdict=approve'), null, 'a human builder names a login');
});

test('a human builder (a local /ship session) with an agent reviewer is a quorum (clerk#290)', () => {
  assert.equal(parseQuorum(q({ builder: 'human:the-greenman' }).body).builder, 'human:the-greenman');
  assert.equal(quorumVerdict([q({ builder: 'human:the-greenman', reviewer: 'agent:editor-reviewer' })], HEAD), 'ok');
  assert.equal(quorumVerdict([q({ builder: 'human:the-greenman', verdict: 'reject' })], HEAD), 'verdict reject');
});

test('the latest owner quorum for the head commit decides', () => {
  assert.equal(quorumVerdict([q()], HEAD), 'ok');
  assert.equal(quorumVerdict([q({ sha: HEAD.slice(0, 8) })], HEAD), 'ok', 'a short sha names the head too');
  assert.equal(quorumVerdict([q({ reviewer: 'agent:tpr-builder' })], HEAD), 'builder and reviewer are the same actor');
  assert.equal(quorumVerdict([q({ verdict: 'reject' })], HEAD), 'verdict reject');
  assert.equal(quorumVerdict([{ body: 'lgtm', created_at: 'x', author_association: 'OWNER' }], HEAD), 'no quorum comment');
  assert.equal(quorumVerdict([q({ assoc: 'NONE' })], HEAD), 'no quorum comment', "a stranger's quorum is ignored");
  assert.equal(quorumVerdict([q(), q({ verdict: 'reject', at: '2026-10-12T12:00:00Z' })], HEAD), 'verdict reject', 'the latest wins');
  assert.equal(quorumVerdict([q(), { body: '<!-- wg-quorum --> broken', created_at: '2026-10-13T00:00:00Z', author_association: 'OWNER' }], HEAD), 'quorum comment malformed', 'a later malformed quorum is not skipped');
});

test('clerk#89: a quorum on another commit, or with red gates, never merges', () => {
  // the old rule compared comment time with the committer date: a commit made before the review and pushed after it passed
  assert.match(quorumVerdict([q({ sha: 'aaaaaaaa11111111' })], HEAD), /^quorum is for aaaaaaaa, head is 219d484a/);
  assert.equal(quorumVerdict([q({ gates: 'red' })], HEAD), 'gates red');
  assert.match(quorumVerdict([q()], undefined), /^quorum is for/, 'no head sha read: no merge');
});

const F = (patch, more = {}) => ({ filename: 'a.mjs', status: 'modified', patch, ...more });
const OWN = '@@ -10,3 +10,3 @@ function f\n ctx\n-old\n+new';
test('clerk#235: sameChange reads the PR\'s own lines, not where the base has moved them', () => {
  assert.equal(sameChange([F(OWN)], [F('@@ -90,3 +95,3 @@ function g\n ctx\n-old\n+new')]), true, 'base merged in or a rebase: only the hunk header moved');
  assert.equal(sameChange([F(OWN)], [F('@@ -90,3 +95,3 @@ function g\n other ctx\n-old\n+new')]), false, 'the same lines applied at another site are another change');
  assert.equal(sameChange([F(OWN), F(OWN, { filename: 'b.mjs' })], [F(OWN, { filename: 'b.mjs' }), F(OWN)]), true, 'file order does not matter');
  assert.equal(sameChange([F(OWN)], [F('@@ -10,3 +10,3 @@\n ctx\n-old\n+resolved differently')]), false, 'a conflict resolution changed the diff');
  assert.equal(sameChange([F(OWN)], [F(OWN), F(OWN, { filename: 'b.mjs' })]), false, 'a file added');
  assert.equal(sameChange([F(OWN)], [F(OWN, { status: 'added' })]), false, 'another status');
  assert.equal(sameChange([F(OWN, { status: 'renamed', previous_filename: 'x.mjs' })], [F(OWN, { status: 'renamed', previous_filename: 'y.mjs' })]), false, 'renamed from elsewhere');
  assert.equal(sameChange([F(OWN)], [F(`${OWN}\n\\ No newline at end of file`)]), false, 'the end-of-file newline is part of the change');
});

test('clerk#235: a diff that cannot be read in full is never the same', () => {
  assert.equal(sameChange([F(OWN)], [F(undefined)]), false, 'a file with no patch');
  assert.equal(sameChange([F(undefined)], [F(undefined)]), false, 'binary on both sides');
  assert.equal(sameChange(undefined, [F(OWN)]), false, 'no files read');
  assert.equal(sameChange([], []), false, 'no change to compare');
  const many = Array.from({ length: 300 }, (_, i) => F(OWN, { filename: `f${i}` }));
  assert.equal(sameChange(many, many), false, "at GitHub's 300-file cap the rest may differ");
  assert.equal(sameChange(many.slice(1), many.slice(1)), true, 'just under the cap');
});

test('clerk#235: only carried === true carries a quorum to another head, and only a clean approval', () => {
  const old = 'aaaaaaaa11111111';
  assert.equal(quorumVerdict([q({ sha: old })], HEAD, { carried: true }), 'ok');
  for (const carried of [false, null, undefined, 'yes']) assert.match(quorumVerdict([q({ sha: old })], HEAD, { carried }), /^quorum is for aaaaaaaa/, `carried ${carried}`);
  assert.match(quorumVerdict([q({ sha: old })], undefined, { carried: true }), /^quorum is for/, 'no head read');
  assert.equal(quorumVerdict([q({ sha: old, verdict: 'reject' })], HEAD, { carried: true }), 'verdict reject');
  assert.equal(quorumVerdict([q({ sha: old, gates: 'red' })], HEAD, { carried: true }), 'gates red');
  assert.equal(quorumVerdict([q({ sha: old, reviewer: 'agent:tpr-builder' })], HEAD, { carried: true }), 'builder and reviewer are the same actor');
  assert.equal(quorumVerdict([], HEAD, { carried: true }), 'no quorum comment');
});

test('clerk#235: the report says why, and whether this commit is already judged', () => {
  const old = 'aaaaaaaa11111111';
  assert.deepEqual(quorumReport([q({ sha: old })], HEAD, { carried: true }), { verdict: 'ok', reason: 'quorum carried from aaaaaaaa (own diff unchanged)', carried: true, quorumSha: old, headSha: HEAD, judgedHead: false });
  assert.equal(quorumReport([q()], HEAD).reason, 'quorum for the head 219d484a');
  assert.equal(quorumReport([q()], HEAD).judgedHead, true);
  const rejected = quorumReport([q({ verdict: 'reject' })], HEAD);
  assert.deepEqual([rejected.verdict, rejected.judgedHead], ['verdict reject', true], 'a rejection of this commit stands: the reviewer does not repeat it');
  assert.equal(quorumReport([q({ sha: old, verdict: 'reject' })], HEAD).judgedHead, false, 'a rejection of an older commit does not');
  assert.deepEqual([quorumReport([], HEAD).quorumSha, quorumReport([], HEAD).judgedHead], [null, false]);
});

test('clerk#235: a run keeps a group PR current while its quorum holds, where checks are required, and merges on a carried quorum', () => {
  const old = 'aaaaaaaa11111111', G = () => ({ 'wg:x': { budget: 9, merged: 0, pause: 'ok' } }), labels = ['wg:x', 'gate:auto-merge'];
  const pr = (more = {}) => ({ number: 1, title: 'pr 1', headSha: HEAD, comments: [q({ sha: old })], ...P(labels), ...more });
  const plan = (p, requiredChecks = true) => upkeepPlan([{ repo: 'r', defaultBranch: 'main', requiredChecks, prs: [p] }], G(), GATES);
  assert.equal(routePR(P(labels, 'BEHIND'), { ...ctx, requiredChecks: true }).action, 'update-branch');
  assert.equal(routePR(P(['wg:x'], 'BEHIND'), { ...ctx, requiredChecks: true }).action, 'update-branch', 'not yet reviewed: kept current too');
  assert.equal(routePR(P(labels, 'BEHIND'), ctx).action, null, 'no required checks: unchanged');
  assert.equal(routePR(P(labels, 'CLEAN'), { ...ctx, requiredChecks: true }).action, null);

  const merged = plan(pr({ carried: true }));
  assert.deepEqual(merged.actions.map((a) => [a.do, a.sha, a.why]), [['merge', HEAD, 'group quorum carried (own diff unchanged), 0 of 9 merged this cycle']]);
  assert.equal(merged.merged['wg:x'], 1, 'a carried merge spends budget');
  const updated = plan(pr({ carried: true, state: 'BEHIND' }));
  assert.deepEqual(updated.actions.map((a) => a.do), ['update-branch']);
  assert.deepEqual(plan(pr({ comments: [q()], state: 'BEHIND' })).actions.map((a) => a.do), ['update-branch'], 'a quorum on the head is kept current');
  for (const [what, more] of [['rejected', { comments: [q({ verdict: 'reject' })] }], ['not carried', { carried: false }], ['compare unreadable', { carried: null }], ['comments unreadable', { comments: null }], ['not yet reviewed', { labels: ['wg:x'] }]])
    assert.deepEqual(plan(pr({ state: 'BEHIND', ...more })).actions, [], `${what}: the head stays put, the reviewer updates when it reviews`);
  assert.deepEqual(upkeepPlan([{ repo: 'r', defaultBranch: 'main', requiredChecks: true, prs: [pr({ comments: [q()], state: 'BEHIND' })] }], { 'wg:x': { budget: 0, merged: 0, pause: 'ok' } }, GATES).actions.map((a) => a.do), ['update-branch'], 'over budget: still kept ready');
  assert.deepEqual(updated.waits['wg:x'], ['r#1 pr 1 (quorum ok, waiting for state BEHIND)']);

  for (const carried of [false, null]) {
    const void_ = plan(pr({ carried }));
    assert.deepEqual(void_.actions, [], `carried ${carried}: a changed diff or an unreadable compare never merges`);
    assert.match(void_.waits['wg:x'][0], /quorum is for aaaaaaaa/);
  }
  const unprotected = plan(pr({ carried: true }), false);
  assert.deepEqual(unprotected.actions, [], 'a repo without required checks: void, whatever the read said');
  assert.match(unprotected.waits['wg:x'][0], /quorum is for aaaaaaaa/);
  assert.deepEqual(upkeepPlan([{ repo: 'r', defaultBranch: 'main', requiredChecks: true, prs: [pr({ carried: true })] }], { 'wg:x': { budget: 0, merged: 0, pause: 'ok' } }, GATES).actions, [], 'a carried quorum still needs budget');
  assert.deepEqual(upkeepPlan([{ repo: 'r', defaultBranch: 'main', requiredChecks: true, prs: [pr({ carried: true })] }], { 'wg:x': { budget: 9, merged: 0, pause: 'paused: x' } }, GATES).actions, [], 'and no pause');
});

test('clerk#89: a budget or count that is not a whole number blocks', () => {
  assert.equal(budgetVerdict(3, 10), 'ok');
  assert.equal(budgetVerdict(10, 10), 'over budget (10 of 10 merged this cycle)');
  assert.equal(budgetVerdict(3, undefined), 'no budget in the charter');
  assert.equal(budgetVerdict(3, null), 'no budget in the charter');
  assert.equal(budgetVerdict('unknown', 10), 'merges this cycle unknown');
  assert.equal(budgetVerdict(NaN, 10), 'merges this cycle unknown');
});

test('the cycle starts at the most recent close', () => {
  assert.equal(cycleStart('2026-10-09T10:00:00Z', '11:30'), '2026-10-08T11:30:00Z');
  assert.equal(cycleStart('2026-10-09T12:00:00Z', '11:30'), '2026-10-09T11:30:00Z');
  assert.equal(cycleStart('2026-10-09T11:30:00Z', '11:30'), '2026-10-09T11:30:00Z');
  assert.equal(cycleStart('2026-10-09T15:00:00Z', '16:00'), '2026-10-08T16:00:00Z', 'each group has its own close');
  assert.equal(cycleStart('2026-03-01T01:00:00Z', '11:30'), '2026-02-28T11:30:00Z', 'across a month end');
  assert.throws(() => cycleStart('2026-10-09T12:00:00Z', undefined), /not HH:MM/);
});

test('delegated merges and open PRs are counted; owner merges are not', () => {
  const pr = (merged_at, state, labels) => ({ merged_at, state, labels: labels.map((name) => ({ name })) });
  const L = 'wg:third-party-ready', prs = [pr('2026-10-09T12:00:00Z', 'closed', [L]), pr('2026-10-09T12:00:00Z', 'closed', [L, 'gate:owner-merge']),
    pr('2026-10-09T10:00:00Z', 'closed', [L]), pr(null, 'closed', [L]), pr('2026-10-09T12:00:00Z', 'closed', []), pr(null, 'open', [L])];
  assert.equal(countMerged(prs, L, '2026-10-09T11:30:00Z', GATES), 1);
  assert.equal(countOpen(prs, L, GATES), 1);
  // a bug fix carries its own budget (owner 2026-11-02): never counted against the group
  const own = { ...GATES, own: ['bug'] };
  assert.equal(countOpen([...prs, pr(null, 'open', [L, 'bug'])], L, own), 1);
  assert.equal(countMerged([...prs, pr('2026-10-09T12:00:00Z', 'closed', [L, 'bug'])], L, '2026-10-09T11:30:00Z', own), 1);
});

const rep = (id, group, assoc = 'OWNER') => ({ id, body: `<!-- wg-report cycle=2026-10-0${id}${group ? ` group=${group}` : ''} -->\nreport`, created_at: `2026-10-0${id}T11:30:00Z`, author_association: assoc });
test('a group pauses when its latest reports are all unacknowledged', () => {
  const L = 'wg:third-party-ready', rs = (cs) => pauseReports(cs, L, 2);
  assert.equal(pauseState(rs([rep(7), rep(8)]), new Set(), 2), 'paused: 2 reports unacknowledged');
  assert.equal(pauseState(rs([rep(7), rep(8)]), new Set([7]), 2), 'ok', 'one acknowledged');
  assert.equal(pauseState(rs([rep(8)]), new Set(), 2), 'ok', 'fewer reports than the limit');
  assert.equal(pauseState(rs([rep(7, null, 'NONE'), rep(8, null, 'NONE')]), new Set(), 2), 'ok', "a stranger's reports are ignored");
  assert.equal(pauseState(rs([rep(7, L), rep(8, L)]), new Set(), 2), 'paused: 2 reports unacknowledged', 'own tagged reports');
  assert.equal(pauseState(rs([rep(7, 'wg:agent-editor'), rep(8, 'wg:agent-editor')]), new Set(), 2), 'ok', "another group's reports");
  assert.equal(pauseState(rs([rep(6), rep(7), rep(8, 'wg:agent-editor')]), new Set(), 2), 'paused: 2 reports unacknowledged', "another group's latest is skipped");
  assert.equal(pauseState(rs([rep(7, L), rep(8)]), new Set(), 2), 'paused: 2 reports unacknowledged', 'untagged reports count for every group');
  assert.equal(pauseState(pauseReports([rep(6), rep(7), rep(8)], L, 3), new Set(), 3), 'paused: 3 reports unacknowledged', 'the limit is the charter\'s');
  assert.equal(pauseState(rs([rep(7), rep(8)]), null, 2), 'paused: reports unreadable', 'fail closed');
  assert.equal(pauseState(null, new Set(), 2), 'paused: reports unreadable');
  assert.equal(pauseState([], new Set(), undefined), 'paused: no pause limit in the charter');
});

const run = (id, date) => ({ instanceId: id, record: { fieldValues: { run_date: `${date}T00:00:00Z` } } });
test('a report a session receives acknowledges it with no GitHub reaction (clerk#167)', () => {
  const L = 'wg:third-party-ready', rs = pauseReports([rep(7, L), rep(8, L)], L, 2), runs = [run('r7', '2026-10-07'), run('r8', '2026-10-08')];
  assert.deepEqual([...receivedReportIds(rs, runs, new Set(['r7']), L)], [7]);
  assert.equal(pauseState(rs, receivedReportIds(rs, runs, new Set(['r7']), L), 2), 'ok', 'one received');
  assert.equal(pauseState(rs, receivedReportIds(rs, runs, new Set(), L), 2), 'paused: 2 reports unacknowledged', 'none received');
  const both = new Set([...receivedReportIds(rs, runs, new Set(['r8']), L), 7]);
  assert.equal(pauseState(rs, both, 2), 'ok', 'a receive and a +1 each count');
});
test('a receive does not un-pause what it does not name (clerk#167)', () => {
  const L = 'wg:third-party-ready', runs = [run('r7', '2026-10-07'), run('r8', '2026-10-08')], all = new Set(['r7', 'r8']);
  const untagged = pauseReports([rep(7), rep(8)], L, 2);
  assert.equal(receivedReportIds(untagged, runs, all, L).size, 0, 'an untagged report can pause, never un-pause');
  const other = pauseReports([rep(7, 'wg:agent-editor'), rep(8, 'wg:agent-editor')], 'wg:agent-editor', 2);
  assert.equal(receivedReportIds(other, runs, all, L).size, 0, "another group's comment is not this group's");
  assert.equal(receivedReportIds(pauseReports([rep(7, L)], L, 2), [run('r9', '2026-10-09')], new Set(['r9']), L).size, 0, 'a receive of another cycle');
  const rs = pauseReports([rep(7, L), rep(8, L)], L, 2);
  assert.equal(pauseState(rs, receivedReportIds(rs, [], new Set(['r7', 'r8']), L), 2), 'paused: 2 reports unacknowledged', 'no run-reports read: nothing is credited');
  assert.equal(pauseState(rs, receivedReportIds(rs, runs, new Set(), L), 2), 'paused: 2 reports unacknowledged', 'no receives read: nothing is credited');
});

const ctx = { groupLabels: ['wg:x'], defaultBranch: 'main', gates: GATES };
const P = (labels, state = 'CLEAN', more = {}) => ({ labels, state, base: 'main', draft: false, autoMerge: false, ...more });
test('routing: exact labels; owner merge always wins and never merges', () => {
  assert.equal(routePR(P(['gate:auto-merge']), ctx).action, 'merge');
  assert.equal(routePR(P(['gate:auto-merge'], 'BEHIND'), ctx).action, 'update-branch');
  assert.equal(routePR(P([], 'BEHIND', { autoMerge: true }), ctx).action, 'update-branch', 'GitHub auto-merge on');
  assert.equal(routePR(P(['gate:owner-merge'], 'BEHIND'), ctx).action, 'update-branch');
  assert.equal(routePR(P(['gate:owner-merge']), ctx).action, null);
  assert.equal(routePR(P([]), ctx).ungated, true);
  assert.deepEqual(routePR(P(['wg:x', 'gate:auto-merge']), ctx), { kind: 'group', group: 'wg:x', needsQuorum: true, action: null });
  assert.equal(routePR(P(['wg:x']), ctx).needsQuorum, false);
});

test('clerk#89: owner-merge beside auto-merge, look-alike labels, drafts and other bases never merge', () => {
  assert.deepEqual(routePR(P(['gate:auto-merge', 'gate:owner-merge']), ctx), { kind: 'owner', action: null });
  assert.equal(routePR(P(['wg:x', 'gate:auto-merge', 'gate:owner-merge']), ctx).kind, 'owner');
  assert.equal(routePR(P(['gate:auto-merge-hold']), ctx).action, null, 'no substring match');
  assert.equal(routePR(P(['gate:auto-merge'], 'CLEAN', { draft: true }), ctx).kind, 'skip');
  assert.match(routePR(P(['gate:auto-merge'], 'CLEAN', { base: '85-feature' }), ctx).why, /base 85-feature is not main/);
});

test('a run: group merges need quorum, budget and no pause, and use up budget as they go', () => {
  const pr = (number, labels, more = {}) => ({ number, title: `pr ${number}`, headSha: HEAD, ...P(labels), ...more });
  const groups = { 'wg:x': { budget: 2, merged: 1, pause: 'ok' } };
  const plan = upkeepPlan([{ repo: 'r', defaultBranch: 'main', prs: [
    pr(1, ['wg:x', 'gate:auto-merge'], { comments: [q()] }),
    pr(2, ['wg:x', 'gate:auto-merge'], { comments: [q()] }),               // budget now spent
    pr(3, ['wg:x', 'gate:auto-merge'], { comments: null }),                // unreadable
    pr(4, ['wg:x']),                                                        // not yet reviewed
    pr(5, ['gate:auto-merge', 'gate:owner-merge']),                         // escalated
    pr(6, ['gate:auto-merge']), pr(7, [], { state: 'DIRTY' }),
  ] }], groups, GATES);
  assert.deepEqual(plan.actions.map((a) => [a.do, a.number, a.sha]), [['merge', 1, HEAD], ['merge', 6, HEAD]]);
  assert.deepEqual(plan.waits['wg:x'], ['r#2 pr 2 (over budget (2 of 2 merged this cycle))', 'r#3 pr 3 (could not read comments)', 'r#4 pr 4 (awaiting group review)']);
  assert.deepEqual(plan.conflicts, ['r#7 pr 7']);
  assert.deepEqual(plan.ungated, ['r#7 pr 7']);
  assert.equal(plan.merged['wg:x'], 2);
  assert.equal(groups['wg:x'].merged, 1, 'the input is not changed');

  const paused = upkeepPlan([{ repo: 'r', defaultBranch: 'main', prs: [pr(1, ['wg:x', 'gate:auto-merge'], { comments: [q()] })] }], { 'wg:x': { budget: 9, merged: 0, pause: 'paused: 2 reports unacknowledged' } }, GATES);
  assert.deepEqual(paused.actions, []);
  assert.deepEqual(paused.waits['wg:x'], ['r#1 pr 1 (paused: 2 reports unacknowledged)']);
  const behind = upkeepPlan([{ repo: 'r', defaultBranch: 'main', prs: [pr(1, ['wg:x', 'gate:auto-merge'], { comments: [q()], state: 'BEHIND' })] }], { 'wg:x': { budget: 9, merged: 0, pause: 'ok' } }, GATES);
  assert.deepEqual(behind.waits['wg:x'], ['r#1 pr 1 (quorum ok, waiting for state BEHIND)'], 'a group PR is never updated here');
  assert.match(digestBody(plan, groups, '2026-10-20', GATES), /Working group: running - waiting \(`wg:x`, 2 of 2 merged this cycle\):\n- r#2/);
});

test('clerk#208: in the programme repo every PR merges on green; native auto-merge is armed until it is CLEAN', () => {
  const prog = { ...ctx, programme: true };
  assert.equal(routePR(P([]), prog).action, 'merge', 'no gate label reads as auto');
  assert.equal(routePR(P([]), prog).ungated, false);
  assert.deepEqual(routePR(P([], 'BLOCKED'), prog), { kind: 'ordinary', action: null, ungated: false, arm: true });
  assert.deepEqual(routePR(P(['gate:auto-merge'], 'BEHIND'), prog), { kind: 'ordinary', action: 'update-branch', ungated: false, arm: true });
  assert.equal(routePR(P([], 'BLOCKED', { autoMerge: true }), prog).arm, undefined, 'already armed');
  assert.equal(routePR(P(['gate:auto-merge']), prog).arm, undefined, 'CLEAN merges now');
  assert.deepEqual(routePR(P(['gate:owner-merge'], 'BLOCKED'), prog), { kind: 'owner', action: null }, 'owner merge still wins');
  assert.equal(routePR(P(['wg:x'], 'BLOCKED'), prog).kind, 'group');
  assert.equal(routePR(P([], 'BLOCKED'), ctx).arm, undefined, 'not outside the programme');
  const pr = (number, labels, state) => ({ number, title: `pr ${number}`, headSha: HEAD, ...P(labels, state) });
  const plan = upkeepPlan([{ repo: 'p', defaultBranch: 'main', programme: true, prs: [pr(1, [], 'BEHIND'), pr(2, [], 'CLEAN')] },
    { repo: 'r', defaultBranch: 'main', prs: [pr(3, [], 'BLOCKED')] }], {}, GATES);
  assert.deepEqual(plan.actions.map((a) => [a.do, a.repo, a.number]), [['update-branch', 'p', 1], ['auto-merge', 'p', 1], ['merge', 'p', 2]]);
  assert.deepEqual(plan.ungated, ['r#3 pr 3']);
});

test('clerk#217: an auto PR is armed in any repo that requires checks, never in one that does not', () => {
  const gov = { ...ctx, requiredChecks: true };
  assert.equal(routePR(P(['gate:auto-merge'], 'BLOCKED'), gov).arm, true, 'protected repo: armed');
  assert.equal(routePR(P(['gate:auto-merge'], 'BLOCKED'), ctx).arm, undefined, 'unprotected: never armed, it would merge before CI');
  assert.equal(routePR(P([], 'BLOCKED'), gov).arm, undefined, 'an ungated PR outside the programme is not armed');
  assert.equal(routePR(P(['gate:owner-merge'], 'BLOCKED'), gov).arm, undefined, 'owner merge is never armed');
  const pr = (number, labels, state) => ({ number, title: `pr ${number}`, headSha: HEAD, ...P(labels, state) });
  const plan = upkeepPlan([{ repo: 'c', defaultBranch: 'main', requiredChecks: true, prs: [pr(4, ['gate:auto-merge'], 'BLOCKED')] },
    { repo: 'u', defaultBranch: 'main', prs: [pr(5, ['gate:auto-merge'], 'BLOCKED')] }], {}, GATES);
  assert.deepEqual(plan.actions.map((a) => [a.do, a.repo, a.number, a.why]), [['auto-merge', 'c', 4, 'auto PR, merges when its required checks pass']]);
});

test('upkeep reads its gate labels from the bindings, so a renamed gate still routes and the old name no longer merges', () => {
  const renamed = { ...ctx, gates: { auto: 'merge:auto', owner: 'merge:owner' } };
  const P2 = (labels) => ({ labels, draft: false, base: 'main', state: 'CLEAN', autoMerge: false });
  assert.equal(routePR(P2(['merge:auto']), renamed).action, 'merge');
  assert.equal(routePR(P2(['merge:owner']), renamed).kind, 'owner');
  assert.equal(routePR(P2(['gate:auto-merge']), renamed).action, null, 'an unbound label is not a gate');
});

test('upkeep refuses to route without both gate labels: no merge rule runs on a partial set', () => {
  const P2 = { labels: ['gate:auto-merge', 'gate:owner-merge'], draft: false, base: 'main', state: 'CLEAN', autoMerge: false };
  assert.throws(() => routePR(P2, { ...ctx, gates: { auto: 'gate:auto-merge' } }), /merge-gate labels missing/);
  assert.throws(() => upkeepPlan([{ repo: 'r', defaultBranch: 'main', prs: [P2] }], {}), /merge-gate labels missing/);
});

test('an owner-merge PR that asks nothing is listed back to an agent, never merged (clerk#165)', () => {
  const pr = (number, body) => ({ number, title: `pr ${number}`, headSha: HEAD, body, ...P(['gate:owner-merge']) });
  const plan = upkeepPlan([{ repo: 'r', defaultBranch: 'main', prs: [pr(1, 'plain'), pr(2, 'Decision asked: pick one.')] }], {}, GATES);
  assert.deepEqual(plan.unasked, ['r#1 pr 1']);
  assert.deepEqual(plan.actions, []);
  assert.match(digestBody(plan, {}, '2026-10-23', GATES), /Owner merge that asks the owner nothing .*:\n- r#1 pr 1/);
});

// Every caller must hand groupStates the programme path, or its pause ignores `receives` and disagrees with upkeep (clerk#167: the desk's groupState missed it).
test('every groupStates caller passes the programme path (clerk#167)', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs'), { join } = await import('node:path');
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (n === 'node_modules' ? [] : walk(p)) : /\.mjs$/.test(n) ? [p] : []; });
  const calls = ['lib', 'scripts', 'bin', 'api'].flatMap((d) => { try { return walk(d); } catch { return []; } })
    .flatMap((p) => readFileSync(p, 'utf8').split('\n').filter((l) => /\bgroupStates\(/.test(l) && !/export function|import /.test(l)).map((l) => `${p}: ${l.trim()}`));
  assert.ok(calls.length >= 4, `found the callers (${calls.length})`);
  for (const c of calls) assert.match(c, /undefined, [\w.]*repo\)/, `passes the programme path: ${c}`);
});

test('roomOf: budget - merged - open, 0 when a count is unknown (clerk#147)', async () => {
  const { roomOf } = await import('../lib/practice/upkeep.mjs');
  assert.equal(roomOf({ budget: 10, merged: 6, open: 2 }), 2);
  assert.equal(roomOf({ budget: 10, merged: 'unknown', open: 2 }), 0);
  assert.equal(roomOf(undefined), 0);
});
