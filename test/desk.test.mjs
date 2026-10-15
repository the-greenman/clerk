import test from 'node:test';
import assert from 'node:assert/strict';
import { deskBody } from '../lib/practice/desk.mjs';

const NOW = '2026-10-15T08:00:00Z';
const report = (id, date) => ({ id, body: `<!-- wg-report cycle=${date} -->\nreport`, created_at: `${date}T11:30:00Z`, author_association: 'OWNER', html_url: `u${id}` });
const group = (title, pause) => ({ title, label: `wg:${title}`, pause, merged: 0, budget: 10, runReports: [], queue: { ready: [], inFlight: 0 } });
const needsYou = (body) => body.split('## Needs you')[1].split('## Threads')[0];
const unthreaded = (body) => body.split('### Unthreaded')[1].split('## Running fine')[0];

test('a paused group puts its unreceived reports first in Needs you', () => {
  const body = deskBody({ now: NOW, groups: [group('A', 'paused: 2 reports unacknowledged')], reportComments: [report(1, '2026-10-13'), report(2, '2026-10-14')],
    assigned: [{ repo: 'r', number: 1, title: 't', createdAt: '2026-10-01T00:00:00Z' }] });
  const rows = needsYou(body).split('\n').filter((l) => /^\| \d/.test(l));
  assert.match(rows[0], /^\| 1 \| \*\*WG reports unreceived:\*\* A \(cycles 10-13, 10-14\)/);
  assert.match(rows[0], /Group paused/);
  assert.match(rows[1], /assigned to you/);
});

test('an assigned issue shows its age in days', () => {
  const body = deskBody({ now: NOW, assigned: [{ repo: 'srs-web', number: 563, title: 't', url: 'https://x/563', createdAt: '2026-10-05T07:00:00Z' }] });
  assert.match(needsYou(body), /\[srs-web#563\]\(https:\/\/x\/563\) \(10 days\)/);
});

test('an unlinked PR lands in Unthreaded; a PR reaching an epic does not', () => {
  const pr = (number, chain) => ({ repo: 'muDemocracy.org', number, title: `pr ${number}`, labels: [], chain, updatedAt: '2026-10-12T00:00:00Z' });
  const body = deskBody({ now: NOW, prs: [pr(339, []), pr(340, ['clerk#64', 'clerk#19'])], epics: [{ ref: 'clerk#19', refs: ['clerk#19'], title: 'Clerk process', rank: 1 }] });
  assert.match(unthreaded(body), /muDemocracy\.org#339 pr 339/);
  assert.doesNotMatch(unthreaded(body), /#340/);
  assert.match(body, /\| Clerk process \(clerk#19\) \| running \| 10-12 \| 1 PR in flight: muDemocracy\.org#340 \| agents \|/);
});

test('empty input: nothing needs you', () => {
  assert.match(deskBody({ now: NOW }), /## Needs you\n\nNothing needs you\./);
});

test('a report comment is listed under the group its second line names', () => {
  const c = { ...report(1, '2026-10-14'), body: '<!-- wg-report cycle=2026-10-14 -->\nB: cycle 2026-10-13 to 2026-10-14' };
  const rows = needsYou(deskBody({ now: NOW, groups: [group('A', 'ok'), group('B', 'paused: 2')], reportComments: [c] })).split('\n').filter((l) => /^\| \d/.test(l));
  assert.equal(rows.length, 1);
  assert.match(rows[0], /unreceived:\*\* B/);
});

test('a PR stating a decision is in Needs you; "Decision asked: none" asks nothing', () => {
  const pr = (number, body) => ({ repo: 'clerk', number, title: `pr ${number}`, body, labels: [], chain: [] });
  const body = deskBody({ now: NOW, prs: [pr(57, 'Decision asked: take D11 in the next session.\nmore'), pr(120, 'Decision asked: none to merge.')] });
  assert.match(needsYou(body), /Decision asked in clerk#57:\*\* pr 57 \| take D11 in the next session \|/);
  assert.doesNotMatch(needsYou(body), /#120/);
  assert.match(unthreaded(body), /clerk#57 pr 57 \| waiting on you/);
});

test('a group paused by another group\'s reports says so', () => {
  const body = deskBody({ now: NOW, reportIssue: { ref: 'semanticops.com#31' }, groups: [group('A', 'paused: 2 reports unacknowledged'), group('B', 'paused: 2 reports unacknowledged')],
    reportComments: [report(1, '2026-10-13'), report(2, '2026-10-14')] });
  assert.match(body, /\| B \| \*\*paused\*\* \| - \| Paused by the unreceived reports on semanticops\.com#31; receiving them un-pauses it \(Needs you\)/);
});

test('a PR belongs to the nearest epic up its chain', () => {
  const pr = { repo: 'clerk', number: 57, title: 'p', labels: [], chain: ['clerk#56', 'clerk#19', 'semanticops.com#33'] };
  const body = deskBody({ now: NOW, prs: [pr], epics: [{ ref: 'semanticops.com#33', title: 'Ledger', rank: 1 }, { ref: 'clerk#19', title: 'Committees', rank: 2 }] });
  assert.match(body, /\| Committees \(clerk#19\) \| running \|/);
  assert.match(body, /\| Ledger \(semanticops\.com#33\) \| idle \|/);
});
