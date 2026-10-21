// Shelling out: the pinned srs CLI and gh (or curl). Nothing here knows about the agenda.
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

// gh when installed; otherwise `gh api` over curl (a Claude Code cloud session has no gh). Auth from GH_TOKEN/GITHUB_TOKEN
// when set; a cloud session's egress proxy authenticates the attached repos without one.
const HAS_GH = spawnSync('gh', ['--version'], { stdio: 'ignore' }).status === 0;
export const gh = (args, input) => (HAS_GH ? run('gh', args, { input }) : ghApiCurl(args));

// The `gh api` subset the clerk uses: -X, -f, -F, --paginate, --slurp. Anything else (--jq, porcelain) throws.
export function ghApiRequest(args) {
  let method, path, paginate = false, slurp = false;
  const fields = [];
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '-X' || a === '--method') method = args[++i];
    else if (a === '-f' || a === '-F') fields.push([args[++i], a === '-F']);
    else if (a === '--paginate') paginate = true;
    else if (a === '--slurp') slurp = true;
    else if (args[0] !== 'api' || a.startsWith('-') || path) throw new Error(`gh is not installed; no curl fallback for: gh ${args.join(' ')}`);
    else path = a;
  }
  if (args[0] !== 'api' || !path) throw new Error(`gh is not installed; no curl fallback for: gh ${args.join(' ')}`);
  method ??= fields.length ? 'POST' : 'GET';
  const typed = (v) => (v === 'true' ? true : v === 'false' ? false : v === 'null' ? null : /^-?\d+$/.test(v) ? Number(v) : v);
  const kvs = fields.map(([kv, isTyped]) => { const eq = kv.indexOf('='); const v = kv.slice(eq + 1); return [kv.slice(0, eq), isTyped ? typed(v) : v]; });
  let url = `https://api.github.com/${path.replace(/^\//, '')}`;
  let body;
  if (method === 'GET') { if (kvs.length) url += (url.includes('?') ? '&' : '?') + new URLSearchParams(kvs.map(([k, v]) => [k, String(v)])); }
  else if (kvs.length) {
    body = {};
    for (const [k, v] of kvs) if (k.endsWith('[]')) (body[k.slice(0, -2)] ??= []).push(v); else body[k] = v;
  }
  return { method, url, body, paginate, slurp };
}

function ghApiCurl(args) {
  const { method, url, body, paginate, slurp } = ghApiRequest(args);
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const pages = [];
  for (let next = url; next;) {
    const out = run('curl', ['-sS', '--fail-with-body', '-X', method, '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28',
      ...(token ? ['-H', `Authorization: Bearer ${token}`] : []), ...(body ? ['-H', 'Content-Type: application/json', '--data-binary', '@-'] : []),
      '-w', '\n%header{link}', next], { input: body ? JSON.stringify(body) : undefined, timeout: 180_000 });
    const nl = out.lastIndexOf('\n');
    if (!paginate) return out.slice(0, nl);
    pages.push(JSON.parse(out.slice(0, nl) || 'null'));
    next = /<([^>]+)>;\s*rel="next"/.exec(out.slice(nl + 1))?.[1];
  }
  return JSON.stringify(slurp ? pages : pages.flat());
}
export const ghJson = (args) => JSON.parse(gh(args));

// Group state for the agenda and the desk: {pause, merged, budget}, from the same reads and rules as upkeep (practice/upkeep.mjs).
export async function groupState(repo, group) {
  const { loadSettings } = await import('./settings.mjs');
  const { groupStates } = await import('./upkeep.mjs');
  const s = groupStates(loadSettings(repo), [group])[group.label];
  return { pause: s.pause, merged: s.merged, budget: s.budget };
}

export function openUrl(url) { spawnSync('xdg-open', [url], { stdio: 'ignore' }); }
