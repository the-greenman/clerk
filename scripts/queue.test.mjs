import assert from "node:assert/strict";
import { classify, lanesFrom } from "./queue.mjs";

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
  lanesFrom([{ label: "wg:third-party-ready" }]));
assert.deepEqual(r.queued.map((x) => x.ref), ["srs#3", "srs#4", "srs#2", "srs#1", "srs#8"]); // priority, then oldest; none last
assert.deepEqual(r.queued.at(-1).lanes, ["wg"]);
assert.deepEqual(r.held.map((x) => [x.ref, x.held]), [["srs#5", ["needs-input"]], ["srs#6", ["assigned x"]], ["srs#7", ["open PR srs#99"]]]);
console.log("queue tests ok");
