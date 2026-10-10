#!/usr/bin/env node
// clerk: act by role. Read-only until a key is pressed; Ack and Merge act at once, Ratify/Decide on end of session.
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { srsCli, srs, gh, ghJson, groupState, openUrl } from '../lib/io.mjs';
import * as A from '../lib/agenda.mjs';
import { endSession, MAIN_LOG } from '../lib/session.mjs';

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const die = (m) => { console.error('clerk: ' + m); process.exit(1); };
if (arg('--as') !== 'owner') die('usage: clerk --repo <srs-programme path> --as owner [--dry-run]');
const repo = resolve(arg('--repo') ?? die('--repo is required'));
let actor; try { actor = JSON.parse(process.env.SRS_ACTOR); } catch { /* handled below */ }
if (actor?.kind !== 'human') die('SRS_ACTOR must be a human actor: acts here are the owner\'s, never an agent\'s');

const REPOS = ['semanticops.com', 'srs', 'srs-rust', 'srs-web', 'srs-vscode', 'srs-programme', 'srs-context', 'muDemocracy.org'];
const REPORT_ISSUE = 'the-greenman/semanticops.com/issues/31';
const GROUP_LOG = 'f6db54e2-f554-4bd2-b985-e000a54542f4';

// Lines from stdin, one per prompt; end of input answers q so piped runs terminate.
const rl = createInterface({ input: process.stdin }); const buf = []; let waiting = null; let ended = false;
rl.on('line', (l) => { if (waiting) { const w = waiting; waiting = null; w(l); } else buf.push(l); });
rl.on('close', () => { ended = true; if (waiting) { const w = waiting; waiting = null; w('q'); } });
const ask = (p) => { process.stdout.write(p); return new Promise((res) => { if (buf.length) res(buf.shift()); else if (ended) res('q'); else waiting = res; }).then((a) => { if (!process.stdin.isTTY) console.log(a); return a.trim(); }); };
const show = (ls) => console.log('\n' + ls.join('\n'));

const cli = srsCli(repo);
const S = (a, i) => srs(cli, repo, a, i);
const listed = S(['record', 'list', '--type', 'governance/decision']);
const records = listed.records ?? listed.instances;
const containers = S(['container', 'list']).containers;
const getLog = (id) => S(['container', 'get', id]).container;
const mainLog = getLog(containers.find((c) => c.title === MAIN_LOG).containerId);
const groupLog = getLog(GROUP_LOG);

const owner = gh(['api', 'user', '-q', '.login']).trim();
const comments = gh(['api', `repos/${REPORT_ISSUE}/comments`, '--paginate', '--jq', '.[]|{id,body,created_at,author_association,html_url}'])
  .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
// ponytail: only the latest 5 reports are checked for a +1; older ones are history.
const reports = comments.filter((c) => c.author_association === 'OWNER' && A.REPORT_MARK.test(c.body)).slice(-5);
const reactions = Object.fromEntries(reports.map((c) => [c.id, ghJson(['api', `repos/${REPORT_ISSUE.split('/issues')[0]}/issues/comments/${c.id}/reactions`])]));
const prs = REPOS.flatMap((r) => ghJson(['pr', 'list', '-R', `the-greenman/${r}`, '--state', 'open', '--label', 'gate:owner-merge', '-L', '50',
  '--json', 'number,title,body,url,isDraft,mergeStateStatus,labels,statusCheckRollup']).map((p) => ({ ...p, repo: r })));

const sections = {
  1: { name: 'Ratify', items: A.ratifyItems(records, mainLog) },
  2: { name: 'Decide', items: A.escalationItems(records, groupLog, mainLog) },
  3: { name: 'Acknowledge', items: A.unackedReports(reports, reactions, owner) },
  4: { name: 'Merge', items: A.mergeItems(prs) },
};
const g = groupState(repo);
const agenda = () => show(A.agendaLines({ ratify: sections[1].items, decide: sections[2].items, ack: sections[3].items, merge: sections[4].items,
  status: [A.statusLine('WG Third-party ready', g.pause, g.merged, g.budget)] }));

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
  const k = (await ask('section 1-4, [e]nd session, [q]uit > ')).toLowerCase();
  if (k === 'q' || k === 'e') break;
  if (sections[k]) { sections[k].items.length ? (go = await walk(k)) : console.log('  nothing here'); }
}
if (choices.length && (process.argv.includes('--dry-run') || (await ask(`record ${choices.length} act(s) as a ratification session and open the PR? [y/N] `)).toLowerCase() === 'y'))
  endSession({ cli, date: new Date().toISOString().slice(0, 10), choices, dryRun: process.argv.includes('--dry-run') });
else if (choices.length) console.log('Nothing recorded.');
rl.close();
