// Advisory grounding check (clerk#22, handbook stage 8, indicator I1): does a PR's work trace
// issue -> affirmed problem (persona, domain) -> epic -> group? Pure: adapters/ground.mjs fetches.
// `Answers:` is read by answersOf in grounding.mjs (shared with clerk claim and steward-check).
import { answersOf } from './grounding.mjs';
export const LEVELS = ['none', 'issue', 'problem', 'problem+persona+domain', 'epic', 'group'];
const MNS = 'com.semanticops.method';

// records/relations as `srs record list` / `srs relation list`; affirmed: Set of instance ids (the human layer).
// -> { 'SP-nn': {affirmed, persona: 'affirmed'|'suggested'|null, domain: same} }
// Domain today: domain `contains` cluster `contains` problem, or persona `in-domain` domain (when the type exists).
// Forks share a problem_id, so facts are pooled across the copies of one SP.
export function problemsFrom(records, relations, affirmed = new Set()) {
  const type = new Map(records.map((r) => [r.instanceId, r.record.typeName]));
  const via = (ids, t, dir) => relations.filter((l) => (t === 'contains' ? l.relationType === t : l.relationType === `${MNS}/${t}`) && ids.includes(dir === 'out' ? l.sourceId : l.targetId))
    .map((l) => (dir === 'out' ? l.targetId : l.sourceId));
  const strength = (ids) => (ids.some((i) => affirmed.has(i)) ? 'affirmed' : ids.length ? 'suggested' : null);
  const out = {};
  for (const sp of new Set(records.filter((r) => r.record.typeName === 'problem').map((r) => r.record.fieldValues.problem_id).filter(Boolean))) {
    const ids = records.filter((r) => r.record.typeName === 'problem' && r.record.fieldValues.problem_id === sp).map((r) => r.instanceId);
    const personas = via(ids, 'held-by', 'out').filter((i) => type.get(i) === 'persona');
    const clusters = via(ids, 'contains', 'in').filter((i) => type.get(i) === 'cluster');
    const domains = [...via(clusters, 'contains', 'in'), ...via(personas, 'in-domain', 'out')].filter((i) => type.get(i) === 'domain');
    out[sp] = { affirmed: ids.some((i) => affirmed.has(i)), persona: strength(personas), domain: strength(domains) };
  }
  return out;
}

// First SP named by any of the texts (SP-nn), 'none-yet' if one says "No affirmed problem yet", else null.
const firstAnswer = (texts) => { const r = texts.map((t) => answersOf(t ?? '')); return r.find((x) => x.problems.length)?.problems[0].toUpperCase() ?? (r.some((x) => x.none !== undefined) ? 'none-yet' : null); };

// pr: {labels:[name], body}; issue: {ref, body, comments:[body], labels:[name], parents:[{ref, labels:[name]}]} | null
// problems: problemsFrom(); roadmap: {epics:[{refs:[repo#n]}]} (scripts/roadmap.mjs derive); groups: loadGroups() [{label}]
// -> {grounded, level, reasons, chain:{issue, problem, persona, domain, epic, group}, sp}
// Level is the longest unbroken run of the chain; persona/domain count only when affirmed, "suggested" is said in reasons.
export function groundPR({ pr, issue, problems = {}, roadmap = { epics: [] }, groups = [] }) {
  const reasons = [], chain = { issue: false, problem: false, persona: false, domain: false, epic: false, group: false };
  let sp = null, level = 'none';
  const fin = () => ({ grounded: LEVELS.indexOf(level) >= LEVELS.indexOf('problem'), level, reasons, chain, sp });
  if (!issue) { reasons.push('no linked issue (the PR closes none)'); return fin(); }
  chain.issue = true; level = 'issue';
  const hit = firstAnswer([issue.body, ...(issue.comments ?? []), pr?.body]);
  if (!hit) reasons.push(`${issue.ref} has no Answers: line`);
  else if (hit === 'none-yet') reasons.push(`${issue.ref} says "No affirmed problem yet"`);
  else {
    sp = hit; const p = problems[sp];
    if (!p) reasons.push(`${sp} is not a known problem`);
    else if (!p.affirmed) reasons.push(`${sp} is only suggested, not affirmed`);
    else chain.problem = true;
    if (p) for (const k of ['persona', 'domain']) {
      if (p[k] === 'affirmed') chain[k] = true;
      else reasons.push(p[k] === 'suggested' ? `${sp} ${k} is only suggested` : `${sp} has no ${k}`);
    }
  }
  const epicRefs = new Set(roadmap.epics.flatMap((e) => e.refs ?? [e.ref]));
  const epic = [{ ref: issue.ref }, ...(issue.parents ?? [])].find((x) => epicRefs.has(x.ref));
  if (epic) chain.epic = true; else reasons.push('the issue has no parent chain reaching a roadmap epic');
  const labels = new Set([...(pr?.labels ?? []), ...(issue.labels ?? []), ...(issue.parents ?? []).flatMap((x) => x.labels ?? [])]);
  const group = groups.find((g) => labels.has(g.label));
  if (group) chain.group = true; else reasons.push('no working-group label on the PR, issue or its parents (no epic-to-group relation exists yet)');
  // ponytail: ladder in order; a chain broken early stops the level there, flags above it still show in `chain`.
  for (const [lvl, ok] of [['problem', chain.problem], ['problem+persona+domain', chain.persona && chain.domain], ['epic', chain.epic], ['group', chain.group]]) {
    if (!ok) break; level = lvl;
  }
  return fin();
}

// results: [{level, ...}] -> I1 {total, grounded, share, full, fullShare, byLevel}
export function i1(results) {
  const rank = (r) => LEVELS.indexOf(r.level), n = results.length;
  const grounded = results.filter((r) => rank(r) >= 2).length, full = results.filter((r) => rank(r) >= 3).length;
  return { total: n, grounded, share: n ? grounded / n : null, full, fullShare: n ? full / n : null,
    byLevel: Object.fromEntries(LEVELS.map((l) => [l, results.filter((r) => r.level === l).length])) };
}
