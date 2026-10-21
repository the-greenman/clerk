// Routine drift: cloud triggers vs standing-job records vs briefs on the clerk default branch. Pure.
const BRIEF_RE = /routines\/[\w.-]+\.md/g;
// Thin prompt (docs/routines.md): names the job's brief and says it is read in the clerk.
const thin = (prompt, brief) => prompt.includes(brief) && prompt.includes('the-greenman/clerk');
// A clerk command a prompt runs: `clerk <cmd> ...` (backticked) or clerk.mjs <cmd> ..., with the flags after it.
const CLERK_RE = /(?:`clerk|clerk\.mjs) ([a-z][\w-]*)([^`;)\n]*)/g;
// ponytail: a flag is known when its script mentions it (literal --flag, or a parseArgs key); upgrade if commands declare their flags.
const knownFlag = (text, f) => f === '--repo' || text.includes(f) || new RegExp(`\\b${f.slice(2)}\\s*:`).test(text);

// checkRoutines({triggers:[{id,name,enabled,cron_expression,prompt,sources?}], jobs:[{id,title,routine_id,brief}], briefs:Set<path>,
//   repos?: settings repos every routine must attach, commands?: {name: script text}}) -> [{kind, subject, detail}]
export function checkRoutines({ triggers, jobs, briefs, repos, commands }) {
  const out = [];
  const add = (kind, subject, detail) => out.push({ kind, subject, detail });
  const byId = new Map(triggers.map((t) => [t.id, t]));
  const named = new Set(jobs.map((j) => j.routine_id).filter(Boolean));
  for (const t of triggers) {
    const checkIn = t.name.startsWith('Check-in');
    if (checkIn && !t.enabled) add('stale-check-in', t.id, t.name);
    if (!t.enabled || checkIn) continue;
    if (!named.has(t.id)) add('trigger-without-record', t.id, t.name);
    for (const b of new Set((t.prompt ?? '').match(BRIEF_RE) ?? [])) if (!briefs.has(b)) add('brief-missing', t.id, `${t.name}: prompt names ${b}`);
    const missing = repos && t.sources ? repos.filter((r) => !t.sources.includes(r)) : [];
    if (missing.length) add('sources-missing', t.id, `${t.name}: attach ${missing.join(', ')}`);
    for (const [, cmd, rest] of commands ? (t.prompt ?? '').matchAll(CLERK_RE) : []) {
      if (!(cmd in commands)) { add('unknown-clerk-command', t.id, `${t.name}: clerk ${cmd}`); continue; }
      for (const f of rest.match(/--[\w-]+/g) ?? []) if (!knownFlag(commands[cmd], f)) add('unknown-clerk-command', t.id, `${t.name}: clerk ${cmd} ${f}`);
    }
  }
  for (const j of jobs) {
    const t = j.routine_id && byId.get(j.routine_id);
    if (j.routine_id && !t) add('record-without-trigger', j.id, `${j.title}: ${j.routine_id}`);
    else if (t && !t.enabled) add('record-trigger-disabled', j.id, `${j.title}: ${t.name}`);
    if (j.brief && !briefs.has(j.brief)) add('brief-missing', j.id, `${j.title}: ${j.brief}`);
    if (t?.enabled && j.brief && !thin(t.prompt ?? '', j.brief)) add('prompt-not-thin', t.id, `${t.name}: prompt must name ${j.brief} in the-greenman/clerk`);
  }
  return out;
}
