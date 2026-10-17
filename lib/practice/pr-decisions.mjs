// A PR's decisions (clerk#77, docs/pr-decisions.md): read the srs-decisions block, check it against the standard,
// and sign an agent's comment with its actor. Pure: adapters fetch the PR; nothing here does I/O.

const HEX8 = /\b[0-9a-f]{8}\b/g;
const SP = /\bSP-\d+\b/g;
const DECISION_PROSE = /\b(we (?:decided|chose|opted)|decided to|chose to|opted (?:for|to)|instead of|trade-?off|decision asked|owner decision)\b/i;

// body -> {block, error, by, answers, made, asks, review, ids}; the clerk's Answers: line still counts
export function parseDecisions(body = '') {
  const m = /```srs-decisions\s*\n([\s\S]*?)```/.exec(body);
  let block = null, error = null;
  if (m) { try { block = JSON.parse(m[1]); } catch (e) { error = e.message; } }
  return {
    block, error, by: block?.by ?? null,
    answers: [...new Set([...(block?.answers ?? []), ...(/^\s*Answers:\s*(.+)$/im.exec(body)?.[1].match(SP) ?? [])])],
    made: (block?.made ?? []).map((x) => ({ ...x, class: x.class ?? (x.id ? 'ruling' : 'choice') })),
    asks: block?.asks ?? [], review: block?.review ?? null,
    ids: [...new Set(body.replace(/```srs-decisions[\s\S]*?```/, '').match(HEX8) ?? [])],
  };
}

// Owner answers posted on the PR: <!-- srs:answer ask=<key> choice="…" -->
export function answersFrom(comments = []) {
  const out = new Map();
  for (const c of comments) { const m = /^<!-- srs:answer ask=(\S+?)(?:\s+choice="([^"]*)")? -->/.exec(typeof c === 'string' ? c : c.body ?? ''); if (m) out.set(m[1], m[2] ?? true); }
  return out;
}

// -> [{level: error|warn|info|ok, text}]. merging: the PR is about to merge (merge-blocking asks must be answered).
export function checkDecisions(d, { body = '', merging = false, answered = new Map(), groupHasLean = false, recordsInDiff = 0 } = {}) {
  const out = [], add = (level, text) => out.push({ level, text });
  if (!d.block) {
    if (d.error) add('error', `the srs-decisions block does not parse: ${d.error}`);
    if (recordsInDiff) add('error', `it records ${recordsInDiff} decision(s) in its diff and has no srs-decisions block naming them`);
    const prose = body.replace(/```srs-decisions[\s\S]*?```/, '');
    if (!d.error && DECISION_PROSE.test(prose)) add('error', `decision language in the prose ("${DECISION_PROSE.exec(prose)[0]}") and no srs-decisions block`);
    if (!out.length) add('info', 'no srs-decisions block, and no decision language found');
    return out;
  }
  if (!d.by) add('warn', 'the block names no actor ("by")');
  for (const m of d.made) {
    if ((m.class === 'ruling' || m.class === 'escalation') && !m.id) add('error', `${m.class} "${m.title ?? '?'}" has no decision record id`);
    if (m.class === 'choice' && m.constrains) add('warn', `choice "${m.title}" constrains later work: make it a ruling in the group's log`);
    if (m.class === 'choice' && groupHasLean && !m.principle && !m.lean) add('warn', `choice "${m.title}" names no principle or lean`);
  }
  for (const a of d.asks) {
    if (!a.question) add('error', `ask ${a.key ?? '?'} has no question`);
    if (!a.options?.length || !a.recommend) add('warn', `ask ${a.key ?? '?'} has no options or no recommendation`);
    if (a.blocks === 'merge' && merging && !answered.has(a.key)) add('error', `ask ${a.key} blocks merge and is unanswered`);
  }
  if (!out.length) add('ok', 'every decision is in the block, classed and placed');
  return out;
}

// An agent's comment carries its actor on its own last line; the first line stays free for markers such as <!-- wg-quorum -->.
export function signComment(body, actorId) {
  if (!actorId || /^<!-- actor: \S+ -->$/m.test(body)) return body;
  return `${body}\n\n<!-- actor: ${actorId} -->`;
}
