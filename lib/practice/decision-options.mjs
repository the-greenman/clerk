// A decision record's options in one model (clerk#128). Pure. The record keeps them as prose in `alternatives_considered`;
// this reads that prose into the same shape pr-decisions.askOptions gives an ask: [{action, leadsTo, pole, recommended}].
// Marked prose "(a) Do X: leads to Y (chosen)", "1. ...", "- ..." gives one option per marker; unmarked prose, one per sentence
// ending in a full stop at a line end, else the whole text is one option (and so fails the two-option check).
const MARK = /^\s*(?:\(?[a-z0-9]{1,2}[).]|[-*•])\s+/i;
const STATUS_QUO = /^(do nothing|keep|leave|no change|status quo|treat .* as internal)\b|\b(stays?|waits?)\b/i;
const CHOSEN = /\((?:chosen|recommended)\)|\bchosen\b/i;

export function parseProseOptions(text = '') {
  const t = String(text ?? '').trim();
  if (!t) return [];
  const lines = t.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  let parts = lines.length > 1 && lines.every((l) => MARK.test(l)) ? lines.map((l) => l.replace(MARK, '')) : null;
  if (!parts) { // "(a) ... (b) ..." on one line
    const inline = t.split(/\s(?=\([a-z]\)\s)/i);
    parts = inline.length > 1 ? inline.map((l) => l.replace(MARK, '')) : lines.length > 1 ? lines : [t];
  }
  return parts.map((p) => {
    const i = p.indexOf(': ');
    const action = (i > 0 ? p.slice(0, i) : p).replace(CHOSEN, '').trim().replace(/[.;]$/, '');
    return { action, leadsTo: i > 0 ? p.slice(i + 2).replace(CHOSEN, '').trim() : null, pole: null, recommended: CHOSEN.test(p), statusQuo: STATUS_QUO.test(action) };
  });
}

// A proposed decision must be a choice: advice only (D4), never blocks. [{level, text}]
export function optionWarnings(opts) {
  const w = [];
  if (opts.length < 2) w.push({ level: 'warn', text: 'not a choice: fewer than two options; list each option, including doing nothing' });
  else {
    if (!opts.some((o) => o.statusQuo)) w.push({ level: 'warn', text: 'no status-quo option: name what happens if nothing changes' });
    if (opts.some((o) => !o.leadsTo)) w.push({ level: 'info', text: 'options without "leads to": say what each one leads to' });
  }
  return w;
}

// One option per line, with the recommended marker, for the session agenda.
export const optionLines = (opts, indent = '    ') => opts.map((o) => `${indent}${o.recommended ? '* ' : '- '}${o.action}${o.leadsTo ? ` -> ${o.leadsTo}` : ''}`);
