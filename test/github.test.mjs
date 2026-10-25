import test from 'node:test';
import assert from 'node:assert/strict';
import { closingRefs } from '../lib/adapters/github.mjs';
import { ghPaged } from '../lib/adapters/cli.mjs';

test('closingRefs reads GitHub closing keywords in every reference form', () => {
  assert.deepEqual(closingRefs('Closes #34. Part of #19.'), [{ owner: undefined, repo: undefined, number: 34 }]);
  assert.deepEqual(closingRefs('fixes srs-rust#12\nResolved: the-greenman/clerk#7'),
    [{ owner: undefined, repo: 'srs-rust', number: 12 }, { owner: 'the-greenman', repo: 'clerk', number: 7 }]);
  assert.deepEqual(closingRefs('Close https://github.com/the-greenman/srs/issues/9'), [{ owner: 'the-greenman', repo: 'srs', number: 9 }]);
});

test('closingRefs ignores mentions without a closing keyword', () => {
  assert.deepEqual(closingRefs('Part of the-greenman/clerk#7 (Phase 4 of clerk#1). Refs #3'), []);
  assert.deepEqual(closingRefs(null), []);
});

test('ghApiRequest maps the gh api flags the clerk uses to a REST request', async () => {
  const { ghApiRequest } = await import('../lib/adapters/cli.mjs');
  assert.deepEqual(ghApiRequest(['api', 'repos/o/r/issues/1']), { method: 'GET', url: 'https://api.github.com/repos/o/r/issues/1', body: undefined, paginate: false, slurp: false });
  assert.deepEqual(ghApiRequest(['api', '-X', 'POST', 'repos/o/r/issues/1/labels', '-f', 'labels[]=a', '-f', 'labels[]=b']).body, { labels: ['a', 'b'] });
  assert.deepEqual(ghApiRequest(['api', 'repos/o/r/issues/1/sub_issues', '-F', 'sub_issue_id=42', '-F', 'x=null']), { method: 'POST', url: 'https://api.github.com/repos/o/r/issues/1/sub_issues', body: { sub_issue_id: 42, x: null }, paginate: false, slurp: false });
  assert.equal(ghApiRequest(['api', '-X', 'GET', 'repos/o/r/issues', '-f', 'labels=ready,wg:x', '-f', 'state=open']).url, 'https://api.github.com/repos/o/r/issues?labels=ready%2Cwg%3Ax&state=open');
  assert.equal(ghApiRequest(['api', '--paginate', '--slurp', 'repos/o/r/pulls?state=open']).slurp, true);
  assert.throws(() => ghApiRequest(['api', 'user', '--jq', '.login']), /no curl fallback/);
  assert.throws(() => ghApiRequest(['pr', 'merge', '1', '--auto']), /no curl fallback/);
});

test('--paginate pages by page=N on the given path, never by the Link header (clerk#225)', () => {
  const seen = [], rows = (n) => Array.from({ length: n }, (_, i) => ({ i }));
  const fetch = (a) => { const path = a.find((x) => x.startsWith('repos/')); seen.push(path); const page = Number(/page=(\d+)$/.exec(path)[1]); return JSON.stringify(rows(page < 3 ? 100 : 7)); };
  const out = JSON.parse(ghPaged(['api', '--paginate', '--slurp', 'repos/o/r/issues?state=open&per_page=100'], fetch));
  assert.deepEqual(seen, ['repos/o/r/issues?state=open&per_page=100&page=1', 'repos/o/r/issues?state=open&per_page=100&page=2', 'repos/o/r/issues?state=open&per_page=100&page=3']);
  assert.deepEqual(out.map((p) => p.length), [100, 100, 7]);
  assert.equal(JSON.parse(ghPaged(['api', '--paginate', 'repos/o/r/branches'], () => '[1,2]')).length, 2, 'default page size 30; arrays merged without --slurp');
  assert.deepEqual(JSON.parse(ghPaged(['api', '-X', 'GET', '--paginate', 'repos/o/r/pulls?per_page=2'], (a) => (a[3].endsWith('page=1') ? '[1,2]' : '[]'))), [1, 2]);
});
