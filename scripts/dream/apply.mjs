// Programme dream, last layer: write what the dream kept, through the srs CLI, as the dream's actor. Never edits or deletes.
// clerk dream-apply --repo <programme> --dir <dream dir> --container <dream container id> [--date YYYY-MM-DD] [--sp <first SP number>] [--srs <path>]
// Reads <dir>/result.json (the workflow's return), repairs garbled ids into <dir>/result.clean.json, then writes:
// evidences links (strength and quote in notes; existing links skipped), one evidence comment per record that gained links,
// one suggestion comment per refinement, recurring new concerns (two or more days) as suggested problems.
// Logs every write to <dir>/ledger.jsonl.
import { readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs';
import { flags, call, isMain } from './lib.mjs';

const ACTOR = '{"kind":"ai","id":"agent:programme-dream","name":"Programme dream"}';
const SUGGESTIONS = '219dc999-b667-4088-aae6-4c180ad03c90', C = 'com.semanticops.comments', M = 'com.semanticops.method';

// A model garbles ids. Keep a known id; else the one known id of the same kind sharing its first 8 characters; else null (drop).
export function repairId(id, known, kind) {
  if (known.get(id) === kind) return id;
  const hits = typeof id === 'string' && id.length >= 8 ? [...known].filter(([k, v]) => v === kind && k.startsWith(id.slice(0, 8))) : [];
  return hits.length === 1 ? hits[0][0] : null;
}

export function clean(r, cat, vigIds) {
  const known = new Map([...cat.domains.map((x) => [x.id, 'domain']), ...cat.personas.map((x) => [x.id, 'persona']), ...cat.problems.map((x) => [x.id, 'problem']), ...vigIds.map((v) => [v, 'vignette'])]);
  const fix = (id, kind) => repairId(id, known, kind);
  const links = r.links.map((l) => ({ ...l, vignette_id: fix(l.vignette_id, 'vignette'), target_id: fix(l.target_id, l.target_kind) })).filter((l) => l.vignette_id && l.target_id);
  const refinements = r.refinements.map((p) => ({ ...p, target_id: fix(p.target_id, p.kind) })).filter((p) => p.target_id);
  const new_problems = r.new_problems.map((c) => ({ ...c, vignette_ids: c.vignette_ids.map((v) => fix(v, 'vignette')).filter(Boolean), persona_id: c.persona_id ? fix(c.persona_id, 'persona') : null }));
  return { ...r, links, refinements, new_problems };
}

async function main() {
  const f = flags(), D = f.dir, DREAM = f.container, DATE = f.date || new Date().toISOString().slice(0, 10);
  if (!D || !DREAM) throw new Error('give --dir and --container');
  const cat = JSON.parse(readFileSync(`${D}/catalogue.json`, 'utf8'));
  const vig = Object.fromEntries(readdirSync(`${D}/batches`).flatMap((n) => JSON.parse(readFileSync(`${D}/batches/${n}`, 'utf8'))).map((v) => [v.id, v]));
  const r = clean(JSON.parse(readFileSync(`${D}/result.json`, 'utf8')), cat, Object.keys(vig));
  writeFileSync(`${D}/result.clean.json`, JSON.stringify(r, null, 1));
  let sp = Number(f.sp) || Math.max(0, ...cat.problems.map((p) => Number(/^SP-(\d+)$/.exec(p.sp || '')?.[1] || 0))) + 1;

  const write = async (kind, args, body) => {
    const p = await call(f, args, body, ACTOR);
    const id = p.relationId || p.record?.instanceId || p.instanceId;
    appendFileSync(`${D}/ledger.jsonl`, JSON.stringify({ kind, id, body }) + '\n');
    return id;
  };
  const relate = (relationType, s, t, notes) => write('relation', ['relation', 'create'], { relationType, sourceInstanceId: s, targetInstanceId: t, ...(notes && { notes }) });
  const record = (type, fieldValues, container, tags) => write('record', ['record', 'create', '--type', type, ...(container ? ['--container', container] : [])], { fieldValues, ...(tags && { tags }) });
  const intoDream = (i) => call(f, ['container', 'members', 'add', DREAM, i, '--depth', '1'], undefined, ACTOR);
  const comment = async (text, kind, target) => { const c = await record(`${C}/comment`, { comment_text: text, kind }, null, ['dream']); await relate(`${C}/comments-on`, c, target); await intoDream(c); };
  const day = (v) => vig[v].date || 'undated', s = (n) => (n > 1 ? 's' : '');

  const existing = new Set((await call(f, ['relation', 'list'])).relations.filter((x) => x.relationType === 'evidences').map((x) => `${x.sourceId} ${x.targetId}`));
  const made = new Map();
  for (const l of r.links) {
    if (existing.has(`${l.vignette_id} ${l.target_id}`)) continue;
    await relate('evidences', l.vignette_id, l.target_id, `Dream ${DATE} · ${l.strength} · "${l.quote}"`);
    existing.add(`${l.vignette_id} ${l.target_id}`);
    (made.get(l.target_id) || made.set(l.target_id, []).get(l.target_id)).push(l);
  }
  console.log('links written', [...made.values()].reduce((a, v) => a + v.length, 0), 'to', made.size, 'records');

  for (const [t, ls] of made) { // one evidence comment per record that gained links, so the owner can agree or disagree beside it
    ls.sort((a, b) => day(a.vignette_id).localeCompare(day(b.vignette_id)) || (a.strength !== 'retells') - (b.strength !== 'retells'));
    const days = new Set(ls.map((l) => day(l.vignette_id))).size;
    await comment(`Dream ${DATE} linked ${ls.length} vignette${s(ls.length)} from ${days} day${s(days)} to this record as evidence. Agree if they belong here; disagree to have a later dream drop them.\n\n`
      + ls.map((l) => `- ${day(l.vignette_id)} · ${l.strength} · "${l.quote}" (${vig[l.vignette_id].title})`).join('\n'), 'evidence', t);
  }
  console.log('evidence comments', made.size);

  let n = 0; // the record itself is never changed here
  for (const p of r.refinements.filter((x) => x.change !== 'none')) {
    await comment(`Dream ${DATE} suggests a refinement: ${p.change}.\n\n**What the vignettes add.** ${p.what_the_vignettes_add}\n\n${p.proposed_statement ? `**Proposed.** ${p.proposed_statement}\n\n` : ''}**Depth.** ${p.depth_note}\n\nIf you agree, the change is made by succession: a successor that supersedes this record, which stays as it is.`, 'suggestion', p.target_id);
    n++;
  }
  console.log('refinement suggestions', n);

  for (const c of r.new_problems) { // recurring concerns not yet held, as suggested problems
    const vs = c.vignette_ids.filter((v) => vig[v]), days = [...new Set(vs.map(day))].sort();
    if (days.length < 2) continue;
    const id = `SP-${sp++}`;
    const pid = await record(`${M}/problem`, { problem_id: id, title: c.title, statement: c.statement, kind: 'condition', source_ref: [`Dream ${DATE}: recurs in vignettes on ${days.join(', ')}`] }, SUGGESTIONS, ['suggested', 'dream']);
    if (c.persona_id) await relate(`${M}/held-by`, pid, c.persona_id);
    for (const v of vs) await relate('derived-from', pid, v);
    await intoDream(pid);
    console.log('new problem', id, c.title);
  }
}
if (isMain(import.meta.url)) await main();
