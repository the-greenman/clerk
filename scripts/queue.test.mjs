import assert from "node:assert/strict";
import { classify, lanesFrom, bugQueue } from "./queue.mjs";

const iss = (repo, number, labels, extra = {}) =>
  ({ repo, number, title: `t${number}`, html_url: "", created_at: `2026-10-0${number}T00:00:00Z`, labels: labels.map((name) => ({ name })), ...extra });
const L = ["lane:unattended", "ready"];
const r = classify([
  iss("srs", 1, L),
  iss("srs", 2, [...L, "priority: P1"]),
  iss("srs", 3, [...L, "priority: P0"]),
  iss("srs", 4, [...L, "priority: P0"]),
  iss("srs", 5, [...L, "needs-input"]),
  iss("srs", 6, L, { assignees: [{ login: "x" }] }),
  iss("srs", 7, L),
  iss("srs", 8, ["wg:third-party-ready", "ready"]),
], [{ repo: "srs", number: 99, title: "fix", body: "Closes #7", head: { ref: "b" } }, { repo: "srs-rust", number: 98, title: "Closes #1", body: "" }],
  lanesFrom([{ label: "wg:third-party-ready" }], "lane:unattended"), ["needs-input", "blocked", "parked"]);
assert.deepEqual(r.queued.map((x) => x.ref), ["srs#3", "srs#4", "srs#2", "srs#1", "srs#8"]); // priority, then oldest; none last
assert.deepEqual(r.queued.at(-1).lanes, ["wg"]);
assert.deepEqual(r.held.map((x) => [x.ref, x.held]), [["srs#5", ["needs-input"]], ["srs#6", ["assigned x"]], ["srs#7", ["open PR srs#99"]]]);
// the bug queue: held and taken items out, wg lane or central, no priority counts as P1, then oldest
const W = { holds: ["needs-input", "blocked", "parked"], inProgress: "status: in progress", inReview: "status: in review" };
const b = bugQueue([
  iss("srs-web", 1, ["bug", "wg:agent-editor"]),
  iss("srs", 2, ["bug", "priority: P0"]),
  iss("srs", 3, ["bug", "status: in review"]),
  iss("srs", 4, ["bug", "status: in progress"]),
  iss("srs", 5, ["bug", "needs-input"]),
  iss("srs", 6, ["bug", "priority: P2"]),
], [], [{ label: "wg:agent-editor" }], W);
assert.deepEqual(b.queued.map((x) => [x.ref, x.priority, x.lanes]), [["srs#2", "P0", ["central"]], ["srs-web#1", "P1", ["wg:agent-editor"]], ["srs#6", "P2", ["central"]]]);
assert.deepEqual(b.held.map((x) => [x.ref, x.held]), [["srs#3", ["in review"]], ["srs#4", ["claimed"]], ["srs#5", ["needs-input"]]]);
console.log("queue tests ok");
