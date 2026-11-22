export const meta = {
  name: 'programme-dream',
  description: 'Dream over srs-programme vignettes: link each to the domains, problems and personas it retells, verify, then propose refinements and new problems',
  whenToUse: 'After the inventory script has written catalogue.json and batches/*.json for the programme',
  phases: [
    { title: 'Read', detail: 'one small agent per batch of vignettes proposes links' },
    { title: 'Check', detail: 'one skeptic per batch tries to reject each link' },
    { title: 'Refine', detail: 'records whose context grew get a refinement proposal' },
    { title: 'New issues', detail: 'recurring concerns the catalogue does not hold' },
  ],
}

const DIR = args.dir
const BATCHES = Array.from({ length: args.batches }, (_, i) => String(i).padStart(2, '0'))

const READ = {
  type: 'object',
  properties: {
    links: { type: 'array', items: { type: 'object', properties: {
      vignette_id: { type: 'string' }, target_id: { type: 'string' },
      target_kind: { type: 'string', enum: ['problem', 'domain', 'persona'] },
      strength: { type: 'string', enum: ['retells', 'touches'] },
      quote: { type: 'string' } }, required: ['vignette_id', 'target_id', 'target_kind', 'strength', 'quote'] } },
    new_issues: { type: 'array', items: { type: 'object', properties: {
      vignette_id: { type: 'string' }, statement: { type: 'string' }, quote: { type: 'string' },
      nearest_target_id: { type: ['string', 'null'] } }, required: ['vignette_id', 'statement', 'quote'] } },
  }, required: ['links', 'new_issues'],
}
const CHECK = {
  type: 'object',
  properties: { verdicts: { type: 'array', items: { type: 'object', properties: {
    index: { type: 'integer' }, keep: { type: 'boolean' },
    strength: { type: 'string', enum: ['retells', 'touches'] }, reason: { type: 'string' } },
    required: ['index', 'keep', 'reason'] } } },
  required: ['verdicts'],
}
const REFINE = {
  type: 'object',
  properties: { proposals: { type: 'array', items: { type: 'object', properties: {
    target_id: { type: 'string' }, kind: { type: 'string' },
    change: { type: 'string', enum: ['none', 'sharpen', 'broaden', 'narrow', 'split'] },
    what_the_vignettes_add: { type: 'string' },
    proposed_statement: { type: ['string', 'null'] },
    depth_note: { type: 'string' } },
    required: ['target_id', 'kind', 'change', 'what_the_vignettes_add', 'depth_note'] } } },
  required: ['proposals'],
}
const NEW = {
  type: 'object',
  properties: { candidates: { type: 'array', items: { type: 'object', properties: {
    title: { type: 'string' }, statement: { type: 'string' },
    vignette_ids: { type: 'array', items: { type: 'string' } },
    dates: { type: 'array', items: { type: 'string' } },
    persona_id: { type: ['string', 'null'] }, nearest_problem_id: { type: ['string', 'null'] },
    why_new: { type: 'string' } },
    required: ['title', 'statement', 'vignette_ids', 'dates', 'why_new'] } } },
  required: ['candidates'],
}

const readPrompt = b => `You are a small dream agent over the SemanticOps programme's memory. Vignettes are the owner's words recorded at one moment (short-term memory). Your job: say which existing domains, problems and personas each vignette retells, so their context deepens over time.

Read ${DIR}/catalogue.json (domains, personas, problems; use their "id" values exactly) and ${DIR}/batches/${b}.json (your vignettes). Read-only: write nothing anywhere.

For each vignette, link it to every catalogue entry it genuinely bears on:
- "retells": the vignette states or describes the same concern, need or idea as the problem (or is plainly about that domain or persona).
- "touches": it bears on it but is not mainly about it.
Quote the vignette's own words that show the link (verbatim, under 30 words). Skip anything in the vignette's "already_linked" list. Most vignettes link to 0 to 4 entries; do not stretch. Commands with no meaning ("build X", "merge these") link to nothing.

Also list new_issues: a concern the vignette raises that no catalogue problem holds. State it from the owner's point of view in one sentence, with a quote, and the nearest catalogue id if any.`

const checkPrompt = (b, links) => `You are a skeptical checker in a dream over the programme's memory. Another agent proposed these links from vignettes (the owner's words) to catalogue entries. Try to reject each one. Keep a link only if a careful reader would agree the vignette bears on that entry; when unsure, reject. You may downgrade "retells" to "touches".

Vignettes: ${DIR}/batches/${b}.json. Catalogue: ${DIR}/catalogue.json (look up each target_id). Read-only.

Proposed links (index: vignette -> target, strength, quote):
${links.map((l, i) => `${i}: ${l.vignette_id} -> ${l.target_kind} ${l.target_id} [${l.strength}] "${l.quote}"`).join('\n')}

Return one verdict per index.`

phase('Read')
const checked = await pipeline(BATCHES,
  b => agent(readPrompt(b), { label: `read ${b}`, phase: 'Read', schema: READ, model: 'sonnet', effort: 'low' }),
  async (r, b) => {
    if (!r) return null
    if (!r.links.length) return { batch: b, links: [], new_issues: r.new_issues }
    const v = await agent(checkPrompt(b, r.links), { label: `check ${b}`, phase: 'Check', schema: CHECK, model: 'sonnet', effort: 'medium' })
    const keep = new Map((v ? v.verdicts : []).map(x => [x.index, x]))
    const links = r.links.map((l, i) => ({ ...l, batch: b, verdict: keep.get(i) }))
      .filter(l => l.verdict && l.verdict.keep)
      .map(l => ({ ...l, strength: l.verdict.strength || l.strength, reason: l.verdict.reason }))
    log(`batch ${b}: ${r.links.length} proposed, ${links.length} kept, ${r.new_issues.length} new issues`)
    return { batch: b, proposed: r.links.length, links, new_issues: r.new_issues.map(n => ({ ...n, batch: b })) }
  })

const done = checked.filter(Boolean)
const missing = BATCHES.filter(b => !done.find(d => d.batch === b))
if (missing.length) log(`batches with no result: ${missing.join(', ')}`)
const links = done.flatMap(d => d.links)
const issues = done.flatMap(d => d.new_issues)
const proposed = done.reduce((a, d) => a + (d.proposed || 0), 0)
log(`${links.length} links kept of ${proposed} proposed; ${issues.length} new-issue mentions`)

// Records whose context grew: two or more new links, of which at least one retells.
const byTarget = {}
for (const l of links) (byTarget[l.target_id] ||= { kind: l.target_kind, links: [] }).links.push(l)
const grown = Object.entries(byTarget)
  .filter(([, t]) => t.links.length >= 2 && t.links.some(l => l.strength === 'retells'))
  .sort((a, b) => b[1].links.length - a[1].links.length)
const CHUNK = Math.max(1, Math.ceil(grown.length / 6))
const chunks = []
for (let i = 0; i < grown.length; i += CHUNK) chunks.push(grown.slice(i, i + CHUNK))
log(`${grown.length} records grew; ${chunks.length} refiners`)

const refinePrompt = chunk => `You are a dream agent that refines the programme's model of reality from the owner's words. Each record below gained new vignettes in this dream. For each, read the record in ${DIR}/catalogue.json and the full vignettes in ${DIR}/batches/*.json (grep for the ids), then say what the vignettes add to the record's definition.

- change: none (the vignettes confirm it), sharpen (same meaning, clearer), broaden, narrow, or split (two concerns in one record).
- proposed_statement: the refined statement in the owner's voice for a problem (one or two sentences, the problem not the fix), or the refined description for a domain or persona; null when change is none.
- depth_note: how deep the context now is (how many vignettes, over what dates, whether the concern recurs).
Do not invent; every addition must trace to a quoted vignette. Read-only.

${chunk.map(([id, t]) => `${t.kind} ${id}:\n${t.links.map(l => `  - ${l.vignette_id} [${l.strength}] "${l.quote}"`).join('\n')}`).join('\n\n')}`

const newPrompt = `You are a dream agent finding concerns the owner keeps raising that the programme does not yet hold as problems. Below are new-issue mentions from all vignette batches. Read ${DIR}/catalogue.json and check each against the existing problems; drop any an existing problem already covers. Cluster the rest by meaning (the vignettes are in ${DIR}/batches/*.json; dates are in them). Propose a candidate only when it RECURS: two or more vignettes on different dates. For each: a 3 to 8 word title, a one-sentence statement from the owner's point of view (the problem, not the fix), the vignette ids and their dates, the persona id from the catalogue who holds it if clear, the nearest existing problem id, and why it is not that problem. Read-only.

Mentions:
${issues.map(n => `- ${n.vignette_id} (batch ${n.batch}): ${n.statement} | "${n.quote}" | nearest ${n.nearest_target_id || 'none'}`).join('\n')}`

const [refined, fresh] = await Promise.all([
  parallel(chunks.map((c, i) => () => agent(refinePrompt(c), { label: `refine ${i + 1}`, phase: 'Refine', schema: REFINE, model: 'sonnet', effort: 'medium' }))),
  issues.length ? agent(newPrompt, { label: 'new issues', phase: 'New issues', schema: NEW, model: 'sonnet', effort: 'medium' }) : Promise.resolve({ candidates: [] }),
])

return {
  proposed, kept: links.length, missing_batches: missing,
  links: links.map(({ verdict, ...l }) => l),
  refinements: refined.filter(Boolean).flatMap(r => r.proposals),
  new_problems: fresh ? fresh.candidates : [],
}