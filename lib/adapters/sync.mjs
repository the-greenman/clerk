// The service's one job: keep the owner's view current. Fast-forward the programme and the clerk when they are clean, then
// rewrite the programme and desk snapshots by running the clerk's own commands (no semantics here). One sync at a time across
// every process on the machine (a pid lock, taken over when its holder is gone); files are swapped in whole, so a reader never
// sees half a snapshot. Lifted from srs-lab control-room/clerk-bridge.mjs. `run` is injected so tests need no git, gh or srs.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FILES = { programme: 'programme.json', desk: 'desk.json', status: 'sync.json', lock: 'sync.lock' };

export const execRun = (cmd, args, { cwd } = {}) => new Promise((ok, no) =>
  execFile(cmd, args, { cwd, maxBuffer: 1 << 28, timeout: 300000 }, (e, out, err) =>
    (e ? no(new Error(`${cmd} ${args[0]}${args[1] ? ' ' + args[1] : ''}: ${String(err || e.message).trim().split('\n').slice(-3).join(' ').slice(0, 400)}`)) : ok(out))));

export function writeAtomic(path, text) {
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
}

// The desk reads GitHub heavily (several calls per open PR), so it refreshes on its own, longer cadence (deskMinutes); a forced
// sync (POST /api/sync) refreshes both. The programme snapshot reads only the srs CLI.
export function createSync({ live, clerkDir, stateDir, everyMinutes, deskMinutes = 30, run = execRun, now = () => new Date(), pid = process.pid, alive = pidAlive }) {
  mkdirSync(stateDir, { recursive: true });
  const at = (f) => join(stateDir, f);
  const clerk = (args) => run(process.execPath, [join(clerkDir, 'bin', 'clerk.mjs'), ...args, '--repo', live], { cwd: clerkDir });
  let running = null;

  const lockHeld = () => { try { return alive(Number(readFileSync(at(FILES.lock), 'utf8'))); } catch { return false; } };
  const takeLock = () => {
    try { writeFileSync(at(FILES.lock), String(pid), { flag: 'wx' }); return true; }
    catch { if (lockHeld()) return false; writeFileSync(at(FILES.lock), String(pid)); return true; }
  };
  const read = () => { try { return JSON.parse(readFileSync(at(FILES.status), 'utf8')); } catch { return {}; } };

  // never forces: local changes or a diverged branch are reported, and the checkout is read as it stands
  const ff = async (dir) => {
    if ((await run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: dir })).trim()) return `${dir.split('/').pop()}: local changes, not pulled`;
    await run('git', ['pull', '--ff-only', '-q'], { cwd: dir });
    return null;
  };

  function status() {
    const s = read();
    return { at: s.at ?? null, ms: s.ms ?? null, head: s.head ?? null, deskAt: s.deskAt ?? null, notes: s.notes ?? [], everyMinutes, deskMinutes, syncing: Boolean(running) || lockHeld() };
  }

  // resolves when this sync (or the one already running here) is done; another process's sync is left to finish on its own
  function syncNow({ force = true } = {}) {
    if (running) return running;
    if (!takeLock()) return Promise.resolve(status());
    running = (async () => {
      const t0 = now().getTime(), notes = [], prev = read();
      const deskDue = force || !prev.deskAt || t0 - Date.parse(prev.deskAt) >= deskMinutes * 60e3;
      for (const d of [live, clerkDir]) notes.push(await ff(d).catch((e) => e.message));
      let deskAt = prev.deskAt ?? null;
      for (const [file, args] of [[FILES.programme, ['snapshot', '--json']], ...(deskDue ? [[FILES.desk, ['desk', '--json']]] : [])]) {
        try { writeAtomic(at(file), await clerk(args)); if (file === FILES.desk) deskAt = now().toISOString(); } catch (e) { notes.push(`${file}: ${e.message}`); }
      }
      const head = (await run('git', ['log', '-1', '--format=%h %s'], { cwd: live }).catch(() => '')).trim() || null;
      writeAtomic(at(FILES.status), JSON.stringify({ at: now().toISOString(), ms: now().getTime() - t0, head, deskAt, notes: notes.filter(Boolean) }, null, 1));
    })().finally(() => { rmSync(at(FILES.lock), { force: true }); running = null; }).then(status);
    return running;
  }

  const data = (name) => { const p = at(FILES[name]); return existsSync(p) ? readFileSync(p, 'utf8') : null; };
  return { status, syncNow, data };
}

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
