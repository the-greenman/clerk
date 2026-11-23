// Programme dream, layer 1: inventory. Reads only, through the srs CLI.
// Writes <out>/catalogue.json (domains, personas-in-domain, problems; suggestion and affirmed copies merged, the affirmed copy
// canonical), <out>/batches/NN.json (vignettes with words, date, existing links) and <out>/index.json.
// clerk dream-inventory --repo <programme> --out <dir> [--srs <path>] [--batch 25] [--since YYYY-MM-DD]
// --since keeps vignettes created on or after that date, plus undated ones no dream has linked; the catalogue is always whole.
import { mkdirSync, writeFileSync } from 'node:fs';
import { flags, call, find, pool } from './lib.mjs';

const f = flags();
const OUT = f.out, BATCH = Number(f.batch || 25), AFFIRMED = '5e28aa7e-4b35-4474-8f62-cf8dcae1e506', M = 'com.semanticops.method';
if (!OUT) throw new Error('give --out <dir>');
const short = (s, n = 280) => { s = (s || '').replace(/\s+/g, ' ').trim(); return s.length <= n ? s : s.slice(0, n - 1) + '…'; };
const ids = async (...a) => (await find(f, ...a)).map((h) => h.instanceId);

const rels = (await call(f, ['relation', 'list'])).relations;
// The incremental filter below knows what a dream has read only from each relation's createdBy; an srs build whose
// relation list omits it would silently re-read every undated vignette, so refuse it instead.
if (f.since && rels.length && !rels.some((r) => r.createdBy)) throw new Error('this srs build lists relations without createdBy, so --since cannot tell what a dream has read; use a newer build (the pinned SRS_RUST_CLI_TAG)');
const out = new Map(), into = new Map();
const push = (m, k, v) => (m.get(k) || m.set(k, []).get(k)).push(v);
for (const r of rels) { push(out, r.sourceId, [r.relationType, r.targetId]); push(into, r.targetId, [r.relationType, r.sourceId]); }
const outOf = (i) => out.get(i) || [], intoOf = (i) => into.get(i) || [];
const affirmed = new Set(await ids('--container', AFFIRMED));

async function canon(type) {
  const list = await ids('--type', `${M}/${type}`);
  const recs = new Map(list.map((i, n) => [i, null]));
  await pool(list, async (i) => recs.set(i, (await call(f, ['record', 'get', i])).record));
  const byTitle = new Map();
  for (const [i, r] of recs) push(byTitle, r.fieldValues.title ?? i, i);
  const result = new Map();
  for (const group of byTitle.values()) {
    group.sort((a, b) => (affirmed.has(b) - affirmed.has(a)) || (a < b ? -1 : 1));
    result.set(group[0], { aliases: group.slice(1), affirmed: affirmed.has(group[0]), record: recs.get(group[0]) });
  }
  return result;
}

const [domains, pids, problems] = [await canon('domain'), await canon('persona-in-domain'), await canon('problem')];
const alias = new Map();
for (const g of [domains, pids, problems]) for (const [c, e] of g) for (const a of [c, ...e.aliases]) alias.set(a, c);
const domOfPid = new Map();
for (const [c, e] of pids) for (const i of [c, ...e.aliases]) for (const [k, t] of outOf(i)) if (k === `${M}/in-domain` && alias.has(t)) domOfPid.set(c, alias.get(t));
const pidOf = (p) => [...new Set([p, ...problems.get(p).aliases].flatMap((i) => outOf(i)).filter(([k, t]) => k === `${M}/held-by` && alias.has(t)).map(([, t]) => alias.get(t)))].sort();
const fv = (e) => e.record.fieldValues;

const catalogue = {
  domains: [...domains].map(([id, e]) => ({ id, title: fv(e).title, about: short(Object.entries(fv(e)).filter(([k]) => k !== 'title').map(([, v]) => v).join(' ')), affirmed: e.affirmed })),
  personas: [...pids].map(([id, e]) => ({ id, title: fv(e).title || e.record.displayLabel, domain: domOfPid.get(id) ?? null, affirmed: e.affirmed })),
  problems: [...problems].map(([id, e]) => ({ id, sp: fv(e).problem_id, title: fv(e).title, statement: short(fv(e).statement, 320), personas: pidOf(id), affirmed: e.affirmed, state: e.record.lifecycleState })),
};

const canonical = new Set(alias.values());
const vignette = async (i) => {
  const n = (await call(f, ['note', 'get', i])).note;
  const words = (n.sections || []).map((s) => s.content || '').join('\n');
  const date = (n.createdAt || '').slice(0, 10) || (n.title || '').match(/20\d\d-\d\d-\d\d/)?.[0] || null;
  const linked = new Set([...intoOf(i).filter(([k, s]) => ['derived-from', 'evidences'].includes(k) && canonical.has(alias.get(s))).map(([, s]) => alias.get(s)),
    ...outOf(i).filter(([k, t]) => k === 'evidences' && alias.has(t)).map(([, t]) => alias.get(t))]);
  return { id: i, title: n.title, date, words: short(words, 2500), already_linked: [...linked].sort() };
};
let vigs = (await pool(await ids('--tier', '0', '--tag', 'vignette'), vignette))
  .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.id < b.id ? -1 : 1));
// A note made through the MCP note tool carries no createdAt and often no date in its title, so a date filter
// alone skips it. Keep an undated vignette until a dream has linked it (a link created by the dream's actor).
// ponytail: an undated vignette a dream read but linked to nothing is read again each run; record reads if that grows.
const dreamt = new Set(rels.filter((r) => r.createdBy?.id === 'agent:programme-dream').map((r) => r.sourceId));
if (f.since) vigs = vigs.filter((v) => (v.date ? v.date >= f.since : !dreamt.has(v.id)));

mkdirSync(`${OUT}/batches`, { recursive: true });
writeFileSync(`${OUT}/catalogue.json`, JSON.stringify(catalogue, null, 1));
for (let n = 0; n < vigs.length; n += BATCH) writeFileSync(`${OUT}/batches/${String(n / BATCH).padStart(2, '0')}.json`, JSON.stringify(vigs.slice(n, n + BATCH), null, 1));
const counts = { domains: domains.size, personas: pids.size, problems: problems.size, vignettes: vigs.length };
writeFileSync(`${OUT}/index.json`, JSON.stringify({ ...counts, batches: Math.ceil(vigs.length / BATCH), alias: Object.fromEntries(alias) }));
console.log(JSON.stringify({ ...counts, batches: Math.ceil(vigs.length / BATCH) }));
