import test from "node:test";
import assert from "node:assert/strict";
import { audit, report } from "./steward-audit.mjs";

const lane = "lane-x";
const now = Date.parse("2026-10-29T00:00:00Z");
const closed = { repo: "srs", number: 1, body: "Answers: SP-1", state: "CLOSED", stateReason: "COMPLETED",
  createdAt: "2026-09-01T00:00:00Z", closedAt: "2026-09-10T00:00:00Z", labels: [], comments: [], closingPrs: [], openChildren: [] };
const open = { repo: "srs-web", number: 7, title: "t", labels: [lane], updatedAt: "2026-10-01T00:00:00Z" };
const run = (c, o) => audit(c, o, { now, since: "2026-01-01T00:00:00Z", lane });

test("a completed close with no merged PR is a false close, a merged one is not", () => {
  assert.deepEqual(run([closed], []).map((r) => r.rule), ["false-close"]);
  assert.equal(run([{ ...closed, closingPrs: [{ merged: true }] }], []).length, 0);
});
test("an epic closed over open children is incomplete; plan's other rules do not leak in", () => {
  const epic = { ...closed, closingPrs: [{ merged: true }], openChildren: [{ number: 5, comments: [] }] };
  assert.deepEqual(run([epic], []).map((r) => r.rule), ["epic-incomplete"]);
  assert.equal(run([], []).length, 0);
  assert.equal(run([{ ...closed, state: "OPEN", closedAt: null, body: "no line", closingPrs: [{ merged: true }] }], []).length, 0);
});
test("history before the audit window is not counted", () => {
  assert.equal(audit([closed], [], { now, since: "2026-10-01T00:00:00Z" }).length, 0);
});
test("stale unattended: older than the cutoff, labelled, oldest first", () => {
  const fresh = { ...open, number: 8, updatedAt: "2026-10-27T00:00:00Z" };
  const older = { ...open, number: 9, updatedAt: "2026-09-20T00:00:00Z", assignee: "bot" };
  const other = { ...open, number: 10, labels: ["ready"] };
  const rows = run([], [open, fresh, older, other]);
  assert.deepEqual(rows.map((r) => r.ref), ["srs-web#9", "srs-web#7"]);
  assert.match(rows[0].detail, /held by bot/);
});
test("report lists every rule, even with no hits", () => {
  const md = report([], "2026-10-29");
  for (const r of ["false-close: 0", "epic-incomplete: 0", "stale-unattended: 0"]) assert.match(md, new RegExp(r));
});
