// A PR's decisions (clerk#77, docs/pr-decisions.md): read the srs-decisions block, check it against the standard,
// and sign an agent's comment with its actor. Pure: adapters fetch the PR; nothing here does I/O.

const HEX8 = /\b[0-9a-f]{8}\b/g;
const SP = /\bSP-\d+\b/g;
// What the owner does with an ask (answer, hold, ratify, set aside…) is never one of its options (semanticops.com#37).
const DISPOSITION = /^(ratify|set aside|hold|shelve|accept|deny|approve|reject|merge|defer|decline)\b|^(yes|no)$/i;
const STATUS_QUO = /^(do nothing|keep|leave|no change|status quo)\b/i;
// an option is "Do X: leads to Y" or {action, leads_to, pole}
const option = (o) => (typeof o === 'string'
  ? { action: o.split(/:\s/)[0].trim(), leadsTo: o.includes(': ') ? o.slice(o.indexOf(': ') + 2).trim() : null }
  : { action: String(o?.action ?? ''), leadsTo: o?.leads_to ?? null, pole: o?.pole ?? null });
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
    const k = a.key ?? '?', opts = (a.options ?? []).map(option);
    if (!a.question) add('error', `ask ${k} has no question`);
    for (const o of opts) if (DISPOSITION.test(o.action)) add('error', `ask ${k}: "${o.action}" is a disposition, what is done with the ask, not a course of action`);
    if (opts.length < 2) add('error', `ask ${k} offers ${opts.length} option(s): a decision presents at least two courses of action`);
    else if (!opts.some((o) => STATUS_QUO.test(o.action))) add('warn', `ask ${k} has no status-quo option ("Do nothing: …")`);
    for (const o of opts) if (!o.leadsTo) add('warn', `ask ${k}: option "${o.action}" does not say what it leads to`);
    if (!a.tension && !a.why_unplaced) add('warn', `ask ${k} names no tension and no why_unplaced`);
    if (!a.recommend) add('warn', `ask ${k} has no recommendation`);
    else if (opts.length && !opts.some((o) => o.action === a.recommend || o.action.startsWith(a.recommend))) add('warn', `ask ${k} recommends "${a.recommend}", which is none of its options`);
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
