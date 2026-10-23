import test from 'node:test';
import assert from 'node:assert/strict';
import { policyFrom, checkPolicy, evaluate, itemFacts, problemFacts, technicalPlanOf, planStepsOf, parseClause, explain, NS, SIGNALS, REL, problemDomains, careNote } from '../lib/practice/care-policy.mjs';

// A fixture policy in the shape of the seeded one: three axes, three modes, five rules.
const vocabularies = [{ namespace: NS, name: 'confidence_level', terms: ['none', 'low', 'medium', 'high'].map((key) => ({ key })) }];
const rec = (instanceId, typeName, fieldValues, extra = {}) => ({ instanceId, record: { typeName, fieldValues, ...extra } });
const rel = (k, sourceId, targetId) => ({ relationType: `${NS}/${k}`, sourceId, targetId });
function fixture({ rules: ruleOver, grades: gradeOver } = {}) {
  const records = [
    rec('ax-p', 'confidence-axis', { policy_title: 'Placement', policy_key: 'placement', policy_explanation: 'Is the theory grounded?', policy_order: 1 }),
    rec('ax-m', 'confidence-axis', { policy_title: 'Mandate', policy_key: 'mandate', policy_explanation: 'Is it planned?', policy_order: 2 }),
    rec('ax-t', 'confidence-axis', { policy_title: 'Technical plan', policy_key: 'technical_plan', policy_explanation: 'Is the how concrete?', policy_order: 3 }),
    rec('mo-b', 'care-mode', { policy_title: 'Build', policy_key: 'build', policy_explanation: 'Normal gates.', merge_gate: 'auto-merge' }),
    rec('mo-c', 'care-mode', { policy_title: 'Careful', policy_key: 'careful', policy_explanation: 'Smallest slice.', care_must: ['assumptions block', 'gate:owner-merge'], merge_gate: 'owner-merge' }),
    rec('mo-p', 'care-mode', { policy_title: 'Probe', policy_key: 'probe', policy_explanation: 'Find out first.', merge_gate: 'owner-merge' }),
  ];
  const relations = [];
  const grades = gradeOver ?? [
    ['ax-p', 'high', ['problem.affirmed']], ['ax-p', 'medium', ['problem.suggested.conversation']], ['ax-p', 'low', ['problem.suggested.synthesised', 'answers.none-yet']],
    ['ax-m', 'high', ['ruling.names-fix']], ['ax-m', 'medium', ['epic.ranked']], ['ax-m', 'low', ['epic.any']],
    ['ax-t', 'high', ['plan.section']], ['ax-t', 'medium', ['owner.directed', 'plan.steps']],
  ];
  grades.forEach(([axis, level, signal_keys], i) => { records.push(rec(`gr-${i}`, 'confidence-grade', { policy_title: `${axis} ${level}`, confidence_level: level, policy_explanation: '.', signal_keys })); relations.push(rel('grades', `gr-${i}`, axis)); });
  const rules = ruleOver ?? [
    [1, ['technical_plan>=high'], ['placement>=medium', 'signal:owner.directed'], 'mo-b'],
    [2, ['placement>=high', 'mandate>=high'], [], 'mo-b'],
    [3, ['technical_plan>=high'], [], 'mo-c'],
    [4, ['placement>=medium', 'mandate>=medium'], [], 'mo-c'],
    [5, [], [], 'mo-p'],
  ];
  rules.forEach(([order, rule_all_of, rule_any_of, mode]) => { records.push(rec(`ru-${order}`, 'care-rule', { policy_title: `rule ${order}`, policy_order: order, rule_all_of, rule_any_of, policy_explanation: '.' })); relations.push(rel('selects', `ru-${order}`, mode)); });
  return policyFrom({ records, relations, vocabularies });
}
const policy = fixture();
const problems = problemFacts([
  rec('p1', 'problem', { problem_id: 'SP-1' }, { createdBy: { kind: 'human', id: 'human:o' } }),
  rec('p2s', 'problem', { problem_id: 'SP-2', source_ref: ['session 2026-10-20 with the owner'] }, { createdBy: { kind: 'ai', id: 'agent:orchestrator' } }),
  rec('p3', 'problem', { problem_id: 'SP-3' }, { createdBy: { kind: 'ai', id: 'agent:synthesiser' } }),
], { affirmed: new Set(['p1']), suggested: new Set(['p2s', 'p3']) });
const PLAN = '## Technical plan\nChange claim.mjs; test in claim.test.mjs.\n';
const run = (body, o = {}) => evaluate(policy, itemFacts({ item: { body, comments: o.comments }, problems, epic: o.epic ?? null, ruling: o.ruling ?? null, actor: o.actor, ownerActor: 'human:o' }));

test('the fixture policy is well formed and ordered', () => {
  assert.deepEqual(checkPolicy(policy), []);
  assert.deepEqual(policy.axes.map((a) => a.key), ['placement', 'mandate', 'technical_plan']);
  assert.deepEqual(policy.rules.map((r) => r.mode), ['build', 'build', 'careful', 'careful', 'probe']);
  assert.deepEqual(policy.axes[0].grades.map((g) => g.level), ['high', 'medium', 'low'], 'grades highest first');
});

test('problem facts: layer and basis pooled per problem_id', () => {
  assert.deepEqual(problems['SP-1'], { layer: 'affirmed', basis: 'conversation', domains: [] });
  assert.deepEqual(problems['SP-2'], { layer: 'suggested', basis: 'conversation', domains: [] }, 'source_ref names a session');
  assert.deepEqual(problems['SP-3'], { layer: 'suggested', basis: 'synthesised', domains: [] });
});

test('placement grades: affirmed high, conversation medium, synthesised or none-yet low, nothing none', () => {
  assert.equal(run('Answers: SP-1').grades.placement, 'high');
  assert.equal(run('Answers: SP-2').grades.placement, 'medium');
  assert.equal(run('Answers: SP-3').grades.placement, 'low');
  assert.equal(run('No affirmed problem yet: claims stall').grades.placement, 'low');
  assert.equal(run('just a request').grades.placement, 'none');
  assert.equal(run('Answers: SP-3, SP-1').grades.placement, 'high', 'the highest earned grade wins');
});

test('no theory never means no work: the fallback is probe', () => {
  const r = run('just a request');
  assert.equal(r.mode.key, 'probe');
  assert.equal(r.rule.order, 5);
});

test('a clear technical plan builds once the theory has a conversation behind it', () => {
  assert.equal(run(`Answers: SP-2\n${PLAN}`).mode.key, 'build');
  assert.equal(run(`Answers: SP-3\n${PLAN}`).mode.key, 'careful', 'synthesiser-only theory: careful, not stopped');
});

test('owner-directed work with a written plan builds before the theory is affirmed', () => {
  const r = run(`Fix the dangling childContainerIds.\n${PLAN}`, { actor: 'human:o' });
  assert.deepEqual([r.grades.technical_plan, r.mode.key, r.rule.order], ['high', 'build', 1]);
  assert.equal(run('Fix it.', { actor: 'agent:synthesiser' }).mode.key, 'probe');
});

test('the owner actor alone never builds: agents run as it too (clerk#157 review B1)', () => {
  const r = run('Fix the dangling childContainerIds.', { actor: 'human:o' });
  assert.deepEqual([r.grades.technical_plan, r.mode.key], ['medium', 'probe']);
});

test('affirmed theory and a ruling that names the fix build without a plan section', () => {
  assert.equal(run('Answers: SP-1', { ruling: { namesFix: true } }).mode.key, 'build');
});

test('a ranked epic with suggested theory is careful (srs-rust#1132 shape)', () => {
  const r = run('Answers: SP-2', { epic: { ranked: true } });
  assert.deepEqual([r.grades.mandate, r.mode.key, r.rule.order], ['medium', 'careful', 4]);
  assert.deepEqual(r.mode.must, ['assumptions block', 'gate:owner-merge']);
});

test('Answers: is read from the body only, as claim reads it', () => {
  assert.equal(run('body', { comments: ['Answers: SP-1'] }).grades.placement, 'none');
  assert.equal(run('Answers: SP-1', { comments: ['body'] }).grades.placement, 'high');
});
test('a conversation basis is an Owner credit or a whole word', () => {
  const basis = (ref) => problemFacts([{ instanceId: 'x', record: { typeName: 'problem', fieldValues: { problem_id: 'SP-9', source_ref: ref } } }])['SP-9'].basis;
  assert.equal(basis('Owner, 2026-10-21'), 'conversation');
  assert.equal(basis('notes from a call with the owner'), 'conversation');
  assert.equal(basis('srs-context:A mounted MCP server keeps the old srs binary until the session restarts'), 'synthesised');
  assert.equal(basis('principles.md (Portability over possession)'), 'synthesised');
  assert.equal(basis('recall of a callback via chatgpt'), 'synthesised');
});

test('tuning is data: moving rule 3 to probe changes the mode, no code', () => {
  const tuned = fixture({ rules: [[1, ['technical_plan>=high'], ['placement>=medium', 'signal:owner.directed'], 'mo-b'], [3, ['technical_plan>=high'], [], 'mo-p'], [5, [], [], 'mo-p']] });
  assert.equal(evaluate(tuned, itemFacts({ item: { body: `Answers: SP-3\n${PLAN}` }, problems })).mode.key, 'probe');
});

test('technical plan section needs content', () => {
  assert.equal(technicalPlanOf(PLAN), true);
  assert.equal(technicalPlanOf('## Technical plan\n\n## Next\nx'), false);
  assert.equal(technicalPlanOf('### technical plan (draft)\n- a\n# Other'), true);
  assert.equal(technicalPlanOf('no plan'), false);
});

test('clauses parse', () => {
  assert.deepEqual(parseClause('technical_plan>=high'), { axis: 'technical_plan', level: 'high' });
  assert.deepEqual(parseClause(' signal:owner.directed '), { signal: 'owner.directed' });
  assert.equal(parseClause('placement > medium'), null);
});

test('checkPolicy refuses a policy the clerk cannot act on', () => {
  const bad = fixture({
    grades: [['ax-p', 'high', ['problem.blessed']], ['ax-p', 'sure', []]],
    rules: [[1, ['placement>=certain', 'scope>=low', 'oops'], [], 'mo-b'], [2, ['signal:moon.phase'], [], 'mo-p']],
  });
  const errs = checkPolicy(bad).join('\n');
  for (const want of ['signal "problem.blessed"', 'level "sure"', 'level "certain"', 'axis "scope"', 'clause "oops"', 'signal "moon.phase"', 'last rule'])
    assert.match(errs, new RegExp(want.replace(/[.()]/g, '\\$&')), want);
});

test('checkPolicy: a rule with no mode and an empty policy', () => {
  const p = fixture();
  p.rules[0] = { ...p.rules[0], modeIds: [], mode: undefined };
  assert.match(checkPolicy(p).join('\n'), /rule "rule 1" needs exactly one selects/);
  assert.match(checkPolicy(policyFrom({})).join('\n'), /no confidence_level scale[\s\S]*no confidence-axis[\s\S]*no care-mode[\s\S]*no care-rule/);
});

test('explain names each grade, its signals, the rule and the obligations', () => {
  const lines = explain(policy, run('Answers: SP-2', { epic: { ranked: true } }));
  assert.deepEqual(lines, [
    'Placement: medium (problem.suggested.conversation)',
    'Mandate: medium (epic.ranked)',
    'Technical plan: none',
    'Mode: Careful (careful), by rule 4: rule 4',
    '  must: assumptions block',
    '  must: gate:owner-merge',
  ]);
});

test('a ruling names the fix only with a Ruling: id and a Fix: line', async () => {
  const { rulingOf, epicOf } = await import('../lib/practice/care-policy.mjs');
  assert.deepEqual(rulingOf(['Ruling: rfc-decision-1a2b3c4d\nFix: drop the id from the parent']), { cited: ['rfc-decision-1a2b3c4d'], namesFix: true });
  assert.equal(rulingOf(['Ruling: decision-1a2b3c4d (wants a fix)']).namesFix, false, 'no Fix: line');
  assert.equal(rulingOf(['Fix: something', 'Ruling: the owner said so']).namesFix, false, 'no record id');
  assert.equal(rulingOf(['Ruling: decision-1a2b3c4d', 'Fix: in another comment']).namesFix, false, 'Ruling: and Fix: in different texts');
  assert.equal(run('Answers: SP-1\nRuling: decision-f799b6bc\nFix: split checkClaim').mode.key, 'build', 'read from the item when not given');
  assert.deepEqual(epicOf([{ refs: ['s#1'], parked: false }, { refs: ['s#2'], parked: true }], ['r#9', 's#2', 's#1']), { ref: 's#2', ranked: false }, 'nearest epic wins');
  assert.equal(epicOf([], ['r#9']), null);
});

test('the signal catalogue: every signal has the means text the rendered policy prints and a test; relations are namespaced', () => {
  for (const [k, s] of Object.entries(SIGNALS)) {
    assert.equal(typeof s.means, 'string', k); assert.ok(s.means.length > 10, k);
    assert.equal(typeof s.test, 'function', k);
  }
  assert.deepEqual(REL, { grades: `${NS}/grades`, selects: `${NS}/selects` });
});

test('a plan in substance: three steps with code references or acceptance criteria, but not the heading', () => {
  const steps = '1. Change `checkClaim` in lib/practice/claim.mjs.\n2. Add a case to test/claim.test.mjs.\n3. Update `docs/tools.md`.\n';
  assert.equal(planStepsOf(steps), true);
  assert.equal(technicalPlanOf(steps), false, 'only the heading is a written plan');
  assert.equal(planStepsOf('- [ ] read it\n- [ ] think\n- [ ] decide\nDone when the owner agrees.'), true, 'acceptance criteria');
  assert.equal(planStepsOf('1. read it\n2. think\n3. decide'), false, 'steps alone are not a plan');
  assert.equal(planStepsOf('Fix `a` and `b` and `c`.'), false, 'code references alone are not a plan');
});

test('a plan in substance never builds ungrounded work, even as the owner actor (clerk#157 review B3)', () => {
  const steps = '1. Change `checkClaim` in lib/practice/claim.mjs.\n2. Add a case to test/claim.test.mjs.\n3. Update `docs/tools.md`.\n';
  const r = run(steps, { actor: 'human:o' });
  assert.equal(r.grades.technical_plan, 'medium');
  assert.notEqual(r.mode.key, 'build');
  assert.equal(run(`Answers: SP-1\n${steps}`).mode.key === 'build', false, 'nor grounded work: Build needs the written plan');
  assert.equal(run('body', { comments: [PLAN], actor: 'human:o' }).grades.technical_plan, 'medium', 'a plan in a comment is not the item\'s plan');
});

test('domain confidence: affirmed problem, suggested problem, group label, repository', () => {
  const rels = [
    { relationType: 'com.semanticops.method/held-by', sourceId: 'pa', targetId: 'pid' },
    { relationType: 'com.semanticops.method/in-domain', sourceId: 'pid', targetId: 'dom' },
  ];
  assert.deepEqual(problemDomains(rels), { pa: ['dom'] });
  const recs = [{ instanceId: 'pa', record: { typeName: 'problem', fieldValues: { problem_id: 'SP-9' } } }];
  const aff = problemFacts(recs, { affirmed: new Set(['pa']) }, problemDomains(rels)), sug = problemFacts(recs, { suggested: new Set(['pa']) }, problemDomains(rels));
  const groups = [{ label: 'wg:a', repos: ['srs', 'srs-web'], domains: ['d1'] }, { label: 'wg:b', repos: ['srs-web'], domains: ['d2'] }, { label: 'wg:c', repos: ['clerk'], domains: [] }];
  const truth = (facts) => Object.keys(SIGNALS).filter((k) => k.startsWith('domain.') && SIGNALS[k].test(facts));
  assert.deepEqual(truth(itemFacts({ item: { body: 'Answers: SP-9' }, problems: aff })), ['domain.affirmed-problem']);
  assert.deepEqual(truth(itemFacts({ item: { body: 'Answers: SP-9' }, problems: sug })), ['domain.suggested-problem']);
  assert.deepEqual(truth(itemFacts({ labels: ['wg:a'], groups })), ['domain.group-label']);
  assert.deepEqual(truth(itemFacts({ repo: 'srs', groups })), ['domain.repo-one-group']);
  assert.deepEqual(truth(itemFacts({ repo: 'srs-web', groups })), ['domain.repo-shared'], 'two groups govern srs-web');
  assert.deepEqual(truth(itemFacts({ repo: 'clerk', labels: ['wg:c'], groups })), [], 'a group that holds no domain places nothing');
});

test('explain drops the labels seed titles carry', () => {
  const r = { grades: {}, because: {}, mode: { title: 'Care mode: Build', key: 'build', must: [] }, rule: { order: 1, title: 'Rule 1: a clear plan builds' } };
  assert.deepEqual(explain({ axes: [] }, r), ['Mode: Build (build), by rule 1: a clear plan builds']);
});

test('careNote: the claim comment names the mode, the rule, the cautions and the obligations', () => {
  const r = run('Fix it.');
  assert.match(careNote(r, ['its body has no "Answers: SP-nn" line']), /^Care mode: probe, by rule 5 \(.*\)\. Cautions: its body has no "Answers: SP-nn" line\./);
  assert.equal(careNote({ mode: null }), 'Care mode: none (the policy selected no mode)');
});
