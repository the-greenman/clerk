// End of session: record the owner's choices as ONE attributed ratification-session record in a fresh
// srs-programme worktree, then a signed commit and an auto-merge PR (the owner's own signed act; CI checks validity).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { srs, gh } from './io.mjs';
import { fv } from './agenda.mjs';

const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
export const MAIN_LOG = 'SemanticOps decision log';

// choices: [{ id, title, action: ratify|setaside|accept|other, text? }]
export function summarise(choices, date) {
  const word = { ratify: 'Ratified', accept: 'Ratified (escalation accepted)', other: 'Ratified (escalation, owner chose other)', setaside: 'Set aside' };
  return [`Ratification session ${date}`, ...choices.map((c) => `- ${word[c.action]}: ${c.title} [${c.id.slice(0, 8)}]`)].join('\n');
}

export function endSession({ cli, wt = join(homedir(), 'dev/semanticops/scripts/wt'), date, choices, dryRun, log = console.log }) {
  if (!choices.length) return log('No acts to record.');
  const summary = summarise(choices, date);
  if (dryRun) return log(`[dry run] would create a ratification worktree, record, relations and PR:\n${summary}`);
  let slug = `ratification-${date}`;
  const base = join(homedir(), 'dev/.wt/srs-programme');
  if (existsSync(join(base, slug))) slug += '-' + new Date().toISOString().slice(11, 16).replace(':', '');
  sh(wt, ['new', 'srs-programme', slug]);
  const repo = join(base, slug);
  const S = (args, input) => srs(cli, repo, args, input);

  const mainLog = S(['container', 'list']).containers.find((c) => c.title === MAIN_LOG);
  const session = S(['record', 'create', '--type', 'com.semanticops.programme/ratification-session'],
    { fieldValues: { title: `Ratification session ${date}`, session_date: date, summary } }).record;
  const sid = session.instanceId ?? session.id;

  for (const c of choices) {
    const relationType = c.action === 'setaside' ? 'com.semanticops.programme/sets-aside' : 'com.semanticops.programme/ratifies';
    S(['relation', 'create'], { relationId: randomUUID(), relationType, sourceInstanceId: sid, targetInstanceId: c.id, createdAt: new Date().toISOString() });
    if (c.action === 'other') {
      const cur = S(['record', 'get', c.id]).record;
      S(['record', 'update', c.id], { fieldValues: { ...fv({ record: cur }), decision_statement: c.text } });
    }
    if (c.action === 'accept' || c.action === 'other') S(['container', 'members', 'add', mainLog.containerId, c.id]);
    S(['record', 'transition', '--id', c.id], { to: c.action === 'setaside' ? 'abandoned' : 'ratified' });
  }
  S(['repo', 'validate']);
  sh('git', ['add', '-A'], repo);
  sh('git', ['commit', '-q', '-m', summary], repo);
  sh('git', ['push', '-q', '-u', 'origin', slug], repo);
  const url = gh(['pr', 'create', '-R', 'the-greenman/srs-programme', '--base', 'master', '--head', slug, '--title', `Ratification session ${date}`,
    '--body', `The owner's ratification session, recorded by the clerk.\n\n${summary}`, '--label', 'gate:auto-merge']).trim();
  log(`Session recorded. PR: ${url}`);
  return url;
}
