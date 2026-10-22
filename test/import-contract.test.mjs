// What srs-lab's control room imports from the clerk, by module and name. A missing export fails here, at test time, not in
// the browser (2026-10-20: the control room broke on classifyComment, which had merged into a stacked branch, not main).
// When srs-lab imports something new from the clerk, add it here.
import test from 'node:test';
import assert from 'node:assert/strict';

const CONTRACT = {
  '../lib/practice/pr-decisions.mjs': ['parseDecisions', 'classifyComment', 'checkDecisions', 'askOptions'],
  '../lib/practice/domain-field.mjs': ['domainField', 'canAffirmTension', 'canPlaceAxes'],
  '../lib/practice/desk.mjs': ['deskBody'],
  '../lib/adapters/desk.mjs': ['gatherDesk'],
  '../lib/adapters/settings.mjs': ['loadSettings'],
};

for (const [mod, names] of Object.entries(CONTRACT))
  test(`${mod.slice(3)} exports what srs-lab imports`, async () => {
    const m = await import(mod);
    for (const n of names) assert.equal(typeof m[n], 'function', `${n} is not exported`);
  });
