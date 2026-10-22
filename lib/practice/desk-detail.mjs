// The desk read as data, for clients that render it (`clerk desk --json`, the srs-lab control room). Pure.
// Lifted from srs-lab control-room/extract/desk.mjs.

// A markdown table under a heading of the desk body, read back as rows (header row dropped). The desk's "Needs you" and
// "Threads" are the clerk's judgement, kept verbatim.
export function tableAfter(body, heading) {
  const lines = String(body).split('\n'), i = lines.findIndex((l) => l.startsWith(heading));
  if (i < 0) return [];
  const rows = [];
  for (const l of lines.slice(i + 1)) {
    if (l.startsWith('#')) break;
    if (l.startsWith('|') && !l.startsWith('|---')) rows.push(l.slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|')));
  }
  return rows.slice(1);
}

export const labelsOf = (x) => (x.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));

// a PR's checks in one word: none, failing, pending or green
export function checksState(rollup = []) {
  if (!rollup.length) return 'none';
  if (rollup.some((c) => /FAIL|ERROR/.test(c.conclusion ?? c.state ?? ''))) return 'failing';
  if (rollup.some((c) => !(c.conclusion ?? c.state) || /PENDING|IN_PROGRESS|QUEUED/.test(c.status ?? c.state ?? ''))) return 'pending';
  return 'green';
}

// decision records a PR's diff adds or changes, read from each file's patch (added lines only): what the PR records
export function decisionFilesFromPatch(files) {
  return files.filter((f) => /records\/.*\.json$/.test(f.filename) && f.patch).flatMap((f) => {
    try {
      const j = JSON.parse(f.patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)).join('\n'));
      if (j.typeName !== 'decision') return [];
      return [{ path: f.filename, status: f.status, instanceId: j.instanceId ?? null, state: j.lifecycleState ?? null, title: j.fieldValues?.title ?? null,
        question: j.fieldValues?.decision_question ?? null, statement: j.fieldValues?.decision_statement ?? null, kind: j.fieldValues?.decision_kind ?? null }];
    } catch { return []; }
  });
}

// the desk's needs and threads rows as objects
export const needsOf = (body) => tableAfter(body, '## Needs you').map(([n, what, action, why]) => ({ n, what, action, why }));
export const threadsOf = (body) => tableAfter(body, '## Threads').map(([thread, state, moved, next, who]) => ({ thread, state, moved, next, who }));
