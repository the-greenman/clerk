// A session is the unit of ratification: attendees, a date and time, and the decisions acted on. Decisions made between
// sessions are recorded as proposed and acted on within remit; they are ratified (or set aside) here.
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

// choices: [{ id, title, action: ratify|setaside|accept|other, text? }]; attendees: [{ id, name }]
export function summarise(choices, title, attendees = []) {
  const word = { ratify: 'Ratified', accept: 'Ratified (escalation accepted)', other: 'Ratified (escalation, owner chose other)', setaside: 'Set aside' };
  return [title, attendees.length ? `Attendees: ${attendees.map((a) => a.name).join(', ')}` : '', ...choices.map((c) => `- ${word[c.action]}: ${c.title} [${c.id.slice(0, 8)}]`)].filter(Boolean).join('\n');
}

// The one code path for ending a session, used by the TUI and by `clerk session`.
export function endSession({ cli, wt = join(homedir(), 'dev/semanticops/scripts/wt'), now = new Date(), role, choices, attendees, convened = 'ad-hoc', dryRun, log = console.log }) {
  if (!choices.length) return log('No acts to record.');
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
    rel(c.action === 'setaside' ? 'sets-aside' : 'ratifies', c.id);
    if (c.action === 'other') {
      const cur = S(['record', 'get', c.id]).record;
      S(['record', 'update', c.id], { fieldValues: { ...fv({ record: cur }), decision_statement: c.text } });
    }
    if (c.action === 'accept' || c.action === 'other') S(['container', 'members', 'add', role.logId, c.id]);
    S(['record', 'transition', '--id', c.id], { to: c.action === 'setaside' ? 'abandoned' : 'ratified' });
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
