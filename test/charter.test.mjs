// The charter planner: pure. A second group's plan, refusals, quorum validation.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planCharter } from '../lib/practice/charter.mjs';
import { groups } from './groups.fixture.mjs';

const opts = { title: 'WG Editor', epic: 'semanticops.com#29', label: 'wg:editor', repos: ['srs-web', 'srs-rust'], budget: 10, cycleClose: '11:30', quorumSeats: ['builder', 'reviewer', 'steward'], requiredSeat: 'reviewer' };
const ctx = { groups, ownerLogId: 'owner-log', compass: { narrows: 'impl', tensions: ['t1', 't2', 't3'] } };
const plan = (o = {}, c = {}) => planCharter({ ...opts, ...o }, { ...ctx, ...c });
const ofType = (p, t) => p.writes.filter((w) => w.type === t);

describe('clerk charter planner', () => {
  test('plans a second group: log, container, role with charter fields, four articles, a member per seat, charter decision proposed and in both logs', () => {
    const p = plan();
    assert.deepEqual(p.writes.slice(0, 2).map((w) => w.op), ['create', 'container']);
    const role = ofType(p, 'governance/role')[0].fieldValues;
    assert.deepEqual([role.group_label, role.budget_per_cycle, role.cycle_close_utc, role.quorum_required_seat, role.quorum_seats, role.governed_repos, role.status],
      ['wg:editor', 10, '11:30', 'reviewer', ['builder', 'reviewer', 'steward'], ['srs-web', 'srs-rust'], 'proposed']);
    assert.deepEqual(ofType(p, 'governance/article').map((a) => a.fieldValues.title), ['Membership and quorum', 'Cycle and report', 'Budget', 'Reporting and minutes']);
    assert.deepEqual(ofType(p, 'com.mudemocracy.stewardship/agent').map((a) => a.fieldValues.actor_id), ['agent:editor-builder', 'agent:editor-reviewer', 'agent:editor-steward']);
    assert.match(ofType(p, 'com.mudemocracy.stewardship/agent')[0].fieldValues.brief, /local Claude Code sessions act as builders/i);
    assert.deepEqual(p.writes.filter((w) => w.ref === 'charter' && w.op !== 'create').map((w) => [w.op, w.to ?? w.container]), [['transition', 'proposed'], ['member', 'owner-log']]);
    assert.equal(ofType(p, 'governance/decision').length, 1, 'one charter record, listed in the parent log, never a copy');
  });
  test('authorises each member by the role, copies the compass, and leaves delegation to the owner', () => {
    const p = plan();
    assert.equal(p.writes.filter((w) => w.type === 'com.mudemocracy.stewardship/authorised-by').length, 3);
    assert.equal(p.writes.filter((w) => w.type === 'com.mudemocracy.argument/holds-tension').length, 3);
    assert.ok(!p.writes.some((w) => w.type === 'delegates'));
    assert.ok(p.ownerSteps.some((s) => /delegates/.test(s)) && p.ownerSteps.some((s) => /label wg:editor in: srs-web, srs-rust/.test(s)));
  });
  test('the epic is named in the role text (no relation type links an epic to a role)', () => {
    assert.match(ofType(plan(), 'governance/role')[0].fieldValues.authority, /semanticops\.com#29/);
  });
  test('a duplicate label or title is refused', () => {
    assert.throws(() => plan({ label: 'wg:fixture' }), /label wg:fixture already belongs to "WG Fixture"/);
    assert.throws(() => plan({ title: 'wg third-party READY' }), /already exists/);
  });
  test('quorum seats are validated: required seat among them, distinct, quorum-min in range', () => {
    assert.throws(() => plan({ requiredSeat: 'scribe' }), /must be one of the quorum seats/);
    assert.throws(() => plan({ quorumSeats: ['builder', 'builder'], requiredSeat: 'builder' }), /distinct/);
    assert.throws(() => plan({ quorumMin: 4 }), /--quorum-min/);
  });
  test('malformed options are refused and an existing actor id is not reused', () => {
    assert.throws(() => plan({ epic: '29' }), /--epic/);
    assert.throws(() => plan({ cycleClose: '25:00' }), /HH:MM/);
    assert.throws(() => plan({ label: 'editor' }), /--label/);
    assert.throws(() => plan({}, { existingActors: ['agent:editor-builder'] }), /already exists/);
  });
});
