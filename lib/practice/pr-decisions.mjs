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
const recommends = (a, o) => Boolean(a.recommend) && (o.action === a.recommend || o.action.startsWith(a.recommend));
// An ask's options in one shape, whichever form the block wrote them in: [{action, leadsTo, pole, recommended}].
export const askOptions = (a) => (a.options ?? []).map(option).map((o) => ({ ...o, recommended: recommends(a, o) }));
const DECISION_PROSE = /\b(we (?:decided|chose|opted)|decided to|chose to|opted (?:for|to)|instead of|trade-?off|decision asked|owner decision)\b/i;

// body -> {block, error, by, answers, made, asks, review, ids, legacy}. The clerk's loose signals (Answers:, Decision asked:,
// Mode, Door, Cell, Builder, Ruling, Mandate) are read too, block or not; when the block exists it is authoritative.
export function parseDecisions(body = '') {
  const m = /```srs-decisions\s*\n([\s\S]*?)```/.exec(body);
  let block = null, error = null;
  if (m) { try { block = JSON.parse(m[1]); } catch (e) { error = e.message; } }
  const line = (re) => re.exec(body)?.[1]?.trim() ?? null;
  return {
    block, error, by: block?.by ?? null,
    answers: [...new Set([...(block?.answers ?? []), ...(/^\s*Answers:\s*(.+)$/im.exec(body)?.[1].match(SP) ?? [])])],
    made: (block?.made ?? []).map((x) => ({ ...x, class: x.class ?? (x.id ? 'ruling' : 'choice') })),
    asks: block?.asks ?? [], review: block?.review ?? null,
    ids: [...new Set(body.replace(/```srs-decisions[\s\S]*?```/, '').match(HEX8) ?? [])],
    legacy: {
      asked: line(/^\W*(?:Owner )?[Dd]ecision asked:[ \t]*(\S[^\n]*)/m), mode: line(/\bMode:\s*([\w-]+)/), door: line(/\bDoor:?\s*(\d)/),
      cell: line(/\bCell:\s*([^.\n]+)/), builder: line(/^\s*Builder:\s*(\S+)/m), ruling: line(/^\s*Ruling:\s*([^\n]+)/m), mandate: line(/^\s*Mandate:\s*([^\n]+)/m),
    },
  };
}

// Who speaks in a PR comment. Agents post through the owner's token, so the body says more than the author:
// c = {body, user?, assoc?, userType?} -> {kind: quorum|answer|review-request|agent|human|bot|unsigned, actor, ...}
export function classifyComment(c) {
  const b = c.body ?? '';
  const q = /^<!-- wg-quorum -->\s*builder=(\S+)\s+reviewer=(\S+)\s+gates=(\S+)\s+mandate=(\S+)\s+verdict=(\w+)/.exec(b);
  if (q) return { kind: 'quorum', actor: q[2], verdict: q[5], gates: q[3], builder: q[1], mandate: q[4] };
  const a = /^<!-- srs:answer ask=(\S+?)(?:\s+choice="([^"]*)")? -->/.exec(b);
  if (a) return { kind: 'answer', ask: a[1], choice: a[2] ?? null, actor: c.user ?? null };
  const r = /^<!-- srs:review-request(?: seat=(\S+))?(?: stance=(\S+))? -->/.exec(b);
  if (r) return { kind: 'review-request', seat: r[1] ?? null, stance: r[2] ?? null, actor: c.user ?? null };
  const signed = /^<!-- actor: (\S+) -->/m.exec(b)?.[1];
  if (signed) return { kind: signed.startsWith('agent:') ? 'agent' : 'human', actor: signed, signed: true };
  if (c.userType === 'Bot') return { kind: 'bot', actor: c.user ?? null };
  const agent = /\bagent:[\w-]+/.exec(b)?.[0] ?? (/🤖 Generated with|Claimed by agent|<!-- wg-/.test(b) ? 'agent' : null);
  if (agent) return { kind: 'agent', actor: agent };
  // an unsigned owner-account comment could be the owner or an agent
  return c.assoc === 'OWNER' ? { kind: 'unsigned', actor: c.user ?? null } : { kind: 'human', actor: c.user ?? null };
}

// Owner answers posted on the PR: <!-- srs:answer ask=<key> choice="…" -->
export function answersFrom(comments = []) {
  const out = new Map();
  for (const c of comments) { const w = classifyComment(typeof c === 'string' ? { body: c } : c); if (w.kind === 'answer') out.set(w.ask, w.choice ?? true); }
  return out;
}

// What a parsed PR asks the owner, or null: the first block ask with a question when there is a block (it is authoritative,
// so `asks: []` asks nothing), else its "Decision asked:" line (template T9) unless that says nothing ("none", "n/a", "-", a
// `<placeholder>`). A gate:owner-merge PR that asks nothing hands the owner a merge with no question (clerk#165).
const EMPTY_ASK = /^(?:(?:none|nothing|n\/?a|no (?:decision|question))\b|[-—]+$|<)/i;
export function ownerQuestion(d) {
  if (d.block) return String(d.asks.find((a) => String(a?.question ?? '').trim())?.question ?? '').trim() || null;
  const line = (d.legacy?.asked ?? '').replace(/^[*_\s]+|[*_\s]+$/g, '').replace(/\.$/, '');
  return line && !EMPTY_ASK.test(line) ? line : null;
}
export const asksOwner = (d) => ownerQuestion(d) !== null;

// -> [{level: error|warn|info|ok, text}]. merging: the PR is about to merge (merge-blocking asks must be answered).
// labels, gates: the PR's label names and the work-status gates ({auto, owner}); given, the PR's gate is checked too (clerk#165).
// groupLabels: the chartered groups' labels; only those gate a PR, as upkeep routes it (any wg: label when not given).
export function checkDecisions(d, { body = '', merging = false, answered = new Map(), groupHasLean = false, recordsInDiff = 0, labels: raw = null, gates = null, groupLabels = null, draft = false } = {}) {
  const out = [], add = (level, text) => out.push({ level, text });
  const labels = raw?.map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean);
  if (labels && gates && !draft) { // a draft is not classified yet; the desk and upkeep skip drafts too
    if (labels.includes(gates.owner) && !asksOwner(d)) add('error', `it carries ${gates.owner} and asks the owner nothing: add an ask with the question (or a "Decision asked:" line), or classify it ${gates.auto}`);
    const group = (l) => (groupLabels ? groupLabels.includes(l) : l.startsWith('wg:'));
    if (!labels.some((l) => l === gates.auto || l === gates.owner || group(l))) {
      const stale = labels.filter((l) => l.startsWith('wg:') && !group(l));
      add('error', `it carries no gate label and no ${stale.length ? `chartered working-group label (${stale.join(', ')} is no chartered group's)` : 'working-group label'}: classify it ${gates.auto} or ${gates.owner}`);
    }
  }
  if (!d.block) {
    if (d.error) add('error', `the srs-decisions block does not parse: ${d.error}`);
    if (recordsInDiff) add('error', `it records ${recordsInDiff} decision(s) in its diff and has no srs-decisions block naming them`);
    const prose = body.replace(/```srs-decisions[\s\S]*?```/, '');
    if (!d.error && DECISION_PROSE.test(prose)) add('error', `decision language in the prose ("${DECISION_PROSE.exec(prose)[0]}") and no srs-decisions block`);
    if (!out.some((f) => f.level === 'error')) add('info', 'no srs-decisions block, and no decision language found');
    return out;
  }
  if (!d.by) add('warn', 'the block names no actor ("by")');
  for (const m of d.made) {
    if ((m.class === 'ruling' || m.class === 'escalation') && !m.id) add('error', `${m.class} "${m.title ?? '?'}" has no decision record id`);
    if (m.class === 'choice' && m.constrains) add('warn', `choice "${m.title}" constrains later work: make it a ruling in the group's log`);
    if (m.class === 'choice' && groupHasLean && !m.principle && !m.lean) add('warn', `choice "${m.title}" names no principle or lean`);
  }
  for (const a of d.asks) {
    const k = a.key ?? '?', opts = askOptions(a);
    if (!a.question) add('error', `ask ${k} has no question`);
    for (const o of opts) if (DISPOSITION.test(o.action)) add('error', `ask ${k}: "${o.action}" is a disposition, what is done with the ask, not a course of action`);
    if (opts.length < 2) add('error', `ask ${k} offers ${opts.length} option(s): a decision presents at least two courses of action`);
    else if (!opts.some((o) => STATUS_QUO.test(o.action))) add('warn', `ask ${k} has no status-quo option ("Do nothing: …")`);
    for (const o of opts) if (!o.leadsTo) add('warn', `ask ${k}: option "${o.action}" does not say what it leads to`);
    if (!a.tension && !a.why_unplaced) add('warn', `ask ${k} names no tension and no why_unplaced`);
    if (!a.recommend) add('warn', `ask ${k} has no recommendation`);
    else if (opts.length && !opts.some((o) => o.recommended)) add('warn', `ask ${k} recommends "${a.recommend}", which is none of its options`);
    if (a.blocks === 'merge' && merging && !answered.has(a.key)) add('error', `ask ${a.key} blocks merge and is unanswered`);
  }
  const named = d.ids.filter((x) => ![...d.made, ...d.asks].some((m) => m.id?.startsWith(x)));
  if (named.length) add('info', `ids named in the prose but not in the block: ${named.join(', ')} (fine if they are context, not decisions)`);
  if (!out.some((f) => f.level !== 'info')) add('ok', 'every decision is in the block, classed and placed');
  return out;
}

// An agent's comment carries its actor on its own last line; the first line stays free for markers such as <!-- wg-quorum -->.
export function signComment(body, actorId) {
  if (!actorId || /^<!-- actor: \S+ -->$/m.test(body)) return body;
  return `${body}\n\n<!-- actor: ${actorId} -->`;
}
