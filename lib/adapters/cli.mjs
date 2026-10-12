// Shelling out: the pinned srs CLI and gh. Nothing here knows about the agenda.
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['pipe', 'pipe', 'pipe'], ...opts });

export function srsCli(repo) {
  // The clerk's own fetcher, reading the pin from the programme's validate.yml; the programme carries no scripts.
  if (process.env.SRS_CLI_PATH?.trim()) return process.env.SRS_CLI_PATH.trim();
  const out = run('node', [fileURLToPath(new URL('../../scripts/fetch-pinned-srs.mjs', import.meta.url)), '--repo', repo]);
  return /SRS_CLI_PATH=(\S+)/.exec(out)[1];
}

// srs(cli, repo, args, input?) -> payload; throws with the CLI's error codes on ok:false.
export function srs(cli, repo, args, input) {
  const out = run(cli, [...args, '--repo', repo], { input: input === undefined ? undefined : JSON.stringify(input) });
  const j = JSON.parse(out);
  if (!j.ok) throw new Error(`srs ${args.slice(0, 2).join(' ')}: ${(j.errors ?? []).map((e) => e.code + ' ' + e.message).join('; ')}`);
  return j.payload;
}

export const gh = (args, input) => run('gh', args, { input });
export const ghJson = (args) => JSON.parse(gh(args));

// Group state: reuse the clerk's pr-upkeep.sh functions rather than re-deriving them; OWNER and the report issue come from the programme settings,
// the label, budget, cycle close and pause limit from the group's charter (loadGroups).
export async function groupState(repo, group) {
  const { loadSettings, issueRef } = await import('./settings.mjs');
  const st = loadSettings(repo);
  const env = { ...process.env, OWNER: st.githubOwner, WG_REPORT_ISSUE: issueRef(st.reportIssue, st.githubOwner).path,
    WG_LABEL: group.label, WG_BUDGET: String(group.budget), WG_CYCLE_CLOSE: group.cycleClose, WG_MAX_UNACKED: String(group.maxUnacked) };
  const sh = `source "$PR_UPKEEP";  echo "$(wg_pause_check)"; wg_budget_count "$(wg_cycle_start)" ${group.repos.join(' ')}; echo "$WG_BUDGET"`;
  const r = spawnSync('bash', ['-c', sh], { cwd: repo, encoding: 'utf8', env: { ...env, PR_UPKEEP: fileURLToPath(new URL('../../scripts/pr-upkeep.sh', import.meta.url)) } });
  const [pause = 'paused: unreadable', merged = '?', budget = String(group.budget)] = r.stdout.trim().split('\n');
  return { pause, merged, budget };
}

export function openUrl(url) { spawnSync('xdg-open', [url], { stdio: 'ignore' }); }
