// fetchPR is synchronous gh calls; one worker thread per in-flight PR overlaps them without adding a single call (clerk#245).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { mapPool } from '../practice/pool.mjs';
import { fetchPR } from './ground.mjs';

if (!isMainThread && workerData?.groundFetch) {
  const { owner, ref } = workerData;
  try { parentPort.postMessage({ ok: fetchPR(owner, ref) }); } catch (e) { parentPort.postMessage({ error: String(e.stderr || e.message) }); }
}

// -> [{ref, pr, issue}] in the order of refs; a failed fetch rejects, as the serial version threw.
export const fetchPRs = (owner, refs, limit = 8) => mapPool(refs, limit, (ref) => new Promise((resolve, reject) => {
  const w = new Worker(fileURLToPath(import.meta.url), { workerData: { groundFetch: true, owner, ref } });
  w.once('message', (m) => (m.error ? reject(new Error(m.error)) : resolve(m.ok)));
  w.once('error', reject);
}));
