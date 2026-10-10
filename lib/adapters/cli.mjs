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

// Group state: reuse the programme's own functions rather than re-deriving them.
export function groupState(repo) {
  const sh = 'source scripts/pr-upkeep.sh; echo "$(wg_pause_check)"; gh api -X GET search/issues -f q="$(wg_budget_query "$(wg_cycle_start)")" --jq .total_count; echo "$WG_BUDGET"';
  const r = spawnSync('bash', ['-c', sh], { cwd: repo, encoding: 'utf8' });
  const [pause = 'paused: unreadable', merged = '?', budget = '10'] = r.stdout.trim().split('\n');
  return { pause, merged, budget };
}

export function openUrl(url) { spawnSync('xdg-open', [url], { stdio: 'ignore' }); }
