// `clerk desk --json`: the desk as data, plus what a client renders beside it (each open PR's conversation, files and the
// decision records its diff adds; epics with their tasks; PRs closed in the last CLERK_CLOSED_DAYS, default 14).
// The desk's own judgement is gatherDesk + deskBody, unchanged. Lifted from srs-lab control-room/extract/desk.mjs.
import { gatherDesk } from './desk.mjs';
import { loadSettings } from './settings.mjs';
import { gh } from './cli.mjs';
import { deskBody } from '../practice/desk.mjs';
import { exerciseItems } from '../practice/agenda.mjs';
import { labelsOf, checksState, decisionFilesFromPatch, needsOf, threadsOf } from '../practice/desk-detail.mjs';

const api = (path) => JSON.parse(gh(['api', path]));
const apiAll = (path) => JSON.parse(gh(['api', '--paginate', '--slurp', path])).flat();
const warn = (what, x) => console.error(`desk: ${what} unreadable (${String(x.message).split('\n')[0]})`);

function prDetail(O, p) {
  const R = p.repo, n = p.number;
  try {
    const pull = api(`repos/${O}/${R}/pulls/${n}`);
    const comments = [
      ...apiAll(`repos/${O}/${R}/issues/${n}/comments?per_page=100`).map((c) => ({ at: c.created_at, user: c.user?.login ?? null, userType: c.user?.type ?? null, assoc: c.author_association ?? null, body: String(c.body ?? '').slice(0, 6000), url: c.html_url })),
      ...apiAll(`repos/${O}/${R}/pulls/${n}/reviews?per_page=100`).filter((r) => r.body || r.state !== 'COMMENTED').map((r) => ({ at: r.submitted_at, user: r.user?.login ?? null, userType: r.user?.type ?? null, assoc: r.author_association ?? null, body: `${r.state !== 'COMMENTED' ? `[review: ${r.state.toLowerCase()}] ` : ''}${String(r.body ?? '').slice(0, 6000)}`, url: r.html_url, review: r.state })),
    ].sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const files = apiAll(`repos/${O}/${R}/pulls/${n}/files?per_page=100`);
    const c = p.chain?.[0];
    const issueBody = c ? (() => { const [r, k] = c.split('#'); try { return String(api(`repos/${O}/${r}/issues/${k}`).body ?? '').slice(0, 4000); } catch { return ''; } })() : '';
    return { comments, decisionFiles: decisionFilesFromPatch(files), issueBody, additions: pull.additions, deletions: pull.deletions, changedFiles: pull.changed_files, head: pull.head?.sha, author: pull.user?.login,
      files: files.slice(0, 60).map((f) => ({ name: f.filename, status: f.status, add: f.additions, del: f.deletions })) };
  } catch (x) { warn(`${R}#${n} detail`, x); return {}; }
}

export async function deskDetail(repo, { closedDays = Number(process.env.CLERK_CLOSED_DAYS || 14) } = {}) {
  const input = await gatherDesk(repo), body = deskBody(input), O = input.owner;
  const epics = input.epics.map((e) => {
    try {
      const i = api(`repos/${O}/${e.repo}/issues/${e.number}`), subs = api(`repos/${O}/${e.repo}/issues/${e.number}/sub_issues?per_page=100`);
      return { ref: e.ref, title: e.title, priority: e.priority ?? null, rank: e.rank ?? null, url: i.html_url, state: i.state, updatedAt: i.updated_at,
        tasks: subs.map((s) => ({ ref: `${s.repository_url.split('/').pop()}#${s.number}`, title: s.title, state: s.state, url: s.html_url, labels: labelsOf(s) })) };
    } catch (x) { warn(e.ref, x); return { ref: e.ref, title: e.title, priority: e.priority ?? null, rank: e.rank ?? null, tasks: [] }; }
  });
  const since = new Date(Date.parse(input.now) - closedDays * 864e5).toISOString();
  const closedPrs = loadSettings(repo).repos.flatMap((r) => {
    try {
      return api(`repos/${O}/${r}/pulls?state=closed&sort=updated&direction=desc&per_page=100`).filter((p) => p.closed_at >= since)
        .map((p) => ({ repo: r, number: p.number, title: p.title, url: p.html_url, labels: labelsOf(p), merged: Boolean(p.merged_at), closedAt: p.closed_at, author: p.user?.login ?? null, body: String(p.body ?? '').slice(0, 20000) }));
    } catch (x) { warn(`${r} closed PRs`, x); return []; }
  }).sort((a, b) => b.closedAt.localeCompare(a.closedAt));
  return {
    now: input.now, owner: O, markdown: body, closedDays, gates: input.gates ?? null,
    needs: needsOf(body), threads: threadsOf(body),
    groups: input.groups.map((g) => ({ title: g.title, label: g.label, roleId: g.roleId, pause: g.pause ?? null, merged: g.merged ?? null, budget: g.budget ?? null, ready: g.queue?.ready?.length ?? g.queue?.length ?? null })),
    prs: input.prs.map((p) => ({ repo: p.repo, number: p.number, title: p.title, url: p.url, draft: Boolean(p.isDraft), labels: labelsOf(p), updatedAt: p.updatedAt,
      checks: checksState(p.statusCheckRollup ?? []), mergeState: p.mergeStateStatus ?? null, base: p.base ?? null, headRef: p.headRef ?? null, approved: Boolean(p.approved), chain: p.chain ?? [], body: String(p.body ?? '').slice(0, 20000), ...prDetail(O, p) })),
    // the open exercises in the owner's log, the same set the session agenda and "Needs you" count
    exercises: exerciseItems(input.exercises, input.ownerLog).map((r) => ({ id: r.instanceId, title: r.record.fieldValues?.title ?? null })),
    assigned: input.assigned.map((i) => ({ ref: `${i.repo}#${i.number}`, title: i.title, url: i.url, createdAt: i.createdAt })),
    needsInput: input.needsInput.map((i) => ({ ref: `${i.repo}#${i.number}`, title: i.title, url: i.url, createdAt: i.createdAt })),
    closedPrs, epics,
  };
}
