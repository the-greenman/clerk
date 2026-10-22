#!/usr/bin/env node
// domains: every domain's focus, boundary and the tensions that emerge from it (lib/practice/domain-field.mjs), and the two owner
// acts on it, run as the acting SRS_ACTOR (clerk#129):
//   clerk domains [--repo <programme>] [--json]
//   clerk domains affirm-tension <tension id> [--reason <text>] [--dry-run]       the tension with both its poles, never a pole alone
//   clerk domains place-axes <domain id> <t1> <t2> <t3> [--dry-run]               the domain's three axes, in line order
import { parseArgs } from "node:util";
import { srsCli } from "../lib/adapters/cli.mjs";
import { loadField, affirmTension, placeAxes } from "../lib/adapters/domain-field.mjs";
import { repoRoot } from "./lib/repo-arg.mjs";

const { values: v, positionals: [act, ...ids] } = parseArgs({ allowPositionals: true, strict: true,
  options: { repo: { type: "string" }, json: { type: "boolean" }, reason: { type: "string" }, "dry-run": { type: "boolean" } } });
const show = (r) => {
  if (v.json) return console.log(JSON.stringify(r, null, 2));
  for (const s of r.plan) console.log(`${v["dry-run"] ? "would run" : "ran"}: srs ${s.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}`);
};
try {
  const repo = repoRoot(), cli = srsCli(repo);
  if (act === "affirm-tension") show(affirmTension(repo, cli, ids[0], { reason: v.reason, dryRun: v["dry-run"] }));
  else if (act === "place-axes") show(placeAxes(repo, cli, ids[0], ids.slice(1), { dryRun: v["dry-run"] }));
  else if (act) throw new Error(`unknown act "${act}" (affirm-tension, place-axes)`);
  else {
    const f = loadField(repo, cli);
    if (v.json) console.log(JSON.stringify(f, null, 2));
    else {
      for (const c of f.contexts) {
        console.log(`\n${c.title}${c.domain ? "" : " (boundary)"}${c.parent ? `  within ${c.parent.title}` : ""}${c.serves ? `  serves ${c.serves.domains.map((d) => d.title).join(", ")}` : ""}`);
        console.log(`  axes ${c.axes.length}/3${c.axes.length ? ": " + c.axes.map((a) => a.title).join(" | ") : ""}`);
        for (const t of c.tensions) console.log(`  ${t.state.padEnd(9)} ${t.title}  [${t.line?.title ?? "no line"}${t.mixedLine ? ", mixed" : ""}]  ${t.poles.map((p) => `${p.title}${p.state === "affirmed" ? "" : "?"}`).join(" ↔ ")}`);
        for (const s of c.sameLine) console.log(`  ! ${s.tensions.length} tensions on line ${s.line.title}: a duplicate, or an inner/outer pair?`);
      }
      if (f.lost.length) console.log(`\nLost context (in no domain or boundary): ${f.lost.map((t) => t.title).join(" | ")}`);
    }
  }
} catch (e) { console.error("clerk domains: " + e.message); process.exit(1); }
