import test from 'node:test';
import assert from 'node:assert/strict';
import { groupsFrom } from '../lib/practice/groups.mjs';
import { roles, agents, authorisedBy, containers } from './groups.fixture.mjs';

test('a group lists the domains its charter holds (holds-domain), and none without one', () => {
  const [tpr, fx] = groupsFrom(roles, agents, authorisedBy, containers, [{ sourceId: '834b61fd', targetId: 'dom-sr' }]);
  assert.deepEqual(tpr.domains, ['dom-sr']);
  assert.deepEqual(fx.domains, []);
});
