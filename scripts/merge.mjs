#!/usr/bin/env node
// merge: the owner merges one PR at the head they reviewed (clerk#166's bare act: no session minute; GitHub, and clerk
// serve's acts.jsonl when it comes from there, record it). Only as the owner (SRS_ACTOR = the settings' ownerActor), only a
// governed repo, only an open, clean PR still at that head.
//   node scripts/merge.mjs <repo#n> --sha <head> --repo <programme> [--json]  -> {ref, sha, merged: true}
//   exit 0 merged, 1 GitHub failed, 2 usage, 3 refused
import { parseArgs } from 'node:util';
import { loadSettings } from '../lib/adapters/settings.mjs';
import { get, mergePR } from '../lib/adapters/github.mjs';
import { authorise } from '../lib/practice/roles.mjs';
import { mergeRefusal } from '../lib/practice/merge.mjs';

const say = (code, m) => { console.error(`clerk merge: ${m}`); process.exit(code); };
let a;
try { a = parseArgs({ allowPositionals: true, options: { repo: { type: 'string', default: process.cwd() }, sha: { type: 'string' }, json: { type: 'boolean' } } }); }
catch (e) { say(2, e.message); }
const ref = a.positionals[0], m = /^([\w.-]+)#(\d+)$/.exec(ref ?? ''), sha = a.values.sha;
if (!m || !/^[0-9a-f]{40}$/.test(sha ?? '')) say(2, 'usage: clerk merge <repo#n> --sha <the 40-hex head you reviewed> --repo <programme> [--json]');
const st = loadSettings(a.values.repo);
try { authorise('owner', process.env.SRS_ACTOR, st.ownerActor); } catch (e) { say(3, e.message); }
if (!st.repos.includes(m[1])) say(3, `${m[1]} is not a governed repo (${st.repos.join(', ')})`);
const slug = `${st.githubOwner}/${m[1]}`;
let pr;
try { pr = get(`repos/${slug}/pulls/${m[2]}`); } catch (e) { say(1, `${ref} unreadable: ${e.message.split('\n')[0]}`); }
const why = mergeRefusal(pr, sha);
if (why) say(3, `${ref} not merged: ${why}`);
try { mergePR(slug, m[2], sha); } catch (e) { say(1, `${ref}: GitHub refused the merge: ${e.message.split('\n')[0]}`); }
const out = { ref, sha, merged: true };
console.log(a.values.json ? JSON.stringify(out) : `merged ${ref} at ${sha.slice(0, 7)}`);
