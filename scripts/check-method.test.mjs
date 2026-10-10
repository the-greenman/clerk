// Negative fixtures for checkGates (node:test, in-memory data). CI runs this.
import test from "node:test";
import assert from "node:assert/strict";
import { checkGates } from "./check-method.mjs";

const M = "com.semanticops.method";
const rec = (id, typeName, fieldValues = {}, createdBy = { kind: "human", id: "h" }) => ({ instanceId: id, record: { typeName, fieldValues, createdBy } });
const rel = (s, t, y) => ({ sourceId: s, relationType: y, targetId: t });
const base = () => ({
  records: [rec("p1", "problem", { problem_id: "SP-1", title: "P" }), rec("r1", "remedy", { title: "R", falsifier: "f" }),
    rec("e1", "epic", { title: "E" }), rec("o1", "objective", { title: "O" }), rec("pe", "period", { starts_on: "2026-01-01", objective_rank: ["o1"] })],
  relations: [rel("r1", "p1", `${M}/answers`), rel("e1", "r1", `${M}/implements`), rel("e1", "o1", "com.semanticops.programme/serves")],
  affirmed: new Set(["p1", "r1"]),
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
test("boundary holding 2 tensions fails", () => { const b = bnd(); b.relations.pop(); assert.match(mm(b)[0], /holds 2 tensions, expected at least 3/); });
test("duplicate holds-tension edges count once", () => { const b = bnd(); b.relations.pop(); b.relations.push(rel("b1", "t1", `${A}/holds-tension`)); assert.match(mm(b)[0], /holds 2 tensions/); });
test("principle with no boundary fails", () => { const b = bnd(); b.relations = b.relations.filter((r) => r.relationType !== `${A}/within-boundary`); assert.match(mm(b)[0], /within-boundary of 0 boundaries/); });
test("principle within two boundaries fails", () => { const b = bnd(); b.records.push(mk("b2", "boundary", A, NEW)); b.relations.push(rel("pr1", "b2", `${A}/within-boundary`)); assert.match(mm(b).at(-1), /within-boundary of 2 boundaries/); });
test("records created before the rule are exempt", () => { const b = bnd(); b.records[0].record.createdAt = OLD; b.records[1].record.createdAt = OLD; b.relations.splice(4); assert.deepEqual(mm(b), []); });
test("no boundary type installed: old principles pass", () => { const b = bnd(); b.records = b.records.slice(1).map((r) => ({ ...r, record: { ...r.record, createdAt: OLD } })); b.relations = b.relations.slice(0, 4); assert.deepEqual(mm(b), []); });
