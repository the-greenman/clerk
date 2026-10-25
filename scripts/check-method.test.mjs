// Negative fixtures for checkGates (node:test, in-memory data). CI runs this.
import test from "node:test";
import assert from "node:assert/strict";
import { checkGates } from "./check-method.mjs";

const M = "com.semanticops.method";
const rec = (id, typeName, fieldValues = {}, createdBy = { kind: "human", id: "h" }) => ({ instanceId: id, record: { typeName, fieldValues, createdBy } });
const rel = (s, t, y) => ({ sourceId: s, relationType: y, targetId: t });
const base = () => ({
  records: [rec("p1", "problem", { problem_id: "SP-1", title: "P" }), rec("r1", "remedy", { title: "R", falsifier: "f" }),
    rec("e1", "epic", { title: "E" }), rec("o1", "objective", { title: "O" }), rec("pe", "period", { starts_on: "2026-01-01", objective_rank: ["o1"] }),
    rec("pid", "persona-in-domain", { title: "W in D" }), rec("d1", "domain", { title: "D" })],
  relations: [rel("r1", "p1", `${M}/answers`), rel("e1", "r1", `${M}/implements`), rel("e1", "o1", "com.semanticops.programme/serves"),
    rel("p1", "pid", `${M}/held-by`), rel("pid", "d1", `${M}/in-domain`)],
  affirmed: new Set(["p1", "r1", "pid", "d1"]),
});
const run = (f) => { const b = base(); f(b); return checkGates(b.records, b.relations, b.affirmed, b.setAside ?? new Set()); };

test("good data is clean", () => assert.deepEqual(run(() => {}), { errors: [], warnings: [] }));
test("AI member of Affirmed", () => assert.match(run((b) => { b.records[0].record.createdBy = { kind: "ai", id: "a" }; }).errors[0], /AI actor/));
test("AI member of Set aside", () => assert.match(run((b) => { b.records[0].record.createdBy = { kind: "ai", id: "a" }; b.affirmed = new Set(["r1"]); b.setAside = new Set(["p1"]); }).errors[0], /Set aside/));
test("duplicate problem_id", () => assert.match(run((b) => { b.records.push(rec("p2", "problem", { problem_id: "SP-1" })); b.affirmed.add("p2"); }).errors[0], /duplicate problem_id SP-1 in Affirmed/));
test("remedy without affirmed problem", () => assert.match(run((b) => { b.affirmed.delete("p1"); }).errors[0], /answers no affirmed problem/));
test("remedy without falsifier", () => assert.match(run((b) => { b.records[1].record.fieldValues.falsifier = " "; }).errors[0], /no falsifier/));
test("epic on ranked objective without affirmed problem warns", () => {
  const r = run((b) => { b.affirmed.delete("p1"); b.affirmed.delete("r1"); });
  assert.equal(r.errors.length, 0);
  assert.match(r.warnings[0], /answers no affirmed problem/);
});
test("same problem_id across layers (a fork) is fine", () => assert.deepEqual(run((b) => b.records.push(rec("p2", "problem", { problem_id: "SP-1" }))).errors, []));
test("an affirmed tension still containing a suggested pole whose fork is affirmed (clerk#187)", () => {
  const errs = run((b) => {
    b.records.push(rec("t", "tension", { title: "T" }), rec("p", "pole", { title: "P" }), rec("pf", "pole", { title: "P" }), rec("q", "pole", { title: "Q" }));
    b.relations.push(rel("t", "p", "contains"), rel("t", "q", "contains"), rel("pf", "p", "derived-from"));
    b.affirmed.add("t"); b.affirmed.add("pf");
  }).errors;
  assert.ok(errs.some((e) => /contains the suggested pole p .*affirmed fork exists/.test(e)), errs.join("; "));
  assert.ok(!errs.some((e) => /suggested pole q/.test(e)), "a pole with no affirmed fork is not reported");
});
test("record in both layers", () => assert.match(run((b) => { b.setAside = new Set(["p1"]); }).errors[0], /both Affirmed and Set aside/));
test("unaffirmed remedy does not satisfy the epic", () => assert.match(run((b) => { b.affirmed.delete("r1"); }).warnings[0], /answers no affirmed problem/));
test("ended period ranks nothing", () => assert.deepEqual(run((b) => { b.records[4].record.fieldValues.ends_on = "2026-02-01"; b.affirmed.clear(); }).warnings, []));

// Boundary rules (U3): at least 3 tensions per boundary, each principle in exactly one boundary; old records exempt.
import { checkMethod } from "./check-method.mjs";
const A = "com.mudemocracy.argument";
const mk = (id, typeName, typeNamespace, createdAt, fieldValues = {}) => ({ instanceId: id, record: { typeName, typeNamespace, createdAt, fieldValues } });
const NEW = "2026-10-10T00:00:00Z", OLD = "2026-10-08T00:00:00Z";
const bnd = () => {
  const records = [mk("b1", "boundary", A, NEW, { title: "B" }), mk("pr1", "principle", M, NEW, { statement: "S" }),
    mk("t0", "tension", M, NEW, { title: "T0" }), mk("po1", "pole", M, NEW), mk("po2", "pole", M, NEW)];
  const relations = [rel("t0", "po1", "contains"), rel("t0", "po2", "contains"), rel("pr1", "t0", `${M}/governs`), rel("pr1", "po1", `${M}/leans-toward`),
    rel("pr1", "b1", `${A}/within-boundary`), ...["t1", "t2", "t3"].map((t) => rel("b1", t, `${A}/holds-tension`))];
  return { records, relations };
};
const mm = (b) => checkMethod(b.records, b.relations);
test("boundary with 3 tensions and a bounded principle passes", () => assert.deepEqual(mm(bnd()), []));
test("a principle leaning toward the suggestion of a pole whose fork its tension contains passes (clerk#187)", () => {
  const b = bnd(); b.records.push(mk("po1f", "pole", M, NEW));
  b.relations = b.relations.map((r) => (r.sourceId === "t0" && r.targetId === "po1" ? rel("t0", "po1f", "contains") : r));
  b.relations.push(rel("po1f", "po1", "derived-from"));
  assert.deepEqual(mm(b), []);
});
test("a principle leaning toward a pole of another tension still fails", () => {
  const b = bnd(); b.records.push(mk("x", "pole", M, NEW)); b.relations = b.relations.map((r) => (r.relationType === `${M}/leans-toward` ? rel("pr1", "x", r.relationType) : r));
  assert.match(mm(b)[0], /must lean toward exactly one pole/);
});
test("boundary holding 2 tensions fails", () => { const b = bnd(); b.relations.pop(); assert.match(mm(b)[0], /holds 2 tensions, expected at least 3/); });
test("duplicate holds-tension edges count once", () => { const b = bnd(); b.relations.pop(); b.relations.push(rel("b1", "t1", `${A}/holds-tension`)); assert.match(mm(b)[0], /holds 2 tensions/); });
test("principle with no boundary fails", () => { const b = bnd(); b.relations = b.relations.filter((r) => r.relationType !== `${A}/within-boundary`); assert.match(mm(b)[0], /within-boundary of 0 boundaries/); });
test("principle within two boundaries fails", () => { const b = bnd(); b.records.push(mk("b2", "boundary", A, NEW)); b.relations.push(rel("pr1", "b2", `${A}/within-boundary`)); assert.match(mm(b).at(-1), /within-boundary of 2 boundaries/); });
test("records created before the rule are exempt", () => { const b = bnd(); b.records[0].record.createdAt = OLD; b.records[1].record.createdAt = OLD; b.relations.splice(4); assert.deepEqual(mm(b), []); });
test("no boundary type installed: old principles pass", () => { const b = bnd(); b.records = b.records.slice(1).map((r) => ({ ...r, record: { ...r.record, createdAt: OLD } })); b.relations = b.relations.slice(0, 4); assert.deepEqual(mm(b), []); });

// Principle 2 (clerk#35): an affirmed problem is grounded in an affirmed domain through persona-in-domain; ends resolve through derived-from.
const g = base;
const p2 = (f) => { const b = g(); f(b); return checkGates(b.records, b.relations, b.affirmed, new Set()); };
test("grounded problem is clean", () => assert.deepEqual(p2(() => {}).warnings, []));
test("held by no persona-in-domain warns", () => assert.match(p2((b) => { b.relations = b.relations.filter((r) => r.relationType !== `${M}/held-by`); }).warnings[0], /held-by no affirmed persona-in-domain/));
test("persona-in-domain not affirmed warns", () => assert.match(p2((b) => b.affirmed.delete("pid")).warnings[0], /held-by no affirmed/));
test("domain not affirmed warns", () => assert.match(p2((b) => b.affirmed.delete("d1")).warnings[0], /exactly one in-domain/));
test("two in-domain edges warn", () => assert.match(p2((b) => { b.records.push(rec("d2", "domain", {})); b.affirmed.add("d2"); b.relations.push(rel("pid", "d2", `${M}/in-domain`)); }).warnings[0], /exactly one in-domain/));
test("shared persona (not persona-in-domain) warns", () => assert.match(p2((b) => { b.records.find((r) => r.instanceId === "pid").record.typeName = "persona"; }).warnings[0], /held-by no affirmed persona-in-domain/));
test("edges on the suggestion count for its affirmed fork", () => {
  const b = g();
  b.records.push(rec("pidF", "persona-in-domain", { title: "W in D" }), rec("d1F", "domain", { title: "D" }));
  b.relations.push(rel("pidF", "pid", "derived-from"), rel("d1F", "d1", "derived-from"));
  b.affirmed = new Set(["p1", "r1", "pidF", "d1F"]); // only the forks are affirmed; the edges sit on the suggestions
  assert.deepEqual(checkGates(b.records, b.relations, b.affirmed, new Set()).warnings, []);
});
test("never an error while the switch is warning", () => assert.deepEqual(p2((b) => b.affirmed.delete("d1")).errors, []));

// axes (decision cdd272a3)
const ax = (b) => {
  b.records.push(rec("t", "tension", { title: "T" }), rec("ya", "pole", { title: "Ya" }), rec("yi", "pole", { title: "Yi" }), rec("ax", "axis-in-domain", { title: "T in D", line: 1 }));
  b.relations.push(rel("t", "ya", "contains"), rel("t", "yi", "contains"), rel("ax", "t", "refines"), rel("ax", "d1", `${M}/in-domain`), rel("ax", "ya", `${M}/yang-pole`));
  b.affirmed.add("ax");
};
test("a sound axis is clean", () => assert.deepEqual(run(ax).errors, []));
test("an axis's yang must be its tension's pole", () => assert.match(run((b) => { ax(b); b.records.push(rec("other", "pole", { title: "O" })); b.relations.find((r) => r.relationType.endsWith("yang-pole")).targetId = "other"; }).errors.join(), /not one of its tension's poles/));
test("an axis names exactly one yang-pole", () => assert.match(run((b) => { ax(b); b.relations.push(rel("ax", "yi", `${M}/yang-pole`)); }).errors.join(), /2 yang-pole/));
test("an axis's line is 1-3", () => assert.match(run((b) => { ax(b); b.records.at(-1).record.fieldValues.line = 4; }).errors.join(), /line 4/));
test("two affirmed axes of one domain cannot share a line", () => assert.match(run((b) => {
  ax(b); b.records.push(rec("t2", "tension", { title: "T2" }), rec("a2", "pole", { title: "A2" }), rec("b2", "pole", { title: "B2" }), rec("ax2", "axis-in-domain", { title: "T2 in D", line: 1 }));
  b.relations.push(rel("t2", "a2", "contains"), rel("t2", "b2", "contains"), rel("ax2", "t2", "refines"), rel("ax2", "d1", `${M}/in-domain`), rel("ax2", "a2", `${M}/yang-pole`));
  b.affirmed.add("ax2");
}).errors.join(), /repeats line 1/));
