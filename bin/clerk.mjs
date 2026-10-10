#!/usr/bin/env node
// clerk: act by role, human or AI. Interactive (TUI) or `clerk session` (non-interactive); both end in the same endSession.
// Read-only until a key is pressed; Ack and Merge act at once, Ratify/Decide on end of session.
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { OWNER_LOG, GROUP_LOG } from '../lib/roles.mjs';
import { srsCli, srs, gh, ghJson, groupState, openUrl } from '../lib/io.mjs';
import * as A from '../lib/agenda.mjs';
import { endSession, stamp } from '../lib/session.mjs';
import { authorise, resolveContext } from '../lib/roles.mjs';

const argv = process.argv.slice(2);
const sub = argv[0] === 'session';
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const args = (n) => argv.flatMap((v, i) => (v === n ? [argv[i + 1]] : []));
const die = (m) => { console.error('clerk: ' + m); process.exit(1); };
const USAGE = 'usage: clerk [session] --repo <srs-programme path> --as <role> [--dry-run]\n  clerk session ... [--attendee <record-id>]... [--ratify <id|all>]... [--set-aside <id>]...';
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
const attendees = [people.find((p) => p.id === role.roleId) ?? { id: role.roleId, name: arg('--as') }];
const addAttendee = (idOrPrefix) => {
  const m = people.filter((p) => p.id.startsWith(idOrPrefix));
  if (m.length !== 1) throw new Error(`no single role or agent record matches "${idOrPrefix}"`);
  if (!attendees.some((a) => a.id === m[0].id)) attendees.push(m[0]);
};
const now = new Date();

// Non-interactive: the same endSession the TUI ends with.
if (sub) {
  try {
    args('--attendee').forEach(addAttendee);
    const items = A.ratifyItems(records, mainLog, parentLogs);
    const pick = (p) => { const m = items.filter((r) => r.instanceId.startsWith(p)); if (m.length !== 1) throw new Error(`no single proposed decision matches "${p}"`); return m[0]; };
    const mk = (r, action) => ({ id: r.instanceId, title: A.fv(r).title, action });
    const aside = args('--set-aside').map((p) => mk(pick(p), 'setaside'));
    const asideIds = new Set(aside.map((c) => c.id));
    const rat = args('--ratify').flatMap((p) => (p === 'all' ? items : [pick(p)])).filter((r) => !asideIds.has(r.instanceId)).map((r) => mk(r, 'ratify'));
    endSession({ cli, now, role, attendees, convened: 'ad-hoc', dryRun, choices: [...new Map([...rat, ...aside].map((c) => [c.id, c])).values()] });
  } catch (e) { die(e.message); }
  process.exit(0);
}

// Lines from stdin, one per prompt; end of input answers q so piped runs terminate.
const rl = createInterface({ input: process.stdin }); const buf = []; let waiting = null; let ended = false;
rl.on('line', (l) => { if (waiting) { const w = waiting; waiting = null; w(l); } else buf.push(l); });
rl.on('close', () => { ended = true; if (waiting) { const w = waiting; waiting = null; w('q'); } });
const ask = (p) => { process.stdout.write(p); return new Promise((res) => { if (buf.length) res(buf.shift()); else if (ended) res('q'); else waiting = res; }).then((a) => { if (!process.stdin.isTTY) console.log(a); return a.trim(); }); };
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
const header = () => console.log(`\nSession: ${stamp(now)} (ad hoc) · attendees: ${attendees.map((a) => a.name).join(', ')}`);
const agenda = () => { header(); show(A.agendaLines({ ratify: sections[1].items, decide: sections[2].items, ack: sections[3].items, merge: sections[4].items,
  status: isOwner ? [A.statusLine('WG Third-party ready', g.pause, g.merged, g.budget)] : [] })); };

const choices = [];
const keys = {
  1: { prompt: '[r]atify [s]et aside [o]pen full [n]ext [q]uit > ', screen: A.decisionScreen },
  2: { prompt: '[a]ccept recommendation [c]hoose other [d]efer [o]pen [n]ext [q]uit > ', screen: A.escalationScreen },
  3: { prompt: '[a]ck [o]pen in browser [n]ext [q]uit > ', screen: A.reportScreen },
  4: { prompt: '[m]erge [o]pen in browser [n]ext [q]uit > ', screen: A.prScreen },
};

async function walk(n) {
  const { items } = sections[n];
  for (let i = 0; i < items.length; i++) {
    const it = items[i]; const dec = n <= 2;
    const choice = (action, text) => choices.push({ id: it.instanceId, title: A.fv(it).title, action, text });
    show([`${sections[n].name} ${i + 1}/${items.length}`, ...keys[n].screen(it)]);
    for (;;) {
      const k = (await ask(keys[n].prompt)).toLowerCase();
      if (k === 'q') return false;
      if (k === 'n' || (k === 'd' && n === 2)) break;
      if (k === 'o') { if (dec) show(A.fullScreen(it)); else openUrl(it.html_url ?? it.url); continue; }
      try {
        if (n === 1 && (k === 'r' || k === 's')) { choice(k === 'r' ? 'ratify' : 'setaside'); console.log('  noted for the session'); break; }
        if (n === 2 && k === 'a') { choice('accept'); console.log('  noted for the session'); break; }
        if (n === 2 && k === 'c') { const t = await ask('resolution text > '); if (t) { choice('other', t); console.log('  noted for the session'); break; } continue; }
        if (n === 3 && k === 'a') { gh(['api', '-X', 'POST', `repos/${REPORT_ISSUE.split('/issues')[0]}/issues/comments/${it.id}/reactions`, '-f', 'content=+1']); console.log('  acknowledged (+1)'); break; }
        if (n === 4 && k === 'm') { gh(['pr', 'merge', String(it.number), '-R', `the-greenman/${it.repo}`, '--merge']); console.log('  merged'); break; }
      } catch (e) { console.log('  failed: ' + (e.stderr || e.message).toString().trim()); }
    }
  }
  return true;
}

let go = true;
while (go) {
  agenda();
  const k = (await ask('section 1-4, [+] add attendee, [e]nd session, [q]uit > ')).toLowerCase();
  if (k === 'q' || k === 'e') break;
  if (k === '+') {
    show(people.map((p, i) => `  ${i + 1}. ${p.name}  [${p.id.slice(0, 8)}]`));
    const n = Number(await ask('attendee number > '));
    if (people[n - 1]) addAttendee(people[n - 1].id); else console.log('  no such number');
    continue;
  }
  if (sections[k]) { sections[k].items.length ? (go = await walk(k)) : console.log('  nothing here'); }
}
if (choices.length && (dryRun || (await ask(`record ${choices.length} act(s) as a session and open the PR? [y/N] `)).toLowerCase() === 'y'))
  endSession({ cli, now, role, attendees, choices, dryRun });
else if (choices.length) console.log('Nothing recorded.');
rl.close();
