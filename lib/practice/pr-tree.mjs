// PR tree: open PRs grouped into chains, each in the order it should merge. Pure; reads `clerk desk --json` PR rows.
// Edges, within one repo:
//   stacked  (hard) a PR whose base is another PR's branch merges after it
//   depends  (hard) a PR naming another open PR, or an issue another PR closes, on a Blocked by / Depends on / once #n lands line
//   overlap  (soft) two PRs changing the same file: the readier merges first, the other rebases after it
// A chain is a connected component; its order is a topological sort of the hard edges, ties broken by readiness. Cycles are reported, never ordered.
import { prereqRefs } from './refs.mjs';
import { parseDecisions, answersFrom } from './pr-decisions.mjs';

const refOf = (p) => `${p.repo}#${p.number}`;
const labelNames = (p) => (p.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));

// The decisions a PR carries: what it asks (and how many are still open), what it made, what records its diff adds.
export function prDecisions(p) {
  const d = parseDecisions(p.body ?? ''), answered = answersFrom(p.comments ?? []);
  const legacy = d.legacy.asked && !/^\(?none\b/i.test(d.legacy.asked.replace(/^[*_\s]+/, '')) && !d.legacy.asked.startsWith('<') ? 1 : 0;
  const asks = d.asks.length + legacy, open = d.asks.filter((a) => !answered.has(a.key)).length + (legacy && !answered.has('Q1') ? 1 : 0);
  return { asks, open, made: d.made.length, recorded: (p.decisionFiles ?? []).length };
}

// Lower is readier: merge state, then checks, then gated, then size.
const STATE = { CLEAN: 0, HAS_HOOKS: 0, UNSTABLE: 1, BEHIND: 2, UNKNOWN: 3, BLOCKED: 3, DIRTY: 4 };
const CHECKS = { green: 0, none: 1, pending: 2, failing: 3 };
const readiness = (p, gated) => [STATE[p.mergeState] ?? 3, CHECKS[p.checks] ?? 1, gated ? 0 : 1, (p.additions ?? 0) + (p.deletions ?? 0)];
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

// Why a PR with nothing before it still cannot merge, or null.
function waitReason(p, gated, dec) {
  if (p.draft) return 'draft';
  if (dec.open) return `${dec.open} decision${dec.open > 1 ? 's' : ''} asked`;
  if (p.mergeState === 'DIRTY') return 'conflicts';
  if (p.checks === 'failing' || p.checks === 'pending') return `checks ${p.checks}`;
  if (!gated) return 'no gate';
  return null;
}

// prs: desk PR rows; gates: {auto, owner} labels (desk.gates); a group PR counts as gated once its quorum approves.
// -> {chains: [{repo, order: [ref], edges: [{from, to, kind, why}]}], cycles: [[ref]], singles: [ref],
//     prs: {ref: {next: {do: merge|rebase|wait|after, ref?, why?}, decisions, gated}}}
export function prTree(prs, gates) {
  const byRef = new Map(prs.map((p) => [refOf(p), p]));
  const gated = (p) => { const ls = labelNames(p); return Boolean(p.approved || (gates ? [gates.auto, gates.owner].some((g) => g && ls.includes(g)) : ls.some((l) => l.startsWith('gate:')))); }; // a desk from before clerk#173 has no gates
  const closes = new Map(prs.filter((p) => p.chain?.[0]).map((p) => [p.chain[0], refOf(p)])); // issue ref -> the PR that closes it
  const edges = [], seen = new Set();
  const edge = (from, to, kind, why) => { const k = `${from}>${to}`, r = `${to}>${from}`; if (from === to || seen.has(k) || (kind === 'overlap' && seen.has(r))) return; seen.add(k); edges.push({ from, to, kind, why }); };

  for (const p of prs) {
    const ref = refOf(p);
    for (const q of prs) if (q !== p && q.repo === p.repo && p.base && p.base === q.headRef) edge(refOf(q), ref, 'stacked', `based on ${q.headRef}`);
    for (const pre of prereqRefs(p.body, p.repo, { dependsOn: true })) {
      const from = byRef.has(pre) ? pre : closes.get(pre);
      if (from && byRef.get(from).repo === p.repo) edge(from, ref, 'depends', from === pre ? `names ${pre}` : `names ${pre}, which ${from} closes`);
    }
  }
  const hard = new Set(edges.map((e) => `${e.from}>${e.to}`));
  // ponytail: desk files are capped at 60 per PR (desk-detail.mjs), so overlap on big PRs can be missed; lift the cap if it bites
  for (let i = 0; i < prs.length; i++) for (let j = i + 1; j < prs.length; j++) {
    const a = prs[i], b = prs[j];
    if (a.repo !== b.repo || hard.has(`${refOf(a)}>${refOf(b)}`) || hard.has(`${refOf(b)}>${refOf(a)}`)) continue;
    const fa = new Set((a.files ?? []).map((f) => f.name)), shared = (b.files ?? []).map((f) => f.name).filter((n) => fa.has(n));
    if (shared.length) edge(refOf(a), refOf(b), 'overlap', `both change ${shared[0]}${shared.length > 1 ? ` (+${shared.length - 1})` : ''}`);
  }

  // components
  const parent = new Map(prs.map((p) => [refOf(p), refOf(p)]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  for (const e of edges) parent.set(find(e.from), find(e.to));
  const comps = new Map();
  for (const ref of byRef.keys()) { const r = find(ref); comps.set(r, [...(comps.get(r) ?? []), ref]); }

  const info = Object.fromEntries(prs.map((p) => [refOf(p), { decisions: prDecisions(p), gated: gated(p) }]));
  const score = (ref) => readiness(byRef.get(ref), info[ref].gated);
  const out = { chains: [], cycles: [], singles: [], prs: info };
  for (const refs of comps.values()) {
    if (refs.length === 1) { out.singles.push(refs[0]); continue; }
    const mine = edges.filter((e) => refs.includes(e.from)), hardIn = (r, done) => mine.filter((e) => e.kind !== 'overlap' && e.to === r && !done.has(e.from));
    const order = [], done = new Set();
    for (;;) {
      const ready = refs.filter((r) => !done.has(r) && !hardIn(r, done).length).sort((a, b) => cmp(score(a), score(b)));
      if (!ready.length) break;
      order.push(ready[0]); done.add(ready[0]);
    }
    const stuck = refs.filter((r) => !done.has(r));
    if (stuck.length) out.cycles.push(stuck);
    // overlap edges point the way the order runs: earlier merges first, the later one rebases after it
    const pos = new Map(order.map((r, i) => [r, i]));
    const oriented = mine.map((e) => (e.kind === 'overlap' && pos.get(e.from) > pos.get(e.to) ? { ...e, from: e.to, to: e.from } : e));
    out.chains.push({ repo: byRef.get(refs[0]).repo, order, edges: oriented });
  }
  out.singles.sort();
  out.chains.sort((a, b) => a.repo.localeCompare(b.repo) || a.order[0]?.localeCompare(b.order[0]));

  // the next act for each PR: wait on a hard predecessor, rebase after a soft one that merges first, else merge or say why not
  const allEdges = out.chains.flatMap((c) => c.edges);
  for (const [ref, x] of Object.entries(info)) {
    const before = allEdges.filter((e) => e.to === ref), p = byRef.get(ref);
    const hardBefore = before.find((e) => e.kind !== 'overlap'), softBefore = before.find((e) => e.kind === 'overlap');
    const why = waitReason(p, x.gated, x.decisions);
    x.next = out.cycles.some((c) => c.includes(ref)) ? { do: 'wait', why: 'in a cycle' }
      : hardBefore ? { do: 'after', ref: hardBefore.from, why: hardBefore.kind }
      : softBefore ? { do: 'rebase', ref: softBefore.from, why: softBefore.why }
      : why ? { do: 'wait', why } : { do: 'merge' };
  }
  return out;
}
