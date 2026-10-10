// A session is sometimes a meeting, sometimes a working session or a review at a desk. A decision is ratified (or set aside) in
// exactly one session, at the right level and quorum; before that it may be considered in many, edited in place.
// ONE session record is made in the context's decision log, as the acting actor, then a signed commit and an auto-merge PR.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { srs, gh } from './io.mjs';
import { fv } from './agenda.mjs';
import { COMMENT_TYPE, COMMENTS_ON, buildSourceRef } from './discussion.mjs';
import { basename } from 'node:path';

const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
export const MAIN_LOG = 'SemanticOps decision log';
const PREFIX = 'com.semanticops.programme/';

export const stamp = (d) => d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
export const heldAtIso = (d) => d.toISOString().slice(0, 19) + 'Z';
export const sessionTitle = (d, context) => `Session ${stamp(d)}: ${context}`;

// Draft edits are in place: the field is replaced and git keeps the history. No draft records.
export const FIELDS = { resolution: 'decision_statement', why: 'rationale', options: 'alternatives_considered', review: 'revisit_when', question: 'decision_question' };
export const EX_FIELDS = { thinking: 'thinking_reached', tensions: 'tensions', questions: 'unresolved_questions', blocking: 'blocking', next: 'next_action' };
export const RATIFYING = ['ratify', 'setaside', 'accept', 'other']; // 'receive' is deliberately not here: it needs no quorum

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
  return [title, attendees.length ? `Attendees: ${attendees.map((a) => a.name).join(', ')}` : '', ...lines].filter(Boolean).join('\n');
}

// Dry-run detail of the comments that would be created.
const plan = (choices, considers = true) => choices.flatMap((c) => [...(c.proposals ?? []).map((p) => `\n  proposal: new proposed decision "${p.question.slice(0, 60)}" derived-from ${c.title} [${c.id.slice(0, 8)}]; session considers the exercise`),...(c.action === 'receive' && !c.commentOnly ? [`\n  relation receives: session -> ${c.title} [${c.id.slice(0, 8)}]`] : []), ...(c.commentOnly ? [] : c.comments ?? []).map((m) => `\n  comment on ${c.title} [${c.id.slice(0, 8)}]${m.replyTo ? ` (reply to ${m.replyTo.slice(0, 8)})` : ''}: "${m.text.split('\n')[0].slice(0, 80)}"` +
  `${m.cite ? ` sourceRef ${JSON.stringify(buildSourceRef(m.cite, m.role, { transcriptId: '<transcript>', note: m.note }))}` : ''}${considers && !c.report ? '; session considers it' : ''}`)]).join('');

const makeRel = (S) => (relationType, target, from) => S(['relation', 'create'], { relationId: randomUUID(), relationType: relationType.includes('/') || relationType === 'derived-from' ? relationType : PREFIX + relationType, sourceInstanceId: from, targetInstanceId: target, createdAt: new Date().toISOString() });

// The one place a comment is written: record (+ optional sourceRef) and its comments-on relation. Used by sessions and by postComments.
function writeComment(S, rel, decisionId, m, transcriptId) {
  const ref = buildSourceRef(m.cite, m.role, { transcriptId, note: m.note });
  const cm = S(['record', 'create', '--type', COMMENT_TYPE], { fieldValues: { comment_text: m.text }, ...(ref ? { sourceRefs: [ref] } : {}) }).record;
  rel(COMMENTS_ON, m.replyTo ?? decisionId, cm.instanceId ?? cm.id);
}

// Comments between sessions are discussion: only comment records and comments-on relations. No session, attended-by,
// considers or quorum. A transcript, if given, is attached as a source document for the comment to cite (nothing to link it to).
export function postComments({ cli, wt = join(homedir(), 'dev/semanticops/scripts/wt'), now = new Date(), choices, transcript, dryRun, clerkedBy, log = console.log }) {
  const ms = choices.flatMap((c) => (c.comments ?? []).map((m) => [c, m]));
  if (!ms.length) return log('No comments to post.');
  if (needsTranscript(choices) && !transcript) throw new Error('a comment cites "transcript" but no transcript was given');
  ms.forEach(([, m]) => buildSourceRef(m.cite, m.role, { transcriptId: 'dry-run', note: m.note }));
  const title = `Comment on ${[...new Set(ms.map(([c]) => c.title))].join(', ')}`;
  if (dryRun) return log(`[dry run] would create ${ms.length} comment${ms.length > 1 ? 's' : ''} (no session), commit, push and open a PR titled "${title}":${transcript ? `\n  attach ${basename(transcript)} as a source document (sessions/${heldAtIso(now).slice(0, 10)})` : ''}${plan(choices, false)}`);
  let slug = `comment-${now.toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
  const base = join(homedir(), 'dev/.wt/srs-programme');
  if (existsSync(join(base, slug))) slug += '-' + randomUUID().slice(0, 4);
  sh(wt, ['new', 'srs-programme', slug]);
  const repo = join(base, slug);
  const S = (args, input) => srs(cli, repo, args, input);
  const rel = makeRel(S);
  const transcriptId = transcript && S(['attachment', 'add', transcript, '--subdir', `sessions/${heldAtIso(now).slice(0, 10)}`, '--title', `Transcript ${basename(transcript)}`]).documentId;
  for (const [c, m] of ms) writeComment(S, rel, c.id, m, transcriptId);
  S(['repo', 'validate']);
  sh('git', ['add', '-A'], repo);
  sh('git', ['commit', '-q', '-m', title], repo);
  sh('git', ['push', '-q', '-u', 'origin', slug], repo);
  const url = gh(['pr', 'create', '-R', 'the-greenman/srs-programme', '--base', 'master', '--head', slug, '--title', title,
    '--body', `Discussion between sessions, posted by the clerk. Comments on ${ms.length} item(s); no session record.${clerkedBy ? `\nClerked by: ${clerkedBy}` : ''}`, '--label', 'gate:auto-merge']).trim();
  log(`Comment posted. PR: ${url}`);
  return url;
}

// The one code path for ending a session, used by the TUI and by `clerk session`.
export function endSession({ cli, wt = join(homedir(), 'dev/semanticops/scripts/wt'), now = new Date(), role, choices, attendees, convened = 'ad-hoc', quorum, transcript, dryRun, clerkedBy, log = console.log }) {
  if (!choices.length) return log('Nothing taken up; no session to record.');
  assertQuorum(choices, quorum);
  if (needsTranscript(choices) && !transcript) throw new Error('a comment cites "transcript" but no transcript was given');
  const refs = (c) => c.comments?.forEach((m) => buildSourceRef(m.cite, m.role, { transcriptId: 'dry-run', note: m.note })); // validate citations before anything is written
  choices.forEach(refs);
  const title = sessionTitle(now, role.context);
  const summary = summarise(choices, title, attendees) + (clerkedBy ? `\nClerked by: ${clerkedBy}` : '');
  if (dryRun) return log(`[dry run] would create a worktree, ONE session record in the ${role.context} log, relations and a PR:\nheld_at: ${heldAtIso(now)} (${convened})\n${summary}${transcript ? `\nTranscript: ${basename(transcript)} attached as a source document (sessions/${heldAtIso(now).slice(0, 10)}) and linked to the session` : ''}${plan(choices)}`);
  let slug = `session-${now.toISOString().slice(0, 10)}`;
  const base = join(homedir(), 'dev/.wt/srs-programme');
  if (existsSync(join(base, slug))) slug += '-' + now.toISOString().slice(11, 16).replace(':', '');
  sh(wt, ['new', 'srs-programme', slug]);
  const repo = join(base, slug);
  const S = (args, input) => srs(cli, repo, args, input);

  const session = S(['record', 'create', '--container', role.logId, '--type', PREFIX + 'session'],
    { fieldValues: { title, held_at: heldAtIso(now), convened, session_status: 'ended', summary } }).record;
  const sid = session.instanceId ?? session.id;
  const rel0 = makeRel(S);
  const rel = (relationType, target, from = sid) => rel0(relationType, target, from);

  let transcriptId;
  if (transcript) { // the transcript is a source document linked to the session record; a comment may cite it
    transcriptId = S(['attachment', 'add', transcript, '--subdir', `sessions/${heldAtIso(now).slice(0, 10)}`, '--title', `Transcript: ${title}`]).documentId;
    S(['attachment', 'link', sid, transcriptId]);
  }
  for (const a of attendees) rel('attended-by', a.id);
  for (const c of choices) {
    const edits = [...(c.action === 'other' ? [{ field: 'resolution', text: c.text }] : []), ...(c.edits ?? [])];
    if (edits.length) { // whole-object update, in place; the decision stays as it is
      const cur = S(['record', 'get', c.id]).record;
      S(['record', 'update', c.id], { fieldValues: { ...fv({ record: cur }), ...Object.fromEntries(edits.map((e) => [(c.exercise ? EX_FIELDS : FIELDS)[e.field], e.text])) } });
    }
    if (c.commentOnly) continue; // a comment-only report lives on GitHub, not in SRS
    if (c.exercise) {
      const did = [c.comments?.length && 'input given', c.edits?.length && 'edited', c.proposals?.length && 'proposal drafted'].filter(Boolean);
      return [`- Exercise: ${c.title}: ${did.join(' / ') || 'considered'}`];
    }
    if (c.action === 'receive') rel('receives', c.id);
    else if (!c.report) rel({ setaside: 'sets-aside', consider: 'considers' }[c.action] ?? 'ratifies', c.id);
    for (const m of c.comments ?? []) writeComment(S, rel0, c.id, m, transcriptId);
    for (const p of c.proposals ?? []) { // a proposal drafted from an exercise: proposed, in the same log, derived-from it
      const d = S(['record', 'create', '--container', role.logId, '--type', 'governance/decision'], { fieldValues: { title: p.question, decision_question: p.question, decision_statement: p.resolution } }).record;
      rel0('derived-from', c.id, d.instanceId ?? d.id);
    }
    if (c.action === 'accept' || c.action === 'other') S(['container', 'members', 'add', role.logId, c.id]);
    if (RATIFYING.includes(c.action)) S(['record', 'transition', '--id', c.id], { to: c.action === 'setaside' ? 'abandoned' : 'ratified' });
  }
  S(['repo', 'validate']);
  sh('git', ['add', '-A'], repo);
  sh('git', ['commit', '-q', '-m', summary], repo);
  sh('git', ['push', '-q', '-u', 'origin', slug], repo);
  const url = gh(['pr', 'create', '-R', 'the-greenman/srs-programme', '--base', 'master', '--head', slug, '--title', title,
    '--body', `A session of the ${role.context} group, recorded by the clerk.\n\n${summary}`, '--label', 'gate:auto-merge']).trim();
  log(`Session recorded. PR: ${url}`);
  return url;
}
