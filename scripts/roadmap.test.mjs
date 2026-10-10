import assert from "node:assert/strict";
import { derive } from "./roadmap.mjs";

const rec = (instanceId, typeName, fieldValues) => ({ instanceId, record: { typeName, fieldValues } });
const obj = (id) => rec(id, "objective", { title: id });
const epic = (id, n) => rec(id, "epic", { title: id, issue_ref: [`r#${n}`] });
const serves = (s, t) => ({ relationType: "com.semanticops.programme/serves", sourceId: s, targetId: t });
const period = (id, a, b, rank) => rec(id, "period", { title: id, starts_on: a, ends_on: b, objective_rank: rank });
const base = [obj("A"), obj("B"), obj("C"), obj("D"), epic("e1", 1), epic("e2", 2), epic("e3", 3), epic("e4", 4), epic("e5", 5)];
const links = [serves("e1", "A"), serves("e2", "B"), serves("e3", "C"), serves("e4", "D")];
const q4 = period("q4", "2026-10-01", "2026-12-31", ["A", "B", "C"]);

const r = derive([...base, q4], links, "2026-10-08");
const p = Object.fromEntries(r.epics.map((e) => [e.ref, e.priority]));
assert.deepEqual([p["r#1"], p["r#2"], p["r#3"]], ["P0", "P1", "P2"]); // rank -> tier
assert.equal(p["r#4"], null); // serves an unranked objective -> parked
assert.deepEqual(r.parked, ["r#4", "r#5"]); // unlinked epic parked too
assert.equal(derive([...base, q4, period("q1", "2027-01-01", "2027-03-31", ["D"])], links, "2027-02-01").epics[3].priority, "P0"); // date picks period
assert.throws(() => derive([...base, q4], links, "2027-01-15"), /0 periods/); // no active period
const open1 = period("open1", "2026-10-08", undefined, ["A", "B", "C"]);
assert.equal(derive([...base, open1], links, "2027-06-01").activePeriod.ends_on, null); // open-ended period is active
assert.throws(() => derive([...base, open1, period("open2", "2026-12-01", undefined, ["D"])], links, "2027-01-01"), /2 periods active/); // two open periods
assert.equal(derive([...base, period("old", "2026-10-01", "2026-11-30", ["D"]), period("new", "2026-12-01", undefined, ["A"])], links, "2027-01-01").activePeriod.title, "new"); // closed + open
assert.throws(() => derive([...base, period("q4", "2026-10-01", "2026-12-31", ["e1"])], links, "2026-10-08"), /not an objective/);
{ // parked snapshot keyed by strategy_key, with links between snapshot records only
  const snap = derive([...base, q4, rec("b1", "boundary", { title: "B1", strategy_key: "P1", summary: "s", body: "x" }), rec("a1", "assessment", { title: "A1", strategy_key: "a1", reality_state: "proven" })],
    [...links, { relationType: "com.semanticops.programme/assesses", sourceId: "a1", targetId: "b1" }, { relationType: "contains", sourceId: "a1", targetId: "e1" }], "2026-10-08").snapshot;
  assert.deepEqual(snap.assessments[0].links, [{ type: "assesses", to: "P1" }]);
  assert.equal(snap.boundaries[0].key, "P1");
  // an argument/boundary (same type name, other namespace) stays out of the snapshot
  const argB = { instanceId: "ab", record: { typeName: "boundary", typeNamespace: "com.mudemocracy.argument", fieldValues: { title: "AB" } } };
  assert.equal(derive([...base, q4, argB], links, "2026-10-08").snapshot.boundaries.length, 0);
}
console.log("roadmap.test: ok");

// Affirmed layer: an epic answering an affirmed problem shows the chain; a suggestion-only problem is ignored.
{
  const MNS = "com.semanticops.method";
  const rl = (t, s, d) => ({ relationType: t.includes("/") || t === "contains" ? t : `${MNS}/${t}`, sourceId: s, targetId: d });
  const data = [...base, q4, rec("pr", "problem", { problem_id: "SP-01", title: "pr" }), rec("ps", "problem", { problem_id: "SP-02", title: "ps" }),
    rec("pe", "persona", { title: "Writer" }), rec("cl", "cluster", { title: "Cluster X" })];
  const rels = [...links, rl("answers", "e1", "pr"), rl("answers", "e1", "ps"), rl("held-by", "pr", "pe"), rl("contains", "cl", "pr"), rl("addresses", "A", "cl")];
  const [e1] = derive(data, rels, "2026-10-08", new Set(["pr", "pe", "cl"])).epics;
  assert.deepEqual(e1.answers, [{ problem: "SP-01", persona: "Writer", cluster: "Cluster X", objective: "A" }]); // SP-02 is a suggestion only
  assert.equal(derive(data, rels, "2026-10-08").epics[0].answers, undefined); // empty Affirmed layer: unchanged output
  assert.equal(derive(data, rels, "2026-10-08", new Set(["pr", "pe", "cl"])).epics[0].priority, "P0"); // ranking unaffected
}
console.log("roadmap.test (affirmed layer): ok");

// Remedies via implements; structure (cluster/persona) may be a suggestion, claims may not.
{
  const MNS = "com.semanticops.method";
  const rl = (t, s, d) => ({ relationType: t === "contains" ? t : `${MNS}/${t}`, sourceId: s, targetId: d });
  const data = [...base, q4, rec("pr", "problem", { problem_id: "SP-01", title: "pr" }), rec("rm", "remedy", { title: "Rem", move: "m".repeat(80) }),
    rec("pe", "persona", { title: "Writer" }), rec("cl", "cluster", { title: "Cluster X" })];
  const rels = [...links, rl("implements", "e1", "rm"), rl("answers", "rm", "pr"), rl("held-by", "pr", "pe"), rl("contains", "cl", "pr"), rl("addresses", "A", "cl")];
  const get = (aff) => derive(data, rels, "2026-10-08", new Set(aff)).epics[0];
  const full = get(["pr", "rm", "pe", "cl"]);
  assert.deepEqual(full.remedies.map(({ id, title, answers }) => ({ id, title, answers })), [{ id: "rm", title: "Rem", answers: ["SP-01"] }]); // remedy via implements
  assert.deepEqual(full.answers, [{ problem: "SP-01", persona: "Writer", cluster: "Cluster X", objective: "A" }]); // no suggested flags when affirmed
  assert.equal(get(["pr", "pe", "cl"]).remedies, undefined); // non-affirmed remedy ignored
  assert.equal(get(["pr", "rm"]).answers[0].suggested, true); // suggested cluster, addresses still reaches objective
  assert.equal(get(["pr", "rm"]).answers[0].objective, "A");
  assert.equal(get(["pr", "rm"]).answers[0].personaSuggested, true); // suggested persona
  assert.equal(get(["rm", "pe", "cl"]).answers, undefined); // problem must still be affirmed
  console.log("roadmap.test (remedies): ok");
}

// Method check: tension = 2 poles; principle governs 1 tension and leans toward one of its poles.
{
  const { checkMethod } = await import("./check-method.mjs");
  const M = "com.semanticops.method/";
  const rl = (t, s, d) => ({ relationType: t === "contains" ? t : M + t, sourceId: s, targetId: d });
  const data = [rec("t", "tension", { title: "T" }), rec("a", "pole", { title: "A" }), rec("b", "pole", { title: "B" }), rec("c", "pole", { title: "C" }),
    rec("p", "principle", { statement: "A over B" })];
  const good = [rl("contains", "t", "a"), rl("contains", "t", "b"), rl("governs", "p", "t"), rl("leans-toward", "p", "a")];
  assert.deepEqual(checkMethod(data, good), []);
  assert.match(checkMethod(data, good.slice(1))[0], /1 poles/); // one pole only
  assert.match(checkMethod(data, [...good, rl("contains", "t", "c")])[0], /3 poles/); // three poles
  assert.match(checkMethod(data, [...good.slice(0, 3), rl("leans-toward", "p", "c")])[0], /lean toward exactly one pole/); // leans off-tension
  assert.match(checkMethod(data, good.slice(0, 2).concat(good.slice(3)))[0], /governs 0/); // no governs
  console.log("check-method.test: ok");
}
