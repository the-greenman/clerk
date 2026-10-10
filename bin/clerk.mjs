#!/usr/bin/env node
// clerk: act by role, human or AI. Interactive (TUI) or `clerk session` (non-interactive); both end in the same endSession.
// Read-only until a key is pressed; Ack and Merge act at once, Ratify/Decide on end of session.
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { OWNER_LOG, GROUP_LOG } from '../lib/roles.mjs';
import { srsCli, srs, gh, ghJson, groupState, openUrl } from '../lib/io.mjs';
import * as A from '../lib/agenda.mjs';
import * as D from '../lib/discussion.mjs';
import { endSession, postComments, stamp, take, FIELDS, needsTranscript } from '../lib/session.mjs';
import { authorise, resolveContext, quorum, quorumText } from '../lib/roles.mjs';

const argv = process.argv.slice(2);
const sub = argv[0] === 'session' || argv[0] === 'comment';
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const args = (n) => argv.flatMap((v, i) => (v === n ? [argv[i + 1]] : []));
const die = (m) => { console.error('clerk: ' + m); process.exit(1); };
const USAGE = 'usage: clerk [session] --repo <srs-programme path> --as <role> [--dry-run]\n  clerk session ... [--attendee <record-id>]... [--ratify <id|all>]... [--set-aside <id>]... [--consider <id>]... [--transcript <file>]\n                   clerk comment --repo <path> --as <role> --on <id> --text <text> [--reply-to <commentId>] [--cite <docId|url|transcript>] [--role-of-cite quoted-from|evidence]\n                   [--edit <id> --field <resolution|why|options|review|question> --text <text>]...  (--ratify/--set-aside need the context\'s quorum)';
if (!arg('--as')) die(USAGE);
const repo = resolve(arg('--repo') ?? die('--repo is required'));
let roleCfg; try { roleCfg = authorise(arg('--as'), process.env.SRS_ACTOR); } catch (e) { die(e.message); }
const isOwner = arg('--as') === 'owner';
const dryRun = argv.includes('--dry-run');

const REPOS = ['semanticops.com', 'srs', 'srs-rust', 'srs-web', 'srs-vscode', 'srs-programme', 'srs-context', 'muDemocracy.org'];
const REPORT_ISSUE = 'the-greenman/semanticops.com/issues/31';

const cli = srsCli(repo);
const S = (a, i) => srs(cli, repo, a, i);
const listed = S(['record', 'list', '--type', 'governance/decision']);
const records = listed.records ?? listed.instances;
const containers = S(['container', 'list']).containers;
const getLog = (id) => S(['container', 'get', id]).container;
const ownerLog = getLog(containers.find((c) => c.title === OWNER_LOG).containerId);
const rolesList = S(['record', 'list', '--type', 'governance/role']);
const agentsList = S(['record', 'list', '--type', 'com.mudemocracy.stewardship/agent']);
const people = [...(rolesList.records ?? rolesList.instances), ...(agentsList.records ?? agentsList.instances)]
  .map((r) => ({ id: r.instanceId, name: r.record.fieldValues?.title ?? r.instanceId }));
const role = resolveContext(roleCfg, rolesList.records ?? rolesList.instances, containers);
const mainLog = getLog(role.logId);
const groupLog = getLog(GROUP_LOG);
// Parent contexts: the SemanticOps log is the parent of every group log; the owner's log has none.
const parentLogs = role.logId === ownerLog.containerId ? [] : [ownerLog];
const selfId = role.agentId ?? role.roleId; // a group role attends as its own agent record, so quorum counts distinct members
const attendees = [people.find((p) => p.id === selfId) ?? { id: selfId, name: arg('--as') }];
const addAttendee = (idOrPrefix) => {
  const m = people.filter((p) => p.id.startsWith(idOrPrefix));
  if (m.length !== 1) throw new Error(`no single role or agent record matches "${idOrPrefix}"`);
  if (!attendees.some((a) => a.id === m[0].id)) attendees.push(m[0]);
};
const now = new Date();
// Earlier sessions that took each decision up (`considers`); tolerant of a repository without the relation type.
let consideredRels = [], sessionRecs = [];
try {
  consideredRels = S(['relation', 'list', '--type', 'com.semanticops.programme/considers']).relations ?? [];
  const sl = S(['record', 'list', '--type', 'com.semanticops.programme/session']); sessionRecs = sl.records ?? sl.instances ?? [];
} catch { /* no considers type yet: no history */ }
let commentRecs = [], commentRels = [];
try { // the comments package may be absent: no discussion
  const cl = S(['record', 'list', '--type', D.COMMENT_TYPE]); commentRecs = cl.records ?? cl.instances ?? [];
  commentRels = S(['relation', 'list', '--type', D.COMMENTS_ON]).relations ?? [];
} catch { /* no discussion */ }
const threadOf = (r) => D.thread(r.instanceId, commentRels, commentRecs);
const history = (r) => A.consideredIn(r.instanceId, consideredRels, sessionRecs);
const quorumNow = () => quorum(role, attendees);

// Non-interactive: the same endSession the TUI ends with.
if (sub) {
  try {
    args('--attendee').forEach(addAttendee);
    if ((args('--ratify').length || args('--set-aside').length) && !quorumNow().met) throw new Error(`${quorumText(quorumNow())}: --ratify/--set-aside refused; --consider and --edit are still allowed`);
    const items = A.ratifyItems(records, mainLog, parentLogs);
    const pick = (p) => { const m = items.filter((r) => r.instanceId.startsWith(p)); if (m.length !== 1) throw new Error(`no single proposed decision matches "${p}"`); return m[0]; };
    const pool = [...items, ...(isOwner ? A.escalationItems(records, groupLog, mainLog) : [])];
    const find = (p) => { const m = pool.filter((r) => r.instanceId.startsWith(p)); if (m.length !== 1) throw new Error(`no single decision on the agenda matches "${p}"`); return m[0]; };
    const item = (r) => ({ instanceId: r.instanceId, title: A.fv(r).title });
    const choices = [];
    const transcript = arg('--transcript') && resolve(arg('--transcript'));
    if (argv[0] === 'comment') { // the same take() + endSession as the TUI's [c]omment
      const reply = arg('--reply-to') && (() => { const m = commentRecs.filter((c) => c.instanceId.startsWith(arg('--reply-to'))); if (m.length !== 1) throw new Error(`no single comment matches "${arg('--reply-to')}"`); return m[0].instanceId; })();
      take(choices, item(find(arg('--on') ?? die('--on <decision id> is required'))), { comment: { text: arg('--text') ?? die('--text is required'), replyTo: reply, cite: arg('--cite'), role: arg('--role-of-cite') } });
    }
    if (argv[0] === 'comment') { postComments({ cli, now, choices, transcript, dryRun, clerkedBy: arg('--clerked-by') }); process.exit(0); } // discussion between sessions: no session record, no quorum
    args('--set-aside').forEach((p) => take(choices, item(pick(p)), { action: 'setaside' }));
    args('--ratify').flatMap((p) => (p === 'all' ? items : [pick(p)])).filter((r) => !choices.some((c) => c.id === r.instanceId)).forEach((r) => take(choices, item(r), { action: 'ratify' }));
    args('--consider').forEach((p) => take(choices, item(find(p)), {}));
    const [fs, ts] = [args('--field'), args('--text')];
    args('--edit').forEach((p, i) => { if (!fs[i] || ts[i] === undefined) throw new Error('--edit <id> needs a matching --field and --text'); take(choices, item(find(p)), { edit: { field: fs[i], text: ts[i] } }); });
    if (dryRun) console.log(quorumText(quorumNow()));
    endSession({ cli, now, role, attendees, convened: 'ad-hoc', quorum: quorumNow(), transcript, dryRun, choices, clerkedBy: arg('--clerked-by') });
  } catch (e) { die(e.message); }
  process.exit(0);
}

// Lines from stdin, one per prompt; end of input answers q so piped runs terminate.
// In a terminal: menu keys act on a single press (raw mode), text answers take a line. Piped (tests, dry runs):
// one line per prompt, and end of input answers q so piped runs terminate.
const TTY = process.stdin.isTTY;
let ask, key;
if (TTY) {
  ask = (p) => new Promise((res) => { const r = createInterface({ input: process.stdin, output: process.stdout, terminal: true }); r.question(p, (a) => { r.close(); res(a.trim()); }); });
  key = (p) => new Promise((res) => {
    process.stdout.write(p); process.stdin.setRawMode(true); process.stdin.resume();
    process.stdin.once('data', (d) => {
      process.stdin.setRawMode(false); process.stdin.pause();
      const c = d.toString();
      if (c === '\u0003') { process.stdout.write('\n'); process.exit(130); } // Ctrl-C
      const k = c.trim().slice(0, 1); process.stdout.write(k + '\n'); res(k.toLowerCase());
    });
  });
} else {
  const rl = createInterface({ input: process.stdin }); const buf = []; let waiting = null; let ended = false;
  rl.on('line', (l) => { if (waiting) { const w = waiting; waiting = null; w(l); } else buf.push(l); });
  rl.on('close', () => { ended = true; if (waiting) { const w = waiting; waiting = null; w('q'); } });
  ask = (p) => { process.stdout.write(p); return new Promise((res) => { if (buf.length) res(buf.shift()); else if (ended) res('q'); else waiting = res; }).then((a) => { console.log(a); return a.trim(); }); };
  key = ask;
}
const show = (ls) => console.log('\n' + ls.join('\n'));

const owner = isOwner ? gh(['api', 'user', '-q', '.login']).trim() : '';
const comments = !isOwner ? [] : gh(['api', `repos/${REPORT_ISSUE}/comments`, '--paginate', '--jq', '.[]|{id,body,created_at,author_association,html_url}'])
  .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
// ponytail: only the latest 5 reports are checked for a +1; older ones are history.
const reports = comments.filter((c) => c.author_association === 'OWNER' && A.REPORT_MARK.test(c.body)).slice(-5);
const reactions = Object.fromEntries(reports.map((c) => [c.id, ghJson(['api', `repos/${REPORT_ISSUE.split('/issues')[0]}/issues/comments/${c.id}/reactions`])]));
const prs = !isOwner ? [] : REPOS.flatMap((r) => ghJson(['pr', 'list', '-R', `the-greenman/${r}`, '--state', 'open', '--label', 'gate:owner-merge', '-L', '50',
  '--json', 'number,title,body,url,isDraft,mergeStateStatus,labels,statusCheckRollup']).map((p) => ({ ...p, repo: r })));

const sections = {
  1: { name: 'Ratify', items: A.ratifyItems(records, mainLog, parentLogs) },
  2: { name: 'Decide', items: isOwner ? A.escalationItems(records, groupLog, mainLog) : [] },
  3: { name: 'Acknowledge', items: A.unackedReports(reports, reactions, owner) },
  4: { name: 'Merge', items: A.mergeItems(prs) },
};
const g = isOwner ? groupState(repo) : { pause: 'n/a', merged: '-', budget: '-' };
const header = () => console.log(`\nSession: ${stamp(now)} (ad hoc) · attendees: ${attendees.map((a) => a.name).join(', ')} · ${quorumText(quorumNow())}`);
const acted = { ack: 0, merge: 0 }; const doneIds = { 3: new Set(), 4: new Set() };
const doneCount = (n) => (n <= 2 ? sections[n].items.filter((it) => choices.some((c) => c.id === it.instanceId)).length : doneIds[n].size);
const agenda = () => { header(); show(A.agendaLines({ done: { 1: doneCount(1), 2: doneCount(2), 3: doneCount(3), 4: doneCount(4) }, tally: A.tallyLine(choices, acted),
  ratify: sections[1].items, decide: sections[2].items, ack: sections[3].items, merge: sections[4].items,
  status: isOwner ? [A.statusLine('WG Third-party ready', g.pause, g.merged, g.budget)] : [] })); };

const choices = [];
const keys = {
  1: { prompt: '[r]atify [s]et aside [c]omment [v]iew discussion [e]dit [h]old [o]pen full [n]ext [q]uit > ', screen: (r) => A.decisionScreen(r, history(r), D.discussionLines(threadOf(r))) },
  2: { prompt: '[a]ccept recommendation [c]hoose other co[m]ment [v]iew discussion [e]dit [h]old [d]efer [o]pen [n]ext [q]uit > ', screen: (r) => A.escalationScreen(r, history(r), D.discussionLines(threadOf(r))) },
  3: { prompt: '[a]ck [o]pen in browser [n]ext [q]uit > ', screen: A.reportScreen },
  4: { prompt: '[m]erge [o]pen in browser [n]ext [q]uit > ', screen: A.prScreen },
};

if (argv[0] === 'agenda') { // read-only: the whole agenda with each item's essentials; no acts
  agenda();
  for (const n of [1, 2, 3, 4]) for (const [i, it] of sections[n].items.entries()) show([`${sections[n].name} ${i + 1}/${sections[n].items.length}`, ...keys[n].screen(it)]);
  process.exit(0);
}

async function walk(n) {
  const { items } = sections[n];
  for (let i = 0; i < items.length; i++) {
    const it = items[i]; const dec = n <= 2;
    const ref = { instanceId: it.instanceId, title: dec ? A.fv(it).title : '' };
    const choice = (action, text) => take(choices, ref, { action, text });
    show([`${sections[n].name} ${i + 1} of ${items.length} · ${doneCount(n)} done in this section`, ...keys[n].screen(it), ...(dec ? [A.choiceLine(choices.find((c) => c.id === it.instanceId))].filter(Boolean) : doneIds[n].has(it.id ?? it.number) ? ['  This session: done'] : [])]);
    for (;;) {
      const k = (await key(keys[n].prompt)).toLowerCase();
      if (k === 'q') return false;
      if (k === 'n' || (k === 'd' && n === 2)) break;
      if (k === 'o') { if (dec) show(A.fullScreen(it)); else openUrl(it.html_url ?? it.url); continue; }
      try {
        if (dec && ((n === 1 && (k === 'r' || k === 's')) || (n === 2 && (k === 'a' || k === 'c'))) && !quorumNow().met) { console.log(`  refused: ${quorumText(quorumNow())}; ratifying or setting aside needs it. You can still [e]dit or [h]old.`); continue; }
        if (dec && k === 'v') { show(D.fullDiscussion(threadOf(it))); continue; }
        if (dec && (k === 'm' || (n === 1 && k === 'c'))) { // any attendee may comment; no quorum needed
          const th = threadOf(it); if (th.length) show(D.fullDiscussion(th));
          const text = await ask('comment (markdown) > '); if (!text) continue;
          const to = th.length ? Number(await ask('reply to comment number (blank = the decision) > ')) : 0;
          const cite = await ask("cite (source-document id, URL, 'transcript', blank = none) > ");
          const role = cite ? (await ask('role of citation [quoted-from/evidence] (blank = default) > ')) || undefined : undefined;
          const note = cite ? (await ask('locator or passage note (optional) > ')) || undefined : undefined;
          try { D.buildSourceRef(cite, role, { transcriptId: 'x', note }); take(choices, ref, { comment: { text, replyTo: th[to - 1]?.comment.instanceId, cite: cite || undefined, role, note } }); console.log('  comment noted; the session will consider this decision'); }
          catch (e) { console.log('  ' + e.message); }
          continue;
        }
        if (dec && k === 'e') {
          const f = (await ask(`field (${Object.keys(FIELDS).join('/')}) > `)).toLowerCase();
          if (!FIELDS[f]) { console.log('  no such field'); continue; }
          const t = await ask('new text > '); if (!t) continue;
          take(choices, ref, { edit: { field: f, text: t } }); console.log('  edited in place at the end of the session (decision stays proposed)'); continue;
        }
        if (dec && k === 'h') { take(choices, ref, { hold: true, note: await ask('note for later sessions (optional) > ') }); console.log('  held: considered, stays proposed'); break; }
        if (n === 1 && (k === 'r' || k === 's')) { choice(k === 'r' ? 'ratify' : 'setaside'); console.log('  noted for the session'); break; }
        if (n === 2 && k === 'a') { choice('accept'); console.log('  noted for the session'); break; }
        if (n === 2 && k === 'c') { const t = await ask('resolution text > '); if (t) { choice('other', t); console.log('  noted for the session'); break; } continue; }
        if (n === 3 && k === 'a') { gh(['api', '-X', 'POST', `repos/${REPORT_ISSUE.split('/issues')[0]}/issues/comments/${it.id}/reactions`, '-f', 'content=+1']); acted.ack++; doneIds[3].add(it.id); console.log('  acknowledged (+1)'); break; }
        if (n === 4 && k === 'm') { gh(['pr', 'merge', String(it.number), '-R', `the-greenman/${it.repo}`, '--merge']); acted.merge++; doneIds[4].add(it.number); console.log('  merged'); break; }
      } catch (e) { console.log('  failed: ' + (e.stderr || e.message).toString().trim()); }
    }
  }
  return true;
}

let transcript;
let go = true;
while (go) {
  agenda();
  const k = (await key('section 1-4, [+] add attendee, [t]ranscript, [e]nd session, [q]uit > ')).toLowerCase();
  if (k === 'q' || k === 'e') break;
  if (k === 't') { const f = await ask('transcript file path > '); if (f) transcript = resolve(f); continue; }
  if (k === '+') {
    show(people.map((p, i) => `  ${i + 1}. ${p.name}  [${p.id.slice(0, 8)}]`));
    const n = Number(await ask('attendee number > '));
    if (people[n - 1]) addAttendee(people[n - 1].id); else console.log('  no such number');
    continue;
  }
  if (sections[k]) { sections[k].items.length ? (go = await walk(Number(k))) : console.log('  nothing here'); }
}
if (needsTranscript(choices) && !transcript) { const f = await ask('a comment cites the transcript; transcript file path > '); if (f) transcript = resolve(f); }
{ const t = A.tallyLine(choices, acted); if (t) console.log('\n' + t.replace(/ \(recorded when.*$/, '')); }
if (choices.length && (dryRun || (await ask(`record a session covering ${choices.length} decision(s) and open the PR? [y/N] `)).toLowerCase() === 'y'))
  endSession({ cli, now, role, attendees, choices, quorum: quorumNow(), transcript, dryRun, clerkedBy: arg('--clerked-by') });
else if (choices.length) console.log('Nothing recorded.');
if (!TTY) process.stdin.destroy(); // piped mode: end the line reader so the process exits
