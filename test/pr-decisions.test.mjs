import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDecisions, checkDecisions, askOptions, answersFrom, signComment, classifyComment, asksOwner, ownerQuestion, appliedDecisions, ownerHasWork } from '../lib/practice/pr-decisions.mjs';

const block = (o) => `Answers: SP-12\n\n\`\`\`srs-decisions\n${JSON.stringify(o)}\n\`\`\`\n`;

test('the block and the Answers: line both count', () => {
  const d = parseDecisions(block({ by: 'agent:x', answers: ['SP-91'], made: [{ id: '3c8b94d1' }, { title: 'name it' }] }));
  assert.deepEqual(d.answers, ['SP-91', 'SP-12']);
  assert.deepEqual(d.made.map((m) => m.class), ['ruling', 'choice'], 'an id makes a ruling, none a choice');
});

test('decision prose with no block is an error', () => {
  const body = 'We decided to keep the old flag.';
  assert.equal(checkDecisions(parseDecisions(body), { body })[0].level, 'error');
  assert.equal(checkDecisions(parseDecisions('Fixes a typo.'), { body: 'Fixes a typo.' })[0].level, 'info');
});

test('decision records in the diff need a block', () => {
  assert.match(checkDecisions(parseDecisions(''), { recordsInDiff: 1 })[0].text, /records 1 decision/);
});

test('a ruling needs a record; a broken block is reported', () => {
  assert.match(checkDecisions(parseDecisions(block({ by: 'a', made: [{ class: 'ruling', title: 'r' }] })))[0].text, /no decision record id/);
  assert.match(checkDecisions(parseDecisions('```srs-decisions\n{bad\n```'))[0].text, /does not parse/);
});

test('a merge-blocking ask must be answered before merge', () => {
  const d = parseDecisions(block({ by: 'a', asks: [{ key: 'A1', question: 'q', tension: '3-9', options: ['Do x: x happens', 'Do nothing: y stays'], recommend: 'Do x', blocks: 'merge' }] }));
  assert.equal(checkDecisions(d)[0].level, 'ok');
  assert.ok(checkDecisions(d, { merging: true }).some((f) => f.level === 'error'));
  const answered = answersFrom(['<!-- srs:answer ask=A1 choice="x" -->\n**Decision A1:** x']);
  assert.equal(checkDecisions(d, { merging: true, answered })[0].level, 'ok');
});

const ask = (a) => checkDecisions(parseDecisions(block({ by: 'a', asks: [{ key: 'A1', question: 'q', ...a }] })));

test('an option is a course of action, never a disposition', () => {
  const f = ask({ options: ['Ratify', 'Set aside', 'Hold'], recommend: 'Ratify', tension: 't' });
  assert.equal(f.filter((x) => x.level === 'error' && /disposition/.test(x.text)).length, 3);
  assert.ok(ask({ options: ['Accept option A: do x', 'Shelve', 'Deny'], recommend: 'Accept option A' }).some((x) => /"Accept option A" is a disposition/.test(x.text)));
  assert.ok(!ask({ options: ['No change: y stays', 'Do x: x'], recommend: 'Do x', tension: 't' }).some((x) => x.level === 'error'), '"No change" is a status quo, not a "no"');
});

test('an ask offers two or more options, a status quo, and says where each leads', () => {
  assert.ok(ask({ options: ['Do x: x'], recommend: 'Do x', tension: 't' }).some((x) => x.level === 'error' && /at least two/.test(x.text)));
  assert.ok(ask({ options: [], tension: 't' }).some((x) => /offers 0/.test(x.text)));
  const w = ask({ options: ['Do x', { action: 'Do y', leads_to: 'y' }], recommend: 'Do z' }).map((x) => x.text);
  assert.ok(w.some((t) => /no status-quo/.test(t)));
  assert.ok(w.some((t) => /"Do x" does not say what it leads to/.test(t)));
  assert.ok(w.some((t) => /no tension and no why_unplaced/.test(t)));
  assert.ok(w.some((t) => /none of its options/.test(t)));
  const ok = ask({ why_unplaced: 'no compass for this domain yet', options: [{ action: 'Do x', leads_to: 'x', pole: 'p' }, { action: 'Do nothing', leads_to: 'y stays' }], recommend: 'Do x' });
  assert.equal(ok[0].level, 'ok');
});

test('a choice on the group\'s axes names its lean', () => {
  const d = parseDecisions(block({ by: 'a', made: [{ class: 'choice', title: 't' }] }));
  assert.equal(checkDecisions(d, { groupHasLean: true })[0].level, 'warn');
});

test('signing keeps the first line free and is idempotent', () => {
  const q = '<!-- wg-quorum --> builder=a reviewer=b gates=green@x mandate=m verdict=approve';
  const s = signComment(q, 'agent:tpr-reviewer');
  assert.ok(s.startsWith('<!-- wg-quorum -->'));
  assert.match(s, /<!-- actor: agent:tpr-reviewer -->$/);
  assert.equal(signComment(s, 'agent:tpr-reviewer'), s);
  assert.equal(signComment('hi', null), 'hi');
});

test('the clerk\'s loose signals are read, block or not', () => {
  const d = parseDecisions('Mode: clear · Door: 1 · owner-merge\nDecision asked: keep the flag?\nBuilder: agent:tpr-builder\nRuling: 3c8b94d1\n');
  assert.deepEqual([d.legacy.mode, d.legacy.door, d.legacy.asked, d.legacy.builder, d.legacy.ruling], ['clear', '1', 'keep the flag?', 'agent:tpr-builder', '3c8b94d1']);
  assert.equal(parseDecisions('Mode: clear · Door 2').legacy.door, '2', 'with or without the colon');
});

test('who speaks: markers first, then a signature, then the account', () => {
  const q = classifyComment({ body: '<!-- wg-quorum --> builder=agent:a reviewer=agent:b gates=green@abc mandate=x verdict=approve' });
  assert.deepEqual([q.kind, q.actor, q.builder, q.verdict], ['quorum', 'agent:b', 'agent:a', 'approve']);
  assert.equal(classifyComment({ body: '<!-- srs:answer ask=A1 choice="Do x" -->\n**Decision A1:** Do x' }).choice, 'Do x');
  assert.equal(classifyComment({ body: '<!-- srs:review-request seat=reviewer stance=challenger -->' }).stance, 'challenger');
  assert.equal(classifyComment({ body: '<!-- actor: agent:tpr-builder -->\nDone', assoc: 'OWNER' }).actor, 'agent:tpr-builder');
  assert.equal(classifyComment({ body: 'Claimed by agent:tpr-builder' }).kind, 'agent');
  assert.equal(classifyComment({ body: 'lgtm', user: 'dependabot', userType: 'Bot' }).kind, 'bot');
  assert.equal(classifyComment({ body: 'looks good', user: 'someone' }).kind, 'human');
  assert.equal(classifyComment({ body: 'looks good', user: 'owner', assoc: 'OWNER' }).kind, 'unsigned', 'the owner\'s token does not say who wrote it');
});

test('a decision id named only in the prose is reported, not failed', () => {
  const body = `Executes 3c8b94d1 and 9ee14517.\n${block({ by: 'a', made: [{ id: '3c8b94d1' }] })}`;
  const f = checkDecisions(parseDecisions(body), { body });
  assert.ok(f.some((x) => x.level === 'info' && /9ee14517/.test(x.text) && !/3c8b94d1/.test(x.text)));
  assert.ok(f.some((x) => x.level === 'ok'), 'an info finding does not stop the block being ok');
});

test('askOptions reads both option forms into one shape and marks the recommendation', () => {
  const opts = askOptions({ recommend: 'Make them settings', options: [
    'Do nothing: stalled claims surface as today',
    { action: 'Make them settings', leads_to: 'each group sets its own rhythm', pole: 'fast' }] });
  assert.deepEqual(opts, [
    { action: 'Do nothing', leadsTo: 'stalled claims surface as today', recommended: false },
    { action: 'Make them settings', leadsTo: 'each group sets its own rhythm', pole: 'fast', recommended: true }]);
  assert.deepEqual(askOptions({}), []);
});

test('an owner-merge PR must ask the owner something, and every PR carries a gate (clerk#165)', () => {
  const G = { auto: 'gate:auto-merge', owner: 'gate:owner-merge' };
  const ask = '```srs-decisions\n{"by":"agent:a","asks":[{"key":"A1","question":"Which?","options":["Do it: x","Do nothing: y"],"recommend":"Do it"}]}\n```';
  const errs = (body, labels) => checkDecisions(parseDecisions(body), { body, labels, gates: G }).filter((f) => f.level === 'error').map((f) => f.text);
  assert.equal(asksOwner(parseDecisions(ask)), true);
  assert.equal(asksOwner(parseDecisions('Decision asked: merge after #157.')), true, 'the T9 line counts');
  assert.equal(asksOwner(parseDecisions('Decision asked: none to merge.')), false);
  assert.equal(asksOwner(parseDecisions('```srs-decisions\n{"asks":[]}\n```')), false);
  assert.equal(asksOwner(parseDecisions('**Decision asked:** **none**')), false);
  assert.equal(asksOwner(parseDecisions('Decision asked: <one sentence: the question>')), false, 'an unfilled template asks nothing');
  assert.equal(asksOwner(parseDecisions('Decision asked:\nUnblocks: x')), false, 'an empty line does not borrow the next one');
  assert.equal(asksOwner(parseDecisions('We noted the decision asked: in passing')), false, 'only a line that starts with it');
  assert.deepEqual(errs('plain body', [{ name: 'gate:owner-merge' }]).length, 1, 'labels as {name} objects');
  assert.deepEqual(checkDecisions(parseDecisions('plain'), { body: 'plain', labels: [], gates: G, draft: true }).map((f) => f.level), ['info'], 'a draft is not classified yet');
  assert.match(errs('plain body', ['gate:owner-merge']).join(), /asks the owner nothing/);
  assert.deepEqual(errs(ask, ['gate:owner-merge']), []);
  assert.doesNotMatch(errs('Decision asked: pick one.', ['gate:owner-merge']).join(), /asks the owner nothing/, 'the T9 line is a question (its own block rule still applies)');
  assert.match(errs('plain body', []).join(), /no gate label and no working-group label/);
  assert.deepEqual(errs('plain body', ['wg:x']), [], 'a group PR gets its gate from its reviewer');
  assert.deepEqual(errs('plain body', ['gate:auto-merge']), []);
  assert.deepEqual(checkDecisions(parseDecisions('plain body'), { body: 'plain body' }).map((f) => f.level), ['info'], 'without labels the gate is not checked');
});

test('ownerQuestion: the block is authoritative, and a T9 line that says nothing asks nothing', () => {
  const q = (b) => ownerQuestion(parseDecisions(b));
  assert.equal(q('```srs-decisions\n{"asks":[{"question":"Which way?"}]}\n```\nDecision asked: none to merge.'), 'Which way?', 'the block question, not the none line');
  assert.equal(q('```srs-decisions\n{"asks":[]}\n```\nDecision asked: merge after #157'), null, 'a block with no ask asks nothing');
  assert.equal(q('**Decision asked:** pick one.'), 'pick one');
  for (const b of ['n/a', 'nothing, just merge', 'no decision', '-', '—', 'None.']) assert.equal(q(`Decision asked: ${b}`), null, b);
  assert.equal(q('Decision asked: now or later?'), 'now or later?', '"no" only as a word');
});

test('only a chartered group label gates a PR, as upkeep routes it', () => {
  const G = { auto: 'gate:auto-merge', owner: 'gate:owner-merge' };
  const errs = (labels) => checkDecisions(parseDecisions('plain'), { body: 'plain', labels, gates: G, groupLabels: ['wg:spec'] }).filter((f) => f.level === 'error').map((f) => f.text);
  assert.deepEqual(errs(['wg:spec']), []);
  assert.match(errs(['wg:old-group']).join(), /no chartered working-group label \(wg:old-group is no chartered group's\)/);
});

test('a decision already taken is cited, never asked again: an owner merge that applies one passes the gate', () => {
  const G = { auto: 'gate:auto-merge', owner: 'gate:owner-merge' };
  const cites = '```srs-decisions\n{"by":"agent:a","made":[{"class":"ruling","id":"e745e9b2","title":"reach"}]}\n```';
  const d = parseDecisions(cites);
  assert.deepEqual(appliedDecisions(d), ['e745e9b2']);
  assert.equal(asksOwner(d), false);
  assert.equal(ownerHasWork(d), true);
  assert.deepEqual(checkDecisions(d, { body: cites, labels: ['gate:owner-merge'], gates: G }).filter((f) => f.level === 'error'), []);
  const reask = '```srs-decisions\n{"made":[{"class":"ruling","id":"e745e9b2","title":"reach"}],"asks":[{"key":"A1","id":"e745e9b2","question":"Is reach enough?","options":["Keep: x","Do nothing: y"]}]}\n```';
  assert.match(checkDecisions(parseDecisions(reask), { body: reask }).map((f) => f.text).join(), /asks again a decision the PR says it applies/);
});
