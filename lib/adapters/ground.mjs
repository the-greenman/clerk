// Fetch what the grounding check needs from GitHub (REST) and the programme repo (srs). No judgement here.
import { gh, ghJson, srs } from './cli.mjs';
import { mergedPRsSince, prForGrounding, issueWithComments } from './github.mjs';

const names = (xs) => (xs ?? []).map((l) => l.name);

// "repo#n" for merged PRs since a date, across repos.
export function mergedSince(owner, repos, since) {
  return repos.flatMap((r) => { try { return mergedPRsSince(owner, r, since); } catch (e) { console.error(`ground: ${r} unreadable, skipped (${String(e.stderr || e.message).trim().split('\n')[0]})`); return []; } });
}

// -> {pr, issue} for pr "repo#n"; issue is the first closing reference (a closing keyword in the PR body), with its sub-issue parent chain (labels only).
export function fetchPR(owner, ref) {
  const [repo, n] = ref.split('#');
  const { closingIssue: c, ...pr } = prForGrounding(owner, repo, n);
  const out = { ref, pr, issue: null };
  if (!c) return out;
  const irepo = c.repo;
  let i; // an issue this token cannot read (a private repo under a scoped CI token) is unknown, never a crash
  try { i = issueWithComments(`${owner}/${irepo}`, c.number); }
  catch (e) { console.error(`ground: ${irepo}#${c.number} unreadable, skipped (${String(e.stderr || e.message).trim().split('\n')[0]})`); out.issue = { ref: `${irepo}#${c.number}`, unreadable: true }; return out; }
  const parents = parentChain(owner, irepo, c.number);
  out.issue = { ref: `${irepo}#${c.number}`, body: i.body, comments: i.comments, labels: i.labels, parents };
  return out;
}

// The sub-issue parent chain of repo#n, nearest first, at most 5 deep: [{ref, labels:[name]}]. A read that fails is
// treated as the end of the chain; parentChainRead says when that happened.
export const parentChain = (owner, repo, n) => parentChainRead(owner, repo, n).parents;

// -> {parents, unknown}: unknown names the failure when a parent lookup failed for any reason but "no parent" (HTTP 404).
export function parentChainRead(owner, repo, n) {
  const parents = [];
  for (let cur = n, repoN = repo; parents.length < 5;) {
    let p;
    try { p = ghJson(['api', `repos/${owner}/${repoN}/issues/${cur}/parent`]); }
    catch (e) {
      const why = String(e.stderr || e.message);
      return /HTTP 404|Not Found/.test(why) ? { parents, unknown: null } : { parents, unknown: why.trim().split('\n')[0].slice(0, 120) };
    }
    if (!p?.number) break;
    repoN = p.repository_url?.split('/').pop() ?? repoN; cur = p.number;
    parents.push({ ref: `${repoN}#${p.number}`, labels: names(p.labels) });
  }
  return { parents, unknown: null };
}

// The programme's records for problemsFrom/derive: records, relations, affirmed ids (the "Affirmed" container).
export function loadProgramme(cli, repo) {
  const records = srs(cli, repo, ['record', 'list']).records;
  const relations = srs(cli, repo, ['relation', 'list']).relations;
  const a = srs(cli, repo, ['container', 'list']).containers.find((x) => x.title === 'Affirmed');
  const affirmed = new Set(a ? srs(cli, repo, ['container', 'get', a.containerId]).container.memberInstanceIds.map((m) => m.instanceId) : []);
  const outlines = srs(cli, repo, ['container', 'list']).containers.filter((x) => x.containerType === 'domain').map((x) => srs(cli, repo, ['container', 'get', x.containerId]).container);
  return { records, relations, affirmed, outlines };
}
export { gh };
