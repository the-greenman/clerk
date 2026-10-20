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

// Group state for the agenda and the desk: {pause, merged, budget}, from the same reads and rules as upkeep (practice/upkeep.mjs).
export async function groupState(repo, group) {
  const { loadSettings } = await import('./settings.mjs');
  const { groupStates } = await import('./upkeep.mjs');
  const s = groupStates(loadSettings(repo), [group])[group.label];
  return { pause: s.pause, merged: s.merged, budget: s.budget };
}

export function openUrl(url) { spawnSync('xdg-open', [url], { stdio: 'ignore' }); }
