// A session is sometimes a meeting, sometimes a working session or a review at a desk. A decision is ratified (or set aside) in
// exactly one session, at the right level and quorum; before that it may be considered in many, edited in place.
// ONE session record is made in the context's decision log, as the acting actor, then a signed commit and an auto-merge PR.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { srs, gh } from './cli.mjs';
import { fv } from '../practice/agenda.mjs';
import { COMMENT_TYPE, COMMENTS_ON, buildSourceRef } from '../practice/discussion.mjs';
import { PREFIX, FIELDS, EX_FIELDS, stamp, heldAtIso, sessionTitle, summarise, plan, MAIN_LOG, assertQuorum, needsTranscript, RATIFYING, framingWarnings } from '../practice/session.mjs';

// Repos that disallow auto-merge throw here; the gate:auto-merge label lets pr-upkeep merge instead.
const autoMerge = (url, log) => { try { gh(['pr', 'merge', url, '--auto', '--merge']); } catch { log(`auto-merge not enabled; pr-upkeep merges ${url} by its gate:auto-merge label`); } };
const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const makeRel = (S) => (relationType, target, from) => S(['relation', 'create'], { relationId: randomUUID(), relationType: relationType.includes('/') || relationType === 'derived-from' ? relationType : PREFIX + relationType, sourceInstanceId: from, targetInstanceId: target, createdAt: new Date().toISOString() });

// The one place a comment is written: record (+ optional sourceRef) and its comments-on relation. Used by sessions and by postComments.
function writeComment(S, rel, decisionId, m, transcriptId) {
  const ref = buildSourceRef(m.cite, m.role, { transcriptId, note: m.note });
  const cm = S(['record', 'create', '--type', COMMENT_TYPE], { fieldValues: { comment_text: m.text }, ...(ref ? { sourceRefs: [ref] } : {}) }).record;
  rel(COMMENTS_ON, m.replyTo ?? decisionId, cm.instanceId ?? cm.id);
}

// Comments between sessions are discussion: only comment records and comments-on relations. No session, attended-by,
// considers or quorum. A transcript, if given, is attached as a source document for the comment to cite (nothing to link it to).
export function postComments({ cli, programme, wt = fileURLToPath(new URL('../../scripts/wt', import.meta.url)), now = new Date(), choices, transcript, dryRun, clerkedBy, log = console.log }) {
  const ms = choices.flatMap((c) => (c.comments ?? []).map((m) => [c, m]));
  if (!ms.length) return log('No comments to post.');
  if (needsTranscript(choices) && !transcript) throw new Error('a comment cites "transcript" but no transcript was given');
  ms.forEach(([, m]) => buildSourceRef(m.cite, m.role, { transcriptId: 'dry-run', note: m.note }));
  const title = `Comment on ${[...new Set(ms.map(([c]) => c.title))].join(', ')}`;
  if (dryRun) return log(`[dry run] would create ${ms.length} comment${ms.length > 1 ? 's' : ''} (no session), commit, push and open a PR titled "${title}":${transcript ? `\n  attach ${basename(transcript)} as a source document (sessions/${heldAtIso(now).slice(0, 10)})` : ''}${plan(choices, false)}`);
  let slug = `comment-${now.toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
  const base = programme.wtBase;
  if (existsSync(join(base, slug))) slug += '-' + randomUUID().slice(0, 4);
  sh(wt, ['new', programme.name, slug]);
  const repo = join(base, slug);
  const S = (args, input) => srs(cli, repo, args, input);
  const rel = makeRel(S);
  const transcriptId = transcript && S(['attachment', 'add', transcript, '--subdir', `sessions/${heldAtIso(now).slice(0, 10)}`, '--title', `Transcript ${basename(transcript)}`]).documentId;
  for (const [c, m] of ms) writeComment(S, rel, c.id, m, transcriptId);
  S(['repo', 'validate']);
  sh('git', ['add', '-A'], repo);
  sh('git', ['commit', '-q', '-m', title], repo);
  sh('git', ['push', '-q', '-u', 'origin', slug], repo);
  const url = gh(['pr', 'create', '-R', programme.slug, '--base', programme.defaultBranch, '--head', slug, '--title', title,
    '--body', `Discussion between sessions, posted by the clerk. Comments on ${ms.length} item(s); no session record.${clerkedBy ? `\nClerked by: ${clerkedBy}` : ''}`, '--label', 'gate:auto-merge']).trim();
  autoMerge(url, log); // a session PR is the record of ratification: nothing left to review, so it merges on green (gate:auto-merge stays as the upkeep fallback)
  log(`Comment posted. PR: ${url}`);
  return url;
}

// The one code path for ending a session, used by the TUI and by `clerk session`.
export function endSession({ cli, programme, wt = fileURLToPath(new URL('../../scripts/wt', import.meta.url)), now = new Date(), role, choices, attendees, convened = 'ad-hoc', quorum, transcript, dryRun, clerkedBy, log = console.log }) {
  if (!choices.length) return log('Nothing taken up; no session to record.');
  assertQuorum(choices, quorum);
  if (needsTranscript(choices) && !transcript) throw new Error('a comment cites "transcript" but no transcript was given');
  const refs = (c) => c.comments?.forEach((m) => buildSourceRef(m.cite, m.role, { transcriptId: 'dry-run', note: m.note })); // validate citations before anything is written
  choices.forEach(refs);
  const title = sessionTitle(now, role.context);
  const summary = summarise(choices, title, attendees) + (clerkedBy ? `\nClerked by: ${clerkedBy}` : '');
  if (dryRun) return log(`[dry run] would create a worktree, ONE session record in the ${role.context} log, relations and a PR:\nheld_at: ${heldAtIso(now)} (${convened})\n${summary}${transcript ? `\nTranscript: ${basename(transcript)} attached as a source document (sessions/${heldAtIso(now).slice(0, 10)}) and linked to the session` : ''}${plan(choices)}`);
  let slug = `session-${now.toISOString().slice(0, 10)}`;
  const base = programme.wtBase;
  if (existsSync(join(base, slug))) slug += '-' + now.toISOString().slice(11, 16).replace(':', '');
  sh(wt, ['new', programme.name, slug]);
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
      for (const w of framingWarnings({ statement: p.resolution, revisit_when: p.review, decision_kind: p.kind })) log(`${w.level}: proposal "${p.question.slice(0, 40)}": ${w.text}`);
      const d = S(['record', 'create', '--container', role.logId, '--type', 'governance/decision'], { fieldValues: { title: p.question, decision_question: p.question, decision_statement: p.resolution } }).record;
      rel0('derived-from', c.id, d.instanceId ?? d.id);
      S(['record', 'transition', '--id', d.instanceId ?? d.id], { to: 'proposed' }); // new decisions start as draft; a proposal must show on the next agenda
    }
    if (c.action === 'accept' || c.action === 'other') S(['container', 'members', 'add', role.logId, c.id]);
    if (RATIFYING.includes(c.action)) S(['record', 'transition', '--id', c.id], { to: c.action === 'setaside' ? 'abandoned' : 'ratified' });
  }
  S(['repo', 'validate']);
  sh('git', ['add', '-A'], repo);
  sh('git', ['commit', '-q', '-m', summary], repo);
  sh('git', ['push', '-q', '-u', 'origin', slug], repo);
  const url = gh(['pr', 'create', '-R', programme.slug, '--base', programme.defaultBranch, '--head', slug, '--title', title,
    '--body', `A session of the ${role.context} group, recorded by the clerk.\n\n${summary}`, '--label', 'gate:auto-merge']).trim();
  autoMerge(url, log); // a session PR is the record of ratification: nothing left to review, so it merges on green (gate:auto-merge stays as the upkeep fallback)
  log(`Session recorded. PR: ${url}`);
  return url;
}
