// Routine drift: cloud triggers vs standing-job records vs briefs on the clerk default branch. Pure.
const BRIEF_RE = /routines\/[\w.-]+\.md/g;
// Thin prompt (docs/routines.md): names the job's brief and says it is read in the clerk.
const thin = (prompt, brief) => prompt.includes(brief) && prompt.includes('the-greenman/clerk');

// checkRoutines({triggers:[{id,name,enabled,cron_expression,prompt}], jobs:[{id,title,routine_id,brief}], briefs:Set<path>}) -> [{kind, subject, detail}]
export function checkRoutines({ triggers, jobs, briefs }) {
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
