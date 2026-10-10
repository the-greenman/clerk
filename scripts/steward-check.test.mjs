import test from "node:test";
import assert from "node:assert/strict";
import { plan, rehomed } from "./steward-check.mjs";

const now = Date.parse("2026-10-09T00:00:00Z");
const recent = "2026-10-07T00:00:00Z", old = "2026-09-01T00:00:00Z";
const base = { repo: "srs-rust", number: 1, body: "Answers: SP-1", state: "CLOSED", stateReason: "COMPLETED",
  createdAt: old, closedAt: recent, labels: [], comments: [], closingPrs: [], openChildren: [] };
const p = (o, since = "2026-01-01T00:00:00Z") => plan([{ ...base, ...o }], { now, since });

test("completed with no merged PR is reopened", () => assert.equal(p({})[0].rule, "reopen-no-pr"));
test("merged closing PR passes; unmerged PR does not", () => {
  assert.equal(p({ closingPrs: [{ merged: true }] }).length, 0);
  assert.equal(p({ closingPrs: [{ merged: false }] }).length, 1);
});
test("no-code label, not_planned and out-of-window pass", () => {
  assert.equal(p({ labels: ["no-code"] }).length, 0);
  assert.equal(p({ stateReason: "NOT_PLANNED" }).length, 0);
  assert.equal(p({ closedAt: old }).length, 0);
});
test("our marker stops a second reopen", () => assert.equal(p({ comments: ["<!-- steward-check:reopen-no-pr -->"] }).length, 0));
test("epic: open child reopens, rehomed child does not, no PR rule on epics", () => {
  const e = { labels: ["epic"] };
  assert.equal(p({ openChildren: [{ number: 5, comments: [] }] })[0].rule, "reopen-epic"); // no label needed
  assert.equal(p({ ...e }).length, 0);
  assert.equal(p({ ...e, openChildren: [{ number: 5, comments: [] }] })[0].rule, "reopen-epic");
  assert.equal(p({ ...e, openChildren: [{ number: 5, comments: ["re-homed to #9"] }] }).length, 0);
  assert.equal(p({ ...e, openChildren: [{ number: 5, comments: ["re-homed to #5"] }] }).length, 1);
});
test("rehomed needs wording and another number", () => {
  assert.equal(rehomed({ number: 1, comments: ["see #2"] }), false);
  assert.equal(rehomed({ number: 1, comments: ["moved to the-greenman/srs#2"] }), true);
});
test("answers: missing line comments once", () => {
  const open = { state: "OPEN", stateReason: null, closedAt: null, createdAt: recent, body: "no line" };
  assert.equal(p(open)[0].rule, "answers");
  assert.equal(p({ ...open, body: "x\nAnswers: SP-3" }).length, 0);
  assert.equal(p({ ...open, body: "No affirmed problem yet: foo" }).length, 0);
  assert.equal(p({ ...open, comments: ["<!-- steward-check:answers -->"] }).length, 0);
  assert.equal(p({ ...open, createdAt: old }).length, 0);
  assert.equal(p({ ...open, state: "CLOSED" }).length, 0);
});
test("commit closer, merged-PR closer, duplicate label and non-completed epic pass; bots not nagged", () => {
  assert.equal(p({ closer: { __typename: "Commit" } }).length, 0);
  assert.equal(p({ closer: { __typename: "PullRequest", merged: true } }).length, 0);
  assert.equal(p({ labels: ["duplicate"] }).length, 0);
  assert.equal(p({ labels: ["epic"], stateReason: "NOT_PLANNED", openChildren: [{ number: 5, comments: [] }] }).length, 0);
  assert.equal(p({ state: "OPEN", closedAt: null, createdAt: recent, body: "x", bot: true }).length, 0);
});
test("go-forward cutoff, reset closes and DUPLICATE are never acted on", () => {
  assert.equal(p({}, "2026-10-06T00:00:00Z").length, 1);
  assert.equal(p({}, "2026-10-08T12:00:00Z").length, 0); // closed 10-07, before cutoff
  assert.equal(p({ comments: ["Closed in the SemanticOps roadmap reset (2026-10-08)"] }).length, 0);
  assert.equal(p({ stateReason: "DUPLICATE" }).length, 0);
  assert.equal(plan([{ ...base }], { now }).length, 0); // default cutoff 2026-10-09 > closedAt
});
