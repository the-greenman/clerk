// The clerk's self-test, as a marker comment on the digest issue (pure). scripts/doctor.mjs runs the probes.
export const MARKER = 'clerk-doctor';
const RE = new RegExp(`^<!-- ${MARKER} status=(ok|fail) env=(\\S+) at=(\\S+) -->`);

// checks: [{name, ok, detail}] -> 'ok' | 'fail'
export const verdict = (checks) => (checks.every((c) => c.ok) ? 'ok' : 'fail');

export function healthComment({ status, env, at }, checks) {
  return [`<!-- ${MARKER} status=${status} env=${env} at=${at} -->`, `**Clerk doctor (${env}): ${status}**`, '',
    ...checks.map((c) => `- ${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? `: ${c.detail}` : ''}`)].join('\n');
}

// The latest marker among issue comments (REST rows), optionally for one env -> {status, env, at, url, failing} | null.
export function latestHealth(comments, env) {
  for (const c of [...(comments ?? [])].reverse()) {
    const m = RE.exec(String(c.body ?? ''));
    if (!m || (env && m[2] !== env)) continue;
    const failing = String(c.body).split('\n').filter((l) => l.startsWith('- ✗ ')).map((l) => l.slice(4));
    return { status: m[1], env: m[2], at: m[3], url: c.html_url, failing };
  }
  return null;
}

// 'ok' | 'fail' | 'stale' (no marker for maxHours) | 'absent'
export function healthState(h, now, maxHours = 26) {
  if (!h) return 'absent';
  if (Date.parse(now) - Date.parse(h.at) > maxHours * 3600e3) return 'stale';
  return h.status;
}
