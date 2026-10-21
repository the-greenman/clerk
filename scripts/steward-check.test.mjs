import test from "node:test";
import assert from "node:assert/strict";
import { plan, rehomed, landedRefs, prereqRefs } from "./steward-check.mjs";

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

test("Landed: a named MERGED PR counts as landed; a named unmerged PR or issue does not", () => {
  assert.equal(p({ landedPrs: [{ repo: "srs-web", number: 548, merged: true }] }).length, 0);
  assert.equal(p({ landedPrs: [{ repo: "srs-web", number: 548, merged: false }] })[0].rule, "reopen-no-pr");
});
test("landedRefs reads repo#n, bare #n after a repo ref, and only text after Landed", () => {
  const key = (rs) => rs.map((r) => `${r.repo}#${r.number}`);
  assert.deepEqual(key(landedRefs(["Landed: srs-web#548 (the affirm UI) merged on 2026-10-12."], "srs-web")), ["srs-web#548"]);
  assert.deepEqual(key(landedRefs(["Done since #12. Landed via srs-programme#44, #45, #46 and #47. Closed."], "srs-programme")),
    ["srs-programme#44", "srs-programme#45", "srs-programme#46", "srs-programme#47"]);
  assert.deepEqual(key(landedRefs(["Landed: method (srs-programme#17), visualiser (#23), srs#921 and #923."], "x")),
    ["srs-programme#17", "srs-programme#23", "srs#921", "srs#923"]);
  assert.deepEqual(key(landedRefs(["Landed in #7", "- landed_as: https://github.com/o/r/pull/118", "see #9"], "r")), ["r#7"]);
});

// clerk#113: a prerequisite named in text must also be a blocked-by edge.
test("prereqRefs: Blocked-by lines and 'once X lands', bare #n in the issue's repo", () => {
  assert.deepEqual(prereqRefs("x\nBlocked by: the-greenman/srs-rust#1333, then an srs-rust release.\n", "srs-web"), ["srs-rust#1333"]);
  assert.deepEqual(prereqRefs("Blocked by #4 and srs#9", "srs-web"), ["srs-web#4", "srs#9"]);
  assert.deepEqual(prereqRefs("Blocked by: srs-rust#1333, #1334", "srs-web"), ["srs-rust#1333", "srs-rust#1334"]);
  assert.deepEqual(prereqRefs("file text once srs-rust#1333 lands (the UI says so)", "srs-web"), ["srs-rust#1333"]);
  assert.deepEqual(prereqRefs("nothing blocks this", "srs-web"), []);
});
test("prereq-edge: text-only prerequisite comments once; an edge or our marker is quiet", () => {
  const open = { repo: "srs-web", state: "OPEN", stateReason: null, closedAt: null, createdAt: recent, body: "Answers: SP-57\nBlocked by: srs-rust#1333" };
  const r = p(open);
  assert.equal(r.length, 1);
  assert.equal(r[0].rule, "prereq-edge");
  assert.match(r[0].comment, /clerk board dep add srs-web#1 srs-rust#1333/);
  assert.equal(p({ ...open, blockedBy: ["srs-rust#1333"] }).length, 0);
  assert.equal(p({ ...open, comments: ["<!-- steward-check:prereq-edge -->"] }).length, 0);
  assert.equal(p({ ...open, createdAt: old }).length, 0);
});
