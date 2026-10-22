// The service's one job: keep the owner's view current. Fast-forward the programme and the clerk when they are clean, then
// rewrite the programme and desk snapshots by running the clerk's own commands (no semantics here). One sync at a time across
// every process on the machine; files are swapped in whole, and output that is not JSON never replaces a good snapshot.
// Lifted from srs-lab control-room/clerk-bridge.mjs. `run` is injected so tests need no git, gh or srs.
import { execFile } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FILES = { programme: 'programme.json', desk: 'desk.json', status: 'sync.json', lock: 'sync.lock' };
const STALE_MS = 30 * 60e3; // a lock older than this is stale even if its pid is alive again (pid reuse after a reboot)

export const execRun = (cmd, args, { cwd } = {}) => new Promise((ok, no) =>
  execFile(cmd, args, { cwd, maxBuffer: 1 << 28, timeout: 300000 }, (e, out, err) =>
    (e ? no(new Error(`${cmd} ${args[0]}${args[1] ? ' ' + args[1] : ''}: ${String(err || e.message).trim().split('\n').slice(-3).join(' ').slice(0, 400)}`)) : ok(out))));

export function writeAtomic(path, text) {
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
}

// The lock: a file named sync.lock holding the holder's pid, created atomically (link of a complete temp file, which fails if the
// lock exists). A lock whose pid is gone, or which is older than STALE_MS, is stale: it is renamed aside (only one taker's rename
// succeeds) and the link retried. Release removes the lock only if it still holds our pid.
export function pidLock(path, { pid = process.pid, alive = pidAlive, now = () => Date.now(), staleMs = STALE_MS } = {}) {
  const holder = () => { try { return { pid: Number(readFileSync(path, 'utf8')), age: now() - statSync(path).mtimeMs }; } catch { return null; } };
  const tryLink = () => {
    const tmp = `${path}.${pid}.tmp`;
    writeFileSync(tmp, String(pid));
    try { linkSync(tmp, path); return true; } catch (e) { if (e.code === 'EEXIST') return false; throw e; } finally { rmSync(tmp, { force: true }); }
  };
  const isStale = (h) => !h || !alive(h.pid) || h.age > staleMs;
  return {
    held: () => { const h = holder(); return Boolean(h) && !isStale(h); },
    take() {
      if (tryLink()) return true;
      if (!isStale(holder())) return false;
      try { renameSync(path, `${path}.stale.${pid}`); rmSync(`${path}.stale.${pid}`, { force: true }); } catch { /* another taker moved it first */ }
      return tryLink();
    },
    release() { if (holder()?.pid === pid) rmSync(path, { force: true }); },
  };
}

// The desk reads GitHub heavily (about 150 calls), so it refreshes on its own, longer cadence (deskMinutes), counted from the
// last attempt so a failing desk does not retry every sync. A forced sync (POST /api/sync) refreshes both.
export function createSync({ live, clerkDir, stateDir, everyMinutes, deskMinutes = 30, pull = true, run = execRun, now = () => new Date(), pid = process.pid, alive = pidAlive }) {
  mkdirSync(stateDir, { recursive: true });
  const at = (f) => join(stateDir, f);
  const clerk = (args) => run(process.execPath, [join(clerkDir, 'bin', 'clerk.mjs'), ...args, '--repo', live], { cwd: clerkDir });
  const lock = pidLock(at(FILES.lock), { pid, alive, now: () => now().getTime() });
  let running = null;
  const read = () => { try { return JSON.parse(readFileSync(at(FILES.status), 'utf8')); } catch { return {}; } };
  const headOf = async (dir) => (await run('git', ['log', '-1', '--format=%h %s'], { cwd: dir }).catch(() => '')).trim() || null;

  // never forces: local changes or a diverged branch are reported, and the checkout is read as it stands
  const ff = async (dir) => {
    if ((await run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: dir })).trim()) return `${dir.split('/').pop()}: local changes, not pulled`;
    await run('git', ['pull', '--ff-only', '-q'], { cwd: dir });
    return null;
  };

  function status() {
    const s = read();
    return { at: s.at ?? null, ms: s.ms ?? null, head: s.head ?? null, deskAt: s.deskAt ?? null, notes: s.notes ?? [], everyMinutes, deskMinutes,
      clerkUpdated: Boolean(s.clerkUpdated), syncing: Boolean(running) || lock.held() };
  }

  // resolves when this sync (or the one already running here) is done; another process's sync is left to finish on its own
  function syncNow({ force = true } = {}) {
    if (running) return running;
    if (!lock.take()) return Promise.resolve(status());
    running = (async () => {
      const t0 = now().getTime(), notes = [], prev = read();
      const deskDue = force || !prev.deskTriedAt || t0 - Date.parse(prev.deskTriedAt) >= deskMinutes * 60e3;
      const clerkBefore = await headOf(clerkDir);
      if (pull) for (const d of [live, clerkDir]) notes.push(await ff(d).catch((e) => e.message));
      let deskAt = prev.deskAt ?? null, deskTriedAt = prev.deskTriedAt ?? null;
      for (const [file, args] of [[FILES.programme, ['snapshot', '--json']], ...(deskDue ? [[FILES.desk, ['desk', '--json']]] : [])]) {
        if (file === FILES.desk) deskTriedAt = now().toISOString();
        try {
          const out = await clerk(args);
          JSON.parse(out); // a truncated or broken output never replaces the last good snapshot
          writeAtomic(at(file), out);
          if (file === FILES.desk) deskAt = now().toISOString();
        } catch (e) { notes.push(`${file}: ${e instanceof SyntaxError ? 'output was not JSON; kept the last snapshot' : e.message}`); }
      }
      const clerkUpdated = Boolean(clerkBefore) && (await headOf(clerkDir)) !== clerkBefore;
      writeAtomic(at(FILES.status), JSON.stringify({ at: now().toISOString(), ms: now().getTime() - t0, head: await headOf(live), deskAt, deskTriedAt, clerkUpdated, notes: notes.filter(Boolean) }, null, 1));
    })().finally(() => { lock.release(); running = null; }).then(status);
    return running;
  }

  const data = (name) => { const p = at(FILES[name]); return existsSync(p) ? readFileSync(p, 'utf8') : null; };
  return { status, syncNow, data };
}

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
