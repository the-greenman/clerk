#!/usr/bin/env node
// clerk: act by role, human or AI. Interactive (TUI) or `clerk session` (non-interactive); both end in the same endSession.
// Read-only until a key is pressed; Reports' +1 and Merge act at once, Ratify/Decide on end of session.
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OWNER_LOG } from '../lib/practice/roles.mjs';
import { srsCli, srs, gh, ghJson, groupState, openUrl } from '../lib/adapters/cli.mjs';
import * as A from '../lib/practice/agenda.mjs';
import * as D from '../lib/practice/discussion.mjs';
import { stamp, take, FIELDS, EX_FIELDS, needsTranscript } from '../lib/practice/session.mjs';
import { endSession, postComments } from '../lib/adapters/session.mjs';
import { loadSettings, issueRef, programmeRepo } from '../lib/adapters/settings.mjs';
import { authorise, resolveContext, quorum, quorumText, rolesFor } from '../lib/practice/roles.mjs';
import { loadGroups } from '../lib/adapters/groups.mjs';
import { openPRsLabelled, mergePR } from '../lib/adapters/github.mjs';

const argv = process.argv.slice(2);

// Programme tools: one table, argv forwarded to the script (node for .mjs, bash otherwise).
const TOOLS = {
  roadmap: ['roadmap.mjs', 'derive epic priority from the period ranking (--json, --explain, --apply)'],
  claim: ['claim.mjs', 'claim an issue as a seat of its working group: clerk claim <repo#n> --as <seat> [--branch <name>] [--dry-run]'],
  queue: ['queue.mjs', 'report what the unattended lane would take next'],
  upkeep: ['pr-upkeep.sh', 'keep open PRs moving: merge or update-branch by gate label (--digest, --apply)'],
  steward: ['steward-check.mjs', 'guard against false closes: reopen issues closed without a merged PR (--fix acts)'],
  check: ['check-method.mjs', 'method structure rules: tensions, principles, boundaries'],
  conformance: ['check-programme-conformance.mjs', 'the programme repo is an SRS repo that validates'],
  board: ['gh-project.mjs', 'story-driven priority on the GitHub Project (many subcommands, see its help)'],
  routines: ['routines.mjs', 'drift between cloud triggers (a dump), standing-job records and briefs (--check <dump.json>)'],
  ground: ['ground.mjs', 'advisory PR grounding check and indicator I1: issue -> problem -> persona/domain -> epic -> group (--pr <repo#n> | --since YYYY-MM-DD, --json)'],
  wt: ['wt', 'create, list and prune git worktrees'],
  settings: ['settings.mjs', 'print the programme settings record (--json)'],
  charter: ['charter.mjs', 'charter a working group as draft/proposed records for the owner to ratify (--dry-run prints the plan)'],
  groups: ['groups.mjs', 'print the working groups chartered in the records (--json)'],
  'fetch-srs': ['fetch-pinned-srs.mjs', 'download the pinned srs CLI; prints SRS_CLI_PATH=...'],
};
if (argv[0] === 'help' || argv[0] === '--help') {
  console.log('clerk: act by role on an SRS programme.\n\n  session|comment   hold a session or post comments (clerk session --repo <path> --as <role>)\n  (no subcommand)   the interactive agenda (clerk --repo <path> --as <role>)');
  for (const [k, [, d]] of Object.entries(TOOLS)) console.log(`  ${k.padEnd(17)} ${d}`);
  console.log('\nTools take --repo <programme path> (default: current directory). See docs/tools.md.');
  process.exit(0);
}
if (TOOLS[argv[0]]) {
  // Every tool but wt works on a programme repo (an SRS repo, so it has .srs/). Say so plainly instead of failing deep inside.
  if (argv[0] !== "wt") {
    const i = argv.indexOf("--repo");
    const repo = resolve(argv[0] === "board" ? process.env.CLERK_REPO || "." : i >= 0 ? argv[i + 1] : ".");
    if (!existsSync(resolve(repo, ".srs"))) {
      console.error(`${repo} is not a programme repository (no .srs/). Run from a programme checkout or pass --repo <path>${argv[0] === "board" ? " (board: set CLERK_REPO)" : ""}, e.g. ~/dev/semanticops/srs-programme`);
      process.exit(2);
    }
  }
  const f = fileURLToPath(new URL('../scripts/' + TOOLS[argv[0]][0], import.meta.url));
  const r = spawnSync(f.endsWith('.mjs') ? process.execPath : 'bash', [f, ...argv.slice(1)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
const sub = argv[0] === 'session' || argv[0] === 'comment';
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const args = (n) => argv.flatMap((v, i) => (v === n ? [argv[i + 1]] : []));
const die = (m) => { console.error('clerk: ' + m); process.exit(1); };
const USAGE = 'usage: clerk [session] --repo <srs-programme path> --as <role> [--dry-run]\n  clerk session ... [--attendee <record-id>]... [--ratify <id|all>]... [--set-aside <id>]... [--consider <id>]... [--transcript <file>]\n                   clerk comment --repo <path> --as <role> --on <id> --text <text> [--reply-to <commentId>] [--cite <docId|url|transcript>] [--role-of-cite quoted-from|evidence]\n                   [--edit <id> --field <resolution|why|options|review|question> --text <text>]...  (--ratify/--set-aside need the context\'s quorum)';
if (!arg('--as')) die(USAGE);
const repo = resolve(arg('--repo') ?? die('--repo is required'));
const cli = srsCli(repo);
let settings; try { settings = loadSettings(repo, cli); } catch (e) { die(e.message); }
let groups; try { groups = loadGroups(repo, cli); } catch (e) { die(e.message); }
let roleCfg; try { roleCfg = authorise(arg('--as'), process.env.SRS_ACTOR, settings.ownerActor, rolesFor(groups)); } catch (e) { die(e.message); }
const isOwner = arg('--as') === 'owner';
const dryRun = argv.includes('--dry-run');

const REPOS = settings.repos;
const GH_OWNER = settings.githubOwner;
const REPORT_ISSUE = issueRef(settings.reportIssue, GH_OWNER).path;
const programme = programmeRepo(repo);
const S = (a, i) => srs(cli, repo, a, i);
const listed = S(['record', 'list', '--type', 'governance/decision']);
const records = listed.records ?? listed.instances;
const containers = S(['container', 'list']).containers;
const getLog = (id) => S(['container', 'get', id]).container;
const ownerLog = getLog(containers.find((c) => c.title === OWNER_LOG).containerId);
const rolesList = S(['record', 'list', '--type', 'governance/role']);
const agentsList = S(['record', 'list', '--type', 'com.mudemocracy.stewardship/agent']);
const memberSet = (c) => new Set((c.memberInstanceIds ?? []).map((m) => m.instanceId ?? m));
const people = [...(rolesList.records ?? rolesList.instances), ...(agentsList.records ?? agentsList.instances)]
  .map((r) => ({ id: r.instanceId, name: r.record.fieldValues?.title ?? r.instanceId }));
const role = resolveContext(roleCfg, rolesList.records ?? rolesList.instances, containers);
const mainLog = getLog(role.logId);
const groupLogs = groups.map((g) => ({ ...g, log: getLog(g.logId) })); // each chartered group's own decision log
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
let receivedIds = new Set(), runReports = [];
if (isOwner) try { // owner-only Reports section; tolerant of a repository without the receives type or run-reports
  receivedIds = new Set((S(['relation', 'list', '--type', 'com.semanticops.programme/receives']).relations ?? []).map((x) => x.targetId));
} catch { /* no receives yet */ }
if (isOwner) try {
  const rl = S(['record', 'list', '--type', 'com.mudemocracy.stewardship/run-report']);
  runReports = groupLogs.map((g) => ({ group: g.title, records: (rl.records ?? rl.instances ?? []).filter((r) => memberSet(g.log).has(r.instanceId)) }));
} catch { /* no run-reports */ }
let exerciseRecs = [], derivedRels = [];
try { // exercises and the proposals they fed; tolerant of a repository without them
  const el = S(['record', 'list', '--type', A.EXERCISE_TYPE]); exerciseRecs = el.records ?? el.instances ?? [];
  derivedRels = S(['relation', 'list', '--type', 'derived-from']).relations ?? [];
} catch { /* no exercises */ }
let commentRecs = [], commentRels = [];
try { // the comments package may be absent: no discussion
  const cl = S(['record', 'list', '--type', D.COMMENT_TYPE]); commentRecs = cl.records ?? cl.instances ?? [];
  commentRels = S(['relation', 'list', '--type', D.COMMENTS_ON]).relations ?? [];
} catch { /* no discussion */ }
const threadOf = (r) => D.thread(r.instanceId, commentRels, commentRecs);
const history = (r) => A.consideredIn(r.instanceId, consideredRels, sessionRecs);
const quorumNow = () => quorum(role, attendees, groups);

// Non-interactive: the same endSession the TUI ends with.
if (sub) {
  try {
    args('--attendee').forEach(addAttendee);
    if ((args('--ratify').length || args('--set-aside').length) && !quorumNow().met) throw new Error(`${quorumText(quorumNow())}: --ratify/--set-aside refused; --consider and --edit are still allowed`);
    const items = A.ratifyItems(records, mainLog, parentLogs);
    const pick = (p) => { const m = items.filter((r) => r.instanceId.startsWith(p)); if (m.length !== 1) throw new Error(`no single proposed decision matches "${p}"`); return m[0]; };
    const pool = [...items, ...(isOwner ? groupLogs.flatMap((g) => A.escalationItems(records, g.log, mainLog)) : [])];
    const find = (p) => { const m = pool.filter((r) => r.instanceId.startsWith(p)); if (m.length !== 1) throw new Error(`no single decision on the agenda matches "${p}"`); return m[0]; };
    const item = (r) => ({ instanceId: r.instanceId, title: A.fv(r).title });
    const choices = [];
    const transcript = arg('--transcript') && resolve(arg('--transcript'));
    if (argv[0] === 'comment') { // the same take() + endSession as the TUI's [c]omment
      const reply = arg('--reply-to') && (() => { const m = commentRecs.filter((c) => c.instanceId.startsWith(arg('--reply-to'))); if (m.length !== 1) throw new Error(`no single comment matches "${arg('--reply-to')}"`); return m[0].instanceId; })();
      take(choices, item(find(arg('--on') ?? die('--on <decision id> is required'))), { comment: { text: arg('--text') ?? die('--text is required'), replyTo: reply, cite: arg('--cite'), role: arg('--role-of-cite') } });
    }
    if (argv[0] === 'comment') { postComments({ cli, programme, now, choices, transcript, dryRun, clerkedBy: arg('--clerked-by') }); process.exit(0); } // discussion between sessions: no session record, no quorum
    args('--set-aside').forEach((p) => take(choices, item(pick(p)), { action: 'setaside' }));
    args('--ratify').flatMap((p) => (p === 'all' ? items : [pick(p)])).filter((r) => !choices.some((c) => c.id === r.instanceId)).forEach((r) => take(choices, item(r), { action: 'ratify' }));
    args('--consider').forEach((p) => take(choices, item(find(p)), {}));
    const [fs, ts] = [args('--field'), args('--text')];
    args('--edit').forEach((p, i) => { if (!fs[i] || ts[i] === undefined) throw new Error('--edit <id> needs a matching --field and --text'); take(choices, item(find(p)), { edit: { field: fs[i], text: ts[i] } }); });
    if (dryRun) console.log(quorumText(quorumNow()));
    endSession({ cli, programme, now, role, attendees, convened: 'ad-hoc', quorum: quorumNow(), transcript, dryRun, choices, clerkedBy: arg('--clerked-by') });
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
const reports = comments.filter((c) => c.author_association === 'OWNER' && A.reportCycle(c)).slice(-5);
const reactions = Object.fromEntries(reports.map((c) => [c.id, ghJson(['api', `repos/${REPORT_ISSUE.split('/issues')[0]}/issues/comments/${c.id}/reactions`])]));
const acked = new Set(reports.filter((c) => reactions[c.id].some((x) => x.content === '+1' && x.user?.login === owner)).map((c) => c.id));
const prs = !isOwner ? [] : REPOS.flatMap((r) => { try { return openPRsLabelled(GH_OWNER, r, 'gate:owner-merge'); } catch (e) { console.error(`Merges: ${r} unreadable (${e.message.split('\n')[0]})`); return []; } });

// Order follows a meeting: decisions since the last session, reports, decisions for this session, merges.
const sections = {
  1: { name: 'Decisions since the last session', items: A.ratifyItems(records, mainLog, parentLogs) },
  2: { name: 'Reports', items: isOwner ? runReports.flatMap((rr, i) => A.reportItems(rr.records, receivedIds, i ? [] : reports, acked, rr.group)) : [] }, // ponytail: one report issue per programme; its comments are listed under the first group
  3: { name: 'Exercises', items: A.exerciseItems(exerciseRecs, mainLog) },
  4: { name: 'Decisions for this session', items: isOwner ? groupLogs.flatMap((g) => A.escalationItems(records, g.log, mainLog)) : [] },
  5: { name: 'Merges', items: A.mergeItems(prs) },
};
// Next: the queue behind each group, live via gh REST (owner only; tolerant of failure). State: its pause, merged and budget.
const next = {}, gstate = {};
for (const gr of isOwner ? groupLogs : []) {
  gstate[gr.title] = await groupState(repo, gr);
  try {
    const issues = gr.repos.flatMap((r) => gh(['api', '-X', 'GET', `repos/${GH_OWNER}/${r}/issues`, '-f', `labels=ready,${gr.label}`, '-f', 'state=open', '-f', 'per_page=100',
      '--jq', '.[]|select(.pull_request|not)|{number,title,created_at,assignee:(.assignee!=null),labels:[.labels[].name]}']).trim().split('\n').filter(Boolean).map((l) => ({ ...JSON.parse(l), repo: r })))
      .filter((i) => !i.assignee && !i.labels.some((l) => ['needs-input', 'parked'].includes(l))); // ponytail: the builder also drops issues with a branch or PR; not checked here
    const inFlight = gr.repos.reduce((n, r) => n + openPRsLabelled(GH_OWNER, r, gr.label, { light: true }).length, 0);
    next[gr.title] = { ready: A.orderQueue(issues, A.localPriorities(records.filter((r) => memberSet(gr.log).has(r.instanceId)))), inFlight, merged: Number(gstate[gr.title].merged) || 0, budget: Number(gstate[gr.title].budget) || gr.budget };
  } catch { /* queue unknown */ }
}
const header = () => console.log(`\nSession: ${stamp(now)} (ad hoc) · attendees: ${attendees.map((a) => a.name).join(', ')} · ${quorumText(quorumNow())}`);
const acted = { merge: 0 }; const doneIds = { 5: new Set() };
const isDec = (n) => n === 1 || n === 3 || n === 4; // record-backed items (3 = exercises: never ratified)
const doneCount = (n) => (n === 5 ? doneIds[5].size : sections[n].items.filter((it) => choices.some((c) => c.id === it.instanceId && (n !== 2 || c.action === 'receive'))).length);
const agenda = () => { header(); show(A.agendaLines({ done: { 1: doneCount(1), 2: doneCount(2), 3: doneCount(3), 4: doneCount(4), 5: doneCount(5) }, tally: A.tallyLine(choices, acted),
  ratify: sections[1].items, reports: sections[2].items, exercises: sections[3].items, decide: sections[4].items, merge: sections[5].items,
  status: groupLogs.filter(() => isOwner).flatMap((gr) => { const g = gstate[gr.title], n = next[gr.title]; return [A.statusLine(gr.title, g.pause, g.merged, g.budget), ...(n && A.isDry(n.ready.length, n.budget) ? [A.forecast(n.ready.length, n.budget)] : [])]; }) })); };

const choices = [];
const plusOne = (id) => { if (!dryRun) gh(['api', '-X', 'POST', `repos/${REPORT_ISSUE.split('/issues')[0]}/issues/comments/${id}/reactions`, '-f', 'content=+1']); };
const keys = {
  1: { prompt: '[r]atify [s]et aside [c]omment [v]iew discussion [e]dit [h]old [o]pen full [n]ext [q]uit > ', screen: (r) => A.decisionScreen(r, history(r), D.discussionLines(threadOf(r))) },
  2: { prompt: '[r]eceive [c]omment [o]pen [n]ext [q]uit > ', screen: (it) => A.reportScreen(it, { pause: gstate[it.group]?.pause, waiting: sections[4].items.length, exercises: sections[3].items.length, next: next[it.group] }) },
  3: { prompt: '[c]omment (give input) [v]iew discussion [e]dit [p]ropose a decision [o]pen [n]ext [q]uit > ', screen: (r) => A.exerciseScreen(r, history(r), D.discussionLines(threadOf(r)), A.fedInto(r.instanceId, derivedRels)) },
  4: { prompt: '[a]ccept recommendation [c]hoose other co[m]ment [v]iew discussion [e]dit [h]old [d]efer [o]pen [n]ext [q]uit > ', screen: (r) => A.escalationScreen(r, history(r), D.discussionLines(threadOf(r))) },
  5: { prompt: '[m]erge [o]pen in browser [n]ext [q]uit > ', screen: A.prScreen },
};

if (argv[0] === 'agenda') { // read-only: the whole agenda with each item's essentials; no acts
  agenda();
  for (const n of [1, 2, 3, 4, 5]) for (const [i, it] of sections[n].items.entries()) show([`${sections[n].name} ${i + 1}/${sections[n].items.length}`, ...keys[n].screen(it)]);
  process.exit(0);
}

async function walk(n) {
  const { items } = sections[n];
  for (let i = 0; i < items.length; i++) {
    const it = items[i]; const dec = isDec(n);
    const ref = { instanceId: it.instanceId, exercise: n === 3, title: dec ? A.fv(it).title : n === 2 ? A.reportTitle(it) : '' };
    const choice = (action, text) => take(choices, ref, { action, text });
    show([`${sections[n].name} ${i + 1} of ${items.length} · ${doneCount(n)} done in this section`, ...keys[n].screen(it), ...(dec ? [A.choiceLine(choices.find((c) => c.id === it.instanceId))].filter(Boolean) : n === 2 ? [A.choiceLine(choices.find((c) => c.id === it.instanceId && c.action === 'receive'))].filter(Boolean) : doneIds[n].has(it.number) ? ['  This session: done'] : [])]);
    for (;;) {
      const k = (await key(keys[n].prompt)).toLowerCase();
      if (k === 'q') return false;
      if (k === 'n' || (k === 'd' && n === 4)) break;
      if (k === 'o') { if (dec) show(A.fullScreen(it)); else if (n === 2) show([...it.text.split('\n'), ...(it.comment ? ['  ' + it.comment.html_url] : [])]); else openUrl(it.url); continue; }
      try {
        if (dec && ((n === 1 && (k === 'r' || k === 's')) || (n === 4 && (k === 'a' || k === 'c'))) && !quorumNow().met) { console.log(`  refused: ${quorumText(quorumNow())}; ratifying or setting aside needs it. You can still [e]dit or [h]old.`); continue; }
        if (dec && k === 'v') { show(D.fullDiscussion(threadOf(it))); continue; }
        if (dec && (k === 'm' || ((n === 1 || n === 3) && k === 'c'))) { // any attendee may comment; no quorum needed
          const th = threadOf(it); if (th.length) show(D.fullDiscussion(th));
          const text = await ask('comment (markdown) > '); if (!text) continue;
          const to = th.length ? Number(await ask('reply to comment number (blank = the decision) > ')) : 0;
          const cite = await ask("cite (source-document id, URL, 'transcript', blank = none) > ");
          const role = cite ? (await ask('role of citation [quoted-from/evidence] (blank = default) > ')) || undefined : undefined;
          const note = cite ? (await ask('locator or passage note (optional) > ')) || undefined : undefined;
          try { D.buildSourceRef(cite, role, { transcriptId: 'x', note }); take(choices, ref, { comment: { text, replyTo: th[to - 1]?.comment.instanceId, cite: cite || undefined, role, note } }); console.log(`  comment noted; the session will consider this ${n === 3 ? 'exercise' : 'item'}`); }
          catch (e) { console.log('  ' + e.message); }
          continue;
        }
        if (n === 3 && k === 'p') { // draft a proposal from the exercise: proposed, same log, derived-from it
          const question = await ask('decision question > '); if (!question) continue;
          const resolution = await ask('proposed resolution > '); if (!resolution) continue;
          take(choices, ref, { proposal: { question, resolution } }); console.log('  proposal noted; created as a proposed decision when the session ends'); continue;
        }
        if (dec && k === 'e') {
          const F = n === 3 ? EX_FIELDS : FIELDS;
          const f = (await ask(`field (${Object.keys(F).join('/')}) > `)).toLowerCase();
          if (!F[f]) { console.log('  no such field'); continue; }
          const t = await ask('new text > '); if (!t) continue;
          take(choices, ref, { edit: { field: f, text: t } }); console.log('  edited in place at the end of the session (decision stays proposed)'); continue;
        }
        if (dec && n !== 3 && k === 'h') { take(choices, ref, { hold: true, note: await ask('note for later sessions (optional) > ') }); console.log('  held: considered, stays proposed'); break; }
        if (n === 1 && (k === 'r' || k === 's')) { choice(k === 'r' ? 'ratify' : 'setaside'); console.log('  noted for the session'); break; }
        if (n === 2 && k === 'r') { // receiving needs only the acting role present; the +1 is the mechanical side effect, done now
          take(choices, ref, { action: 'receive', report: true, commentOnly: it.commentOnly });
          if (!it.comment) console.log('  received (no #31 comment to acknowledge)');
          else if (acked.has(it.comment.id)) console.log('  received (already acknowledged on #31)');
          else { plusOne(it.comment.id); acked.add(it.comment.id); console.log(`  received; ${dryRun ? '[dry run: would acknowledge' : 'acknowledged'} on #31${dryRun ? ']' : ''} so the group keeps running`); }
          break;
        }
        if (n === 2 && k === 'c') {
          const text = await ask('comment on the report (markdown) > '); if (!text) continue;
          if (it.recordId) { take(choices, ref, { report: true, comment: { text } }); console.log('  comment noted; written on the report record when the session ends'); }
          else { // no record: reply on #31 (a comment reply, since issue comments do not thread)
            const body = `Re: wg-report cycle=${it.cycle} (${it.comment.html_url})\n\n${text}`;
            if (dryRun) console.log('  [dry run] would reply on #31'); else gh(['api', '-X', 'POST', `repos/${REPORT_ISSUE}/comments`, '-f', `body=${body}`]);
            console.log('  replied on #31');
          }
          continue;
        }
        if (n === 4 && k === 'a') { choice('accept'); console.log('  noted for the session'); break; }
        if (n === 4 && k === 'c') { const t = await ask('resolution text > '); if (t) { choice('other', t); console.log('  noted for the session'); break; } continue; }
        if (n === 5 && k === 'm') { if (dryRun) console.log('  [dry run] would merge'); else mergePR(`${GH_OWNER}/${it.repo}`, it.number); acted.merge++; doneIds[5].add(it.number); console.log('  merged'); break; }
      } catch (e) { console.log('  failed: ' + (e.stderr || e.message).toString().trim()); }
    }
  }
  return true;
}

let transcript;
let go = true;
while (go) {
  agenda();
  const k = (await key('section 1-5, [+] add attendee, [t]ranscript, [e]nd session, [q]uit > ')).toLowerCase();
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
if (choices.length && (dryRun || (await ask(`record a session covering ${choices.length} item(s) and open the PR? [y/N] `)).toLowerCase() === 'y'))
  endSession({ cli, programme, now, role, attendees, choices, quorum: quorumNow(), transcript, dryRun, clerkedBy: arg('--clerked-by') });
else if (choices.length) console.log('Nothing recorded.');
if (!TTY) process.stdin.destroy(); // piped mode: end the line reader so the process exits
