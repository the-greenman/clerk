// The Confidence and care policy: how confident the programme is in a work item, and how careful the work must be at
// that confidence. Pure. The policy is records (com.semanticops.programme confidence-axis, confidence-grade, care-mode,
// care-rule, in the container the settings name); this module only reads them and answers "is this signal true for this
// item?". Tuning is a record edit, never a code change: the records choose which signals earn which grade, and which grades
// select which mode. adapters/care-policy.mjs reads the records through the pinned srs CLI.
import { answersOf } from './grounding.mjs';

export const NS = 'com.semanticops.programme';
const POLICY_TYPES = { axis: 'confidence-axis', grade: 'confidence-grade', mode: 'care-mode', rule: 'care-rule' };
export const REL = { grades: `${NS}/grades`, selects: `${NS}/selects` };

// The signal catalogue: the one seam between data and code. Each key is what a confidence-grade's signal_keys may name;
// `means` is what the rendered policy says about it. facts: itemFacts() output.
const named = (f, layer, basis) => f.problems.some((p) => p.layer === layer && (!basis || p.basis === basis));
export const SIGNALS = {
  'problem.affirmed': { means: 'The item answers a problem the owner has affirmed (a human fork in Affirmed).', test: (f) => named(f, 'affirmed') },
  'problem.suggested.conversation': { means: 'The item answers a suggested problem with a conversation behind it: written by a human, or its source_ref names a conversation, session, discussion or call.', test: (f) => named(f, 'suggested', 'conversation') },
  'problem.suggested.synthesised': { means: 'The item answers a suggested problem that only an agent produced (a synthesiser or analyst, no conversation basis).', test: (f) => named(f, 'suggested', 'synthesised') },
  'answers.none-yet': { means: 'The item says "No affirmed problem yet: <problem>": it names its problem in words, with no record yet.', test: (f) => f.answers.none !== undefined },
  'answers.stated': { means: 'The item has an Answers: or "No affirmed problem yet:" line at all.', test: (f) => f.answers.stated },
  'domain.affirmed-problem': { means: 'The item answers an affirmed problem held by a persona in a domain: the domain comes from affirmed theory.', test: (f) => f.problems.some((p) => p.layer === 'affirmed' && p.domains?.length) },
  'domain.suggested-problem': { means: 'The item answers a suggested problem held by a persona in a domain: the domain comes from theory not yet affirmed.', test: (f) => f.problems.some((p) => p.layer === 'suggested' && p.domains?.length) },
  'domain.group-label': { means: 'The item carries the wg: label of a working group that holds a domain: someone has placed it with that group.', test: (f) => Boolean(f.domain?.groupLabel) },
  'domain.repo-one-group': { means: 'The item\'s repository is governed by exactly one working group that holds a domain: the domain is inferred from where the item lives.', test: (f) => f.domain?.repoGroups === 1 },
  'domain.repo-shared': { means: 'The item\'s repository is governed by more than one working group that holds a domain: the repository suggests a domain but cannot say which.', test: (f) => (f.domain?.repoGroups ?? 0) > 1 },
  'epic.ranked': { means: 'The item sits under an epic that serves an objective the active period ranks.', test: (f) => Boolean(f.epic?.ranked) },
  'epic.any': { means: 'The item sits under a roadmap epic, ranked or not.', test: (f) => Boolean(f.epic) },
  'ruling.names-fix': { means: 'The item cites a recorded ruling (a "Ruling:" line naming a decision record id) and says what that ruling has it build (a "Fix:" line).', test: (f) => Boolean(f.ruling?.namesFix) },
  'plan.section': { means: 'The item carries a technical plan: a "## Technical plan" section with content, or at least three steps (a checklist or numbered list) with code references or acceptance criteria.', test: (f) => Boolean(f.plan?.section) },
  'owner.directed': { means: 'The owner is driving this work directly: the session actor (SRS_ACTOR) is the settings owner_actor, as in a command-line session.', test: (f) => Boolean(f.ownerDirected) },
};

const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const CLAUSE = /^(?:signal:([\w.-]+)|([a-z_]+)\s*>=\s*([a-z_]+))$/;
// "technical_plan>=high" -> {axis, level}; "signal:owner.directed" -> {signal}; else null
export function parseClause(text) {
  const m = CLAUSE.exec(String(text).trim());
  return !m ? null : m[1] ? { signal: m[1] } : { axis: m[2], level: m[3] };
}

// {records: `srs record list` rows, relations: [{relationType, sourceId, targetId}], vocabularies} -> the policy, in order.
// Records outside the policy container are the caller's to exclude. The scale is the confidence_level vocabulary, lowest first.
export function policyFrom({ records = [], relations = [], vocabularies = [] }) {
  const scale = vocabularies.find((v) => v.namespace === NS && v.name === 'confidence_level')?.terms.map((t) => t.key) ?? [];
  const of = (t) => records.filter((r) => r.record.typeName === t).map((r) => ({ id: r.instanceId, fv: r.record.fieldValues ?? {} }));
  const out = (type, id) => relations.filter((l) => l.relationType === type && l.sourceId === id).map((l) => l.targetId);
  const byOrder = (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || String(a.title).localeCompare(String(b.title));
  const grades = of(POLICY_TYPES.grade).map(({ id, fv }) => ({ id, title: fv.policy_title, level: fv.confidence_level, signals: asList(fv.signal_keys), explanation: fv.policy_explanation, axisIds: out(REL.grades, id) }));
  const axes = of(POLICY_TYPES.axis).map(({ id, fv }) => ({ id, key: fv.policy_key, title: fv.policy_title, explanation: fv.policy_explanation, order: fv.policy_order,
    grades: grades.filter((g) => g.axisIds.includes(id)).sort((a, b) => scale.indexOf(b.level) - scale.indexOf(a.level)) })).sort(byOrder);
  const modes = of(POLICY_TYPES.mode).map(({ id, fv }) => ({ id, key: fv.policy_key, title: fv.policy_title, explanation: fv.policy_explanation, must: asList(fv.care_must), mergeGate: fv.merge_gate }));
  const rules = of(POLICY_TYPES.rule).map(({ id, fv }) => ({ id, title: fv.policy_title, order: fv.policy_order, allOf: asList(fv.rule_all_of), anyOf: asList(fv.rule_any_of), explanation: fv.policy_explanation,
    modeIds: out(REL.selects, id) })).sort(byOrder)
    .map((r) => ({ ...r, mode: modes.find((m) => r.modeIds.includes(m.id))?.key }));
  return { scale, axes, grades, modes, rules };
}

// policy -> [error strings]; empty means the clerk can act on it. A policy the clerk cannot act on stops the run (never a guess).
export function checkPolicy(policy, signals = SIGNALS) {
  const errs = [], { scale, axes, grades, modes, rules } = policy;
  if (scale.length < 2) errs.push('no confidence_level scale installed (com.semanticops.programme vocabulary confidence_level)');
  if (!axes.length) errs.push('the policy has no confidence-axis records');
  if (!modes.length) errs.push('the policy has no care-mode records');
  if (!rules.length) errs.push('the policy has no care-rule records');
  const dup = (xs, what) => { const seen = new Set(); for (const x of xs) { if (seen.has(x)) errs.push(`two ${what} share "${x}"`); seen.add(x); } };
  dup(axes.map((a) => a.key), 'axes'); dup(modes.map((m) => m.key), 'care modes'); dup(rules.map((r) => r.order), 'rules (policy_order)');
  for (const a of axes) if (!a.key) errs.push(`axis "${a.title}" has no policy_key`);
  for (const g of grades) {
    if (g.axisIds.length !== 1) errs.push(`grade "${g.title}" needs exactly one grades relation to an axis (has ${g.axisIds.length})`);
    if (!scale.includes(g.level)) errs.push(`grade "${g.title}" has level "${g.level}", not on the scale (${scale.join(', ')})`);
    for (const s of g.signals) if (!signals[s]) errs.push(`grade "${g.title}" names signal "${s}", which the clerk does not implement`);
  }
  for (const a of axes) dup(a.grades.map((g) => g.level), `grades of axis ${a.key}`);
  for (const r of rules) {
    if (r.modeIds.length !== 1 || !r.mode) errs.push(`rule "${r.title}" needs exactly one selects relation to a care mode`);
    for (const c of [...r.allOf, ...r.anyOf]) {
      const p = parseClause(c);
      if (!p) errs.push(`rule "${r.title}" clause "${c}" is neither <axis>>=<level> nor signal:<key>`);
      else if (p.signal && !signals[p.signal]) errs.push(`rule "${r.title}" names signal "${p.signal}", which the clerk does not implement`);
      else if (p.axis && !axes.some((a) => a.key === p.axis)) errs.push(`rule "${r.title}" names axis "${p.axis}", which has no record`);
      else if (p.level && !scale.includes(p.level)) errs.push(`rule "${r.title}" names level "${p.level}", not on the scale`);
    }
  }
  const last = rules[rules.length - 1];
  if (last && (last.allOf.length || last.anyOf.length)) errs.push(`the last rule ("${last.title}") must have no clauses, so every item gets a mode`);
  return errs;
}

// Per problem_id: its layer and basis, pooled across its copies (a fork shares the problem_id of its suggestion).
// records: `srs record list` rows; layers: {affirmed: Set<instanceId>, suggested: Set, setAside: Set}
// -> {'SP-nn': {layer: 'affirmed'|'suggested'|'set-aside'|null, basis: 'conversation'|'synthesised'}}
const CONVERSATION = /conversation|session|discussion|call|meeting|chat/i;
// domainsOf: {problem instanceId: [domain ids]} (problemDomains()); a problem's domains pool across its copies.
export function problemFacts(records, layers = {}, domainsOf = {}) {
  const out = {};
  for (const r of records.filter((x) => x.record.typeName === 'problem')) {
    const id = r.record.fieldValues?.problem_id;
    if (!id) continue;
    const p = out[id] ??= { layer: null, basis: 'synthesised', domains: [] };
    p.domains = [...new Set([...p.domains, ...(domainsOf[r.instanceId] ?? [])])];
    const layer = layers.affirmed?.has(r.instanceId) ? 'affirmed' : layers.suggested?.has(r.instanceId) ? 'suggested' : layers.setAside?.has(r.instanceId) ? 'set-aside' : null;
    const rank = { affirmed: 3, suggested: 2, 'set-aside': 1 };
    if ((rank[layer] ?? 0) > (rank[p.layer] ?? 0)) p.layer = layer;
    if (r.record.createdBy?.kind === 'human' || asList(r.record.fieldValues?.source_ref).some((s) => CONVERSATION.test(s))) p.basis = 'conversation';
  }
  return out;
}

// A problem's domains are derived, never stored: problem held-by a persona-in-domain, which is in-domain a domain.
// relations: [{relationType, sourceId, targetId}] -> {problem instanceId: [domain ids]}
export function problemDomains(relations = []) {
  const heldBy = relations.filter((r) => r.relationType.endsWith('/held-by')), inDomain = relations.filter((r) => r.relationType.endsWith('/in-domain'));
  const out = {};
  for (const h of heldBy) for (const d of inDomain.filter((x) => x.sourceId === h.targetId)) (out[h.sourceId] ??= []).push(d.targetId);
  return out;
}

// Does a body carry a technical plan? Either a "## Technical plan" section with content, or a plan in substance: at least
// three steps (a checklist or a numbered list) with code references (three or more) or acceptance criteria. Issues written
// with detailed steps carry their plan without the heading, and must not be held for the lack of one.
const STEPS = /^\s*(?:[-*] \[[ xX]\]|\d+[.)])\s+\S/gm;
const CODE_REFS = /`[^`\n]{3,}`|\b[\w-]+\/[\w./-]+\.(?:rs|mjs|js|ts|svelte|json|md|yml)\b/g;
const ACCEPTANCE = /acceptance|done when|definition of done|exit 0|\bassert/i;
export function technicalPlanOf(body = '') {
  const b = body ?? '';
  const m = /^#{2,3}\s*Technical plan\b[^\n]*\n([\s\S]*?)(?=^#{1,3}\s|(?![\s\S]))/im.exec(b);
  if (m && m[1].trim()) return true;
  return (b.match(STEPS) ?? []).length >= 3 && ((b.match(CODE_REFS) ?? []).length >= 3 || ACCEPTANCE.test(b));
}

// The rulings an item cites and whether it says which fix: a "Ruling:" line naming decision record ids
// (decision-xxxxxxxx, rfc-decision-xxxxxxxx) and a "Fix:" line with content. texts: body and comments.
export function rulingOf(texts = []) {
  const all = texts.map((t) => t ?? '').join('\n');
  const line = /^[\s>*_-]*Ruling:?\s*(.+)$/im.exec(all)?.[1] ?? '';
  const cited = [...line.matchAll(/\b(?:rfc-)?decision-[0-9a-f]{8}\b/g)].map((m) => m[0]);
  return { cited, namesFix: cited.length > 0 && /^[\s>*_-]*Fix:?\s*\S/im.test(all) };
}

// The roadmap epic an item sits under: the item itself or the nearest parent that is an epic. epics: roadmap derive()'s
// epics [{refs, parked}]; refs: the item's ref, then its parent chain, nearest first. -> {ref, ranked} | null
export function epicOf(epics = [], refs = []) {
  for (const ref of refs) { const e = epics.find((x) => (x.refs ?? [x.ref]).includes(ref)); if (e) return { ref, ranked: !e.parked }; }
  return null;
}

// The facts the signals read, from what the adapter fetched. item: {body, comments:[body]};
// problems: problemFacts(); epic: {ranked}|null; ruling: {namesFix} (default: rulingOf the item); actor, ownerActor: actor ids.
// labels: the item's label names; repo: its repository name; groups: loadGroups() ({label, repos, domains}).
export function itemFacts({ item = {}, problems = {}, epic = null, ruling, actor, ownerActor, labels = [], repo, groups = [] }) {
  const texts = [item.body, ...(item.comments ?? [])].map((t) => t ?? '');
  const answers = texts.map(answersOf).find((a) => a.stated) ?? answersOf('');
  return {
    answers,
    problems: answers.problems.map((id) => ({ id, ...(problems[id] ?? { layer: null, basis: 'synthesised', domains: [] }) })),
    domain: { groupLabel: groups.some((g) => g.domains?.length && labels.includes(g.label)), repoGroups: groups.filter((g) => g.domains?.length && g.repos?.includes(repo)).length },
    epic, ruling: ruling ?? rulingOf(texts),
    plan: { section: texts.some(technicalPlanOf) },
    ownerDirected: Boolean(actor && ownerActor && actor === ownerActor),
  };
}

// policy, facts -> {grades: {axis: level}, because: {axis: [signal]}, signals: [true keys], rule, mode}
export function evaluate(policy, facts, signals = SIGNALS) {
  const { scale } = policy, at = (l) => scale.indexOf(l);
  const truth = Object.fromEntries(Object.entries(signals).map(([k, s]) => [k, Boolean(s.test(facts))]));
  const grades = {}, because = {};
  for (const a of policy.axes) {
    const g = a.grades.find((x) => x.signals.some((s) => truth[s]));
    grades[a.key] = g ? g.level : scale[0];
    because[a.key] = g ? g.signals.filter((s) => truth[s]) : [];
  }
  const holds = (c) => { const p = parseClause(c); return p?.signal ? truth[p.signal] : p ? at(grades[p.axis]) >= at(p.level) : false; };
  const rule = policy.rules.find((r) => r.allOf.every(holds) && (!r.anyOf.length || r.anyOf.some(holds)));
  return { grades, because, signals: Object.keys(truth).filter((k) => truth[k]), rule: rule ? { title: rule.title, order: rule.order } : null,
    mode: rule ? policy.modes.find((m) => m.key === rule.mode) ?? null : null };
}

// result -> lines a person reads (clerk care --explain, the claim comment's first line).
export function explain(policy, result) {
  const lines = policy.axes.map((a) => `${a.title}: ${result.grades[a.key]}${result.because[a.key].length ? ` (${result.because[a.key].join(', ')})` : ''}`);
  lines.push(result.mode ? `Mode: ${result.mode.title} (${result.mode.key}), by rule ${result.rule.order}: ${result.rule.title}` : 'Mode: none (no rule matched; the policy needs a fallback rule)');
  for (const m of result.mode?.must ?? []) lines.push(`  must: ${m}`);
  return lines;
}
