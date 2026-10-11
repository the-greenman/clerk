// What an issue or PR says it answers: pure. Minimal on purpose; clerk claim, clerk ground and steward-check all read `Answers:` here and nowhere else.
// body -> {problems:['SP-12'], none:'<reason>'|undefined, stated:boolean}
export function answersOf(body = '') {
  const line = /^[\s>*_-]*Answers:?\s*(.+)$/im.exec(body)?.[1];
  const none = /^[\s>*_-]*No affirmed problem yet:?\s*(.*)$/im.exec(body);
  return { problems: line ? [...line.matchAll(/\bSP-\d+\b/g)].map((m) => m[0]) : [], none: none ? none[1].trim() || 'no reason given' : undefined, stated: Boolean(line || none) };
}
