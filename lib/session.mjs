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

const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
export const MAIN_LOG = 'SemanticOps decision log';
const PREFIX = 'com.semanticops.programme/';

export const stamp = (d) => d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
export const heldAtIso = (d) => d.toISOString().slice(0, 19) + 'Z';
export const sessionTitle = (d, context) => `Session ${stamp(d)}: ${context}`;

// Draft edits are in place: the field is replaced and git keeps the history. No draft records.
export const FIELDS = { resolution: 'decision_statement', why: 'rationale', options: 'alternatives_considered', review: 'revisit_when', question: 'decision_question' };
export const RATIFYING = ['ratify', 'setaside', 'accept', 'other'];

// Add to what this session does with one decision. patch: { action?, edit?: {field,text}, hold?: bool, note?: string }.
// A decision is ratified/set aside at most once; edits and holds ride along. Without a ratifying action it is `consider`.
export function take(choices, item, patch) {
  let c = choices.find((x) => x.id === item.instanceId);
  if (!c) choices.push(c = { id: item.instanceId, title: item.title, action: 'consider', edits: [] });
  if (patch.action) { c.action = patch.action; c.held = false; }
  if (patch.text !== undefined) c.text = patch.text;
  if (patch.edit) { if (!FIELDS[patch.edit.field]) throw new Error(`unknown field "${patch.edit.field}" (known: ${Object.keys(FIELDS).join(', ')})`); c.edits.push(patch.edit); }
  if (patch.hold) { c.action = 'consider'; c.held = true; if (patch.note) c.note = patch.note; }
  return c;
}

// Ratifying or setting aside needs the context's quorum; taking a proposal up (consider/edit/hold) never does.
export function assertQuorum(choices, q) {
  const bad = choices.filter((c) => RATIFYING.includes(c.action));
  if (bad.length && !q.met) throw new Error(`quorum not met (needs ${q.needs}): cannot ratify or set aside ${bad.map((c) => c.title).join(', ')}; a session below quorum can still consider and edit`);
}

// choices: [{ id, title, action: ratify|setaside|accept|other|consider, text?, edits?: [{field,text}], held?, note? }]
export function summarise(choices, title, attendees = []) {
  const word = { ratify: 'Ratified', accept: 'Ratified (escalation accepted)', other: 'Ratified (escalation, owner chose other)', setaside: 'Set aside' };
  const ref = (c) => `${c.title} [${c.id.slice(0, 8)}]`;
  const lines = choices.flatMap((c) => {
    const out = [];
    if (word[c.action]) out.push(`- ${word[c.action]}: ${ref(c)}`);
    if (c.edits?.length) out.push(`- Edited: ${ref(c)} (${[...new Set(c.edits.map((e) => e.field))].join(', ')})`);
    if (c.held) out.push(`- Held: ${ref(c)}${c.note ? ': ' + c.note : ''}`);
    else if (c.action === 'consider' && !c.edits?.length) out.push(`- Considered: ${ref(c)}`);
    return out;
  });
  return [title, attendees.length ? `Attendees: ${attendees.map((a) => a.name).join(', ')}` : '', ...lines].filter(Boolean).join('\n');
}

// The one code path for ending a session, used by the TUI and by `clerk session`.
export function endSession({ cli, wt = join(homedir(), 'dev/semanticops/scripts/wt'), now = new Date(), role, choices, attendees, convened = 'ad-hoc', quorum, dryRun, log = console.log }) {
  if (!choices.length) return log('Nothing taken up; no session to record.');
  assertQuorum(choices, quorum);
  const title = sessionTitle(now, role.context);
  const summary = summarise(choices, title, attendees);
  if (dryRun) return log(`[dry run] would create a worktree, ONE session record in the ${role.context} log, relations and a PR:\nheld_at: ${heldAtIso(now)} (${convened})\n${summary}`);
  let slug = `session-${now.toISOString().slice(0, 10)}`;
  const base = join(homedir(), 'dev/.wt/srs-programme');
  if (existsSync(join(base, slug))) slug += '-' + now.toISOString().slice(11, 16).replace(':', '');
  sh(wt, ['new', 'srs-programme', slug]);
  const repo = join(base, slug);
  const S = (args, input) => srs(cli, repo, args, input);

  const session = S(['record', 'create', '--container', role.logId, '--type', PREFIX + 'session'],
    { fieldValues: { title, held_at: heldAtIso(now), convened, session_status: 'ended', summary } }).record;
  const sid = session.instanceId ?? session.id;
  const rel = (relationType, target) => S(['relation', 'create'], { relationId: randomUUID(), relationType: PREFIX + relationType, sourceInstanceId: sid, targetInstanceId: target, createdAt: new Date().toISOString() });

  for (const a of attendees) rel('attended-by', a.id);
  for (const c of choices) {
    const edits = [...(c.action === 'other' ? [{ field: 'resolution', text: c.text }] : []), ...(c.edits ?? [])];
    if (edits.length) { // whole-object update, in place; the decision stays as it is
      const cur = S(['record', 'get', c.id]).record;
      S(['record', 'update', c.id], { fieldValues: { ...fv({ record: cur }), ...Object.fromEntries(edits.map((e) => [FIELDS[e.field], e.text])) } });
    }
    rel({ setaside: 'sets-aside', consider: 'considers' }[c.action] ?? 'ratifies', c.id);
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
