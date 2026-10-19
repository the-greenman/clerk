// A session is sometimes a meeting, sometimes a working session or a review at a desk. A decision is ratified (or set aside) in
// exactly one session, at the right level and quorum; before that it may be considered in many, edited in place.
// ONE session record is made in the context's decision log, as the acting actor, then a signed commit and an auto-merge PR.
// Pure practice: no I/O. The adapters (lib/adapters/session.mjs) write the record.
import { buildSourceRef } from './discussion.mjs';

export const MAIN_LOG = 'SemanticOps decision log';
export const PREFIX = 'com.semanticops.programme/';

export const stamp = (d) => d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
export const heldAtIso = (d) => d.toISOString().slice(0, 19) + 'Z';
export const sessionTitle = (d, context) => `Session ${stamp(d)}: ${context}`;

// Draft edits are in place: the field is replaced and git keeps the history. No draft records.
export const FIELDS = { resolution: 'decision_statement', why: 'rationale', options: 'alternatives_considered', review: 'revisit_when', question: 'decision_question' };
export const EX_FIELDS = { thinking: 'thinking_reached', tensions: 'tensions', questions: 'unresolved_questions', blocking: 'blocking', next: 'next_action' };
export const RATIFYING = ['ratify', 'setaside', 'accept', 'other']; // 'receive' is deliberately not here: it needs no quorum

// What an act was, for the provenance list: the action, else the kind of thing added.
const actKind = (p) => p.action ?? (p.comment ? 'comment' : p.edit ? 'edit' : p.proposal ? 'proposal' : p.hold ? 'hold' : p.report ? 'report' : 'consider');

// Every act of the session in the order taken, each with the time the key was pressed (not the write time), its agenda
// position and what had been opened first. Provenance only (D1): never part of a statement, never the record's createdAt.
export const actsInOrder = (choices) => choices.flatMap((c) => (c.acts ?? []).map((a) => ({ ...a, id: c.id, title: c.title }))).sort((a, b) => a.at.localeCompare(b.at));
const seenText = (s) => (s?.length ? `, saw ${s.join(' + ')}` : '');
export const actLine = (a) => `- ${a.at.slice(11, 19)}Z ${a.kind}: ${a.title} [${a.id.slice(0, 8)}]${a.section ? ` (${a.section} ${a.position} of ${a.of}${seenText(a.seen)}${a.updatedAt ? `, record updated ${a.updatedAt}` : ''})` : ''}`;

// Add to what this session does with one decision. patch: { action?, edit?: {field,text}, hold?: bool, note?: string }.
// A decision is ratified/set aside at most once; edits and holds ride along. Without a ratifying action it is `consider`.
export function take(choices, item, patch) {
  let c = choices.find((x) => x.id === item.instanceId);
  if (!c) choices.push(c = { id: item.instanceId, title: item.title, action: 'consider', edits: [], comments: [], ...(item.exercise ? { exercise: true, proposals: [] } : {}) });
  if (patch.action) { c.action = patch.action; c.held = false; }
  if (patch.text !== undefined) c.text = patch.text;
  if (patch.edit) { const F = c.exercise ? EX_FIELDS : FIELDS; if (!F[patch.edit.field]) throw new Error(`unknown field "${patch.edit.field}" (known: ${Object.keys(F).join(', ')})`); c.edits.push(patch.edit); }
  if (patch.comment) c.comments.push(patch.comment); // { text, replyTo?, cite?, role?, note? }; a comment is taking the decision up
  if (patch.proposal) c.proposals.push(patch.proposal); // { question, resolution }: a new proposed decision derived-from the exercise
  if (patch.report) c.report = true; // a working-group report: not a decision, never `considers`
  if (patch.commentOnly) c.commentOnly = true;
  if (patch.act) (c.acts ??= []).push({ ...patch.act, kind: patch.act.kind ?? actKind(patch) }); // provenance of this act: when, where in the agenda, what was seen
  if (patch.hold) { c.action = 'consider'; c.held = true; if (patch.note) c.note = patch.note; }
  return c;
}

// Ratifying or setting aside needs the context's quorum; taking a proposal up (consider/edit/hold) never does.
export function assertQuorum(choices, q) {
  const bad = choices.filter((c) => RATIFYING.includes(c.action));
  if (bad.length && !q.met) throw new Error(`quorum not met (needs ${q.needs}): cannot ratify or set aside ${bad.map((c) => c.title).join(', ')}; a session below quorum can still consider and edit`);
}

// A comment citing "transcript" needs the session's transcript.
export const needsTranscript = (choices) => choices.some((c) => c.comments?.some((m) => m.cite === 'transcript'));

// choices: [{ id, title, action: ratify|setaside|accept|other|consider, text?, edits?: [{field,text}], held?, note? }]
export function summarise(choices, title, attendees = []) {
  const word = { ratify: 'Ratified', accept: 'Ratified (escalation accepted)', other: 'Ratified (escalation, owner chose other)', setaside: 'Set aside' };
  const ref = (c) => `${c.title} [${c.id.slice(0, 8)}]`;
  const lines = choices.flatMap((c) => {
    const out = [];
    if (c.exercise) {
      const did = [c.comments?.length && 'input given', c.edits?.length && 'edited', c.proposals?.length && 'proposal drafted'].filter(Boolean);
      return [`- Exercise: ${c.title}: ${did.join(' / ') || 'considered'}`];
    }
    if (c.action === 'receive') out.push(`- Received: ${c.title}${c.commentOnly ? ' (comment only)' : ''}`);
    if (word[c.action]) out.push(`- ${word[c.action]}: ${ref(c)}`);
    if (c.edits?.length) out.push(`- Edited: ${ref(c)} (${[...new Set(c.edits.map((e) => e.field))].join(', ')})`);
    if (c.comments?.length) out.push(`- Commented: ${ref(c)} (${c.comments.length}${c.comments.some((m) => m.cite) ? ', with citation' : ''})`);
    if (c.held) out.push(`- Held: ${ref(c)}${c.note ? ': ' + c.note : ''}`);
    else if (c.action === 'consider' && !c.report && !c.edits?.length && !c.comments?.length) out.push(`- Considered: ${ref(c)}`);
    return out;
  });
  const acts = actsInOrder(choices);
  return [title, attendees.length ? `Attendees: ${attendees.map((a) => a.name).join(', ')}` : '', ...lines, ...(acts.length ? ['Acts in the order taken (UTC):', ...acts.map(actLine)] : [])].filter(Boolean).join('\n');
}

// Dry-run detail of the comments that would be created.
export const plan = (choices, considers = true) => choices.flatMap((c) => [...(c.proposals ?? []).map((p) => `\n  proposal: new proposed decision "${p.question.slice(0, 60)}" derived-from ${c.title} [${c.id.slice(0, 8)}]; session considers the exercise`),...(c.action === 'receive' && !c.commentOnly ? [`\n  relation receives: session -> ${c.title} [${c.id.slice(0, 8)}]`] : []), ...(c.commentOnly ? [] : c.comments ?? []).map((m) => `\n  comment on ${c.title} [${c.id.slice(0, 8)}]${m.replyTo ? ` (reply to ${m.replyTo.slice(0, 8)})` : ''}: "${m.text.split('\n')[0].slice(0, 80)}"` +
  `${m.cite ? ` sourceRef ${JSON.stringify(buildSourceRef(m.cite, m.role, { transcriptId: '<transcript>', note: m.note }))}` : ''}${considers && !c.report ? '; session considers it' : ''}`)]).join('');

// D4 (docs/decision-log.md): framing checks for a decision as it is recorded. Convention first (e337703b): advice only, never blocks.
// Returns [{ level: 'warn' | 'info', text }].
const NOT_TIMELESS = /\b\d{4}-\d{2}-\d{2}\b|(?:^|[^\w])#\d+\b|\b[0-9a-f]{8}\b(?![-\w])|\b[\w.-]+\/[\w.-]+#\d+\b/;
export function framingWarnings({ statement = '', revisit_when = '', decision_kind = '' } = {}) {
  const w = [];
  if (NOT_TIMELESS.test(statement)) w.push({ level: 'warn', text: 'not timeless: the statement holds a date, issue number or id; move it to context or a relation' });
  if (!String(revisit_when).trim()) w.push({ level: 'warn', text: 'no revisit_when: name an observable condition for review' });
  if (!String(decision_kind).trim()) w.push({ level: 'info', text: 'no decision_kind: purpose, boundary, premise, preference, policy, design or mandate' });
  return w;
}
