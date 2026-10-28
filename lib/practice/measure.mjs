// measure: an indicator's result for a cycle as the fieldValues of an argument/measurement-result record. Pure.
// The script computes and states; it never judges. `evaluator` stays pending for the owner's session (clerk#25,
// principles: stated over assumed; agents do not affirm or judge on the owner's behalf).
export const PENDING_EVALUATOR = 'pending: the owner\'s session (useful, noisy or misleading)';

const pct = (x) => (x === null ? 'n/a' : `${Math.round(x * 100)}%`);

// since/until: YYYY-MM-DD or ISO instants; until null = open end. stats: the i1() result.
const period = (since, until) => `${since}..${until ?? 'now'}`;

// -> {result_id, observed_finding, observation_period, evaluator}
export function i1Result({ stats, since, until, cycle }) {
  const per = period(since, until), unk = stats.unknown ? ` ${stats.unknown} PR(s) close an issue this token cannot read and are left out.` : '';
  const levels = Object.entries(stats.byLevel).map(([l, n]) => `${l} ${n}`).join(', ');
  return {
    result_id: `I1 ${per}`,
    observed_finding: `I1 for ${cycle ? `${cycle}, ` : ''}PRs merged ${per}: ${stats.grounded}/${stats.total} grounded to a problem (${pct(stats.share)}); ${stats.full}/${stats.total} with an affirmed persona and domain (${pct(stats.fullShare)}). By level: ${levels}.${unk}`,
    observation_period: per,
    evaluator: PENDING_EVALUATOR,
  };
}

// The indicators of the handbook's stage 15. I2 to I4 have no computation yet: they get no result, and are named so.
export const PENDING_INDICATORS = ['I2', 'I3', 'I4'];
