// Depth of context per domain: the owner's words, recurring problems, evidence and answers behind it. Read-only; prints JSON.
// clerk dream-depth --repo <programme> [--srs <path>]
import { flags, call, find, pool } from './lib.mjs';

const f = flags(), M = 'com.semanticops.method';
const label = new Map();
const labelled = async (...a) => (await find(f, ...a)).map((h) => (label.set(h.instanceId, h.label), h.instanceId));
const rels = (await call(f, ['relation', 'list'])).relations;
const domains = await labelled('--type', `${M}/domain`), pids = await labelled('--type', `${M}/persona-in-domain`), problems = await labelled('--type', `${M}/problem`);
const vids = (await find(f, '--tier', '0', '--tag', 'vignette')).map((h) => h.instanceId);
const vday = new Map(); let undated = 0;
await pool(vids, async (i) => {
  const n = (await call(f, ['note', 'get', i])).note;
  const d = (n.createdAt || '').slice(0, 10) || (n.title || '').match(/20\d\d-\d\d-\d\d/)?.[0];
  d ? vday.set(i, d) : undated++;
});
const out = new Map(), into = new Map();
const push = (m, k, v) => (m.get(k) || m.set(k, []).get(k)).push(v);
for (const r of rels) { push(out, r.sourceId, [r.relationType, r.targetId]); push(into, r.targetId, [r.relationType, r.sourceId]); }
const outOf = (i) => out.get(i) || [], intoOf = (i) => into.get(i) || [];
const domSet = new Set(domains), pidDomain = new Map();
for (const p of pids) for (const [k, t] of outOf(p)) if (k === `${M}/in-domain` && domSet.has(t)) pidDomain.set(p, label.get(t)); // copies share a title: merge by it

// Vignettes behind x: those that evidence it, and those reached along derived-from (up to 3 hops).
function vignettesOf(x, seen = new Set(), depth = 0) {
  for (const [k, s] of intoOf(x)) if (k === 'evidences' && vday.has(s)) seen.add(s);
  for (const [k, t] of outOf(x)) if (k === 'derived-from' && !seen.has(t)) { seen.add(t); if (!vday.has(t) && depth < 3) vignettesOf(t, seen, depth + 1); }
  return new Set([...seen].filter((v) => vday.has(v)));
}
const prof = new Map();
for (const p of problems) for (const [k, t] of outOf(p)) if (k === `${M}/held-by` && pidDomain.has(t)) {
  const dn = pidDomain.get(t);
  const d = prof.get(dn) || prof.set(dn, { problems: new Map(), evidence: new Set(), answers: new Set() }).get(dn);
  const slot = d.problems.get(label.get(p)) || d.problems.set(label.get(p), new Set()).get(label.get(p));
  for (const v of vignettesOf(p)) slot.add(v);
  for (const [kk, s] of intoOf(p)) { if (kk === 'evidences') d.evidence.add(s); if (kk === `${M}/answers`) d.answers.add(s); }
}
const rows = [...prof].map(([domain, d]) => {
  const all = new Set([...d.problems.values()].flatMap((s) => [...s])), days = [...new Set([...all].map((v) => vday.get(v)))].sort();
  const recurring = [...d.problems].filter(([, vs]) => new Set([...vs].map((v) => vday.get(v))).size >= 2).map(([n]) => n).sort();
  return { domain, problems: d.problems.size, problems_with_owner_words: [...d.problems.values()].filter((s) => s.size).length, vignettes: all.size, days: days.length,
    span: days.length ? `${days[0]} to ${days.at(-1)}` : '', recurring_problems: recurring.length, recurring, evidence: d.evidence.size, answers: d.answers.size };
}).sort((a, b) => b.days - a.days || b.recurring_problems - a.recurring_problems || b.vignettes - a.vignettes);
console.log(JSON.stringify({ domains_with_problems: rows.length, domain_names: new Set(domains.map((d) => label.get(d))).size, vignettes: vday.size, undated, rows }, null, 1));
