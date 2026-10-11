#!/usr/bin/env node
// charter: create a working group's draft/proposed charter records through the srs CLI, as the acting SRS_ACTOR; the owner ratifies in a session.
//   clerk charter --repo <programme> --title "WG Name" --epic repo#n --label wg:name --repos a,b --budget N --cycle-close HH:MM
//                 --quorum-seats builder,reviewer --required-seat reviewer [--quorum-min N] [--max-unacked N] [--prefix p] [--from <role id>] [--dry-run]
import { parseArgs } from "node:util";
import { charter } from "../lib/adapters/charter.mjs";
import { srsCli } from "../lib/adapters/cli.mjs";
import { repoRoot } from "./lib/repo-arg.mjs";

const { values: v } = parseArgs({ strict: true, options: { repo: { type: "string" }, title: { type: "string" }, epic: { type: "string" }, label: { type: "string" }, repos: { type: "string" },
  budget: { type: "string" }, "cycle-close": { type: "string" }, "quorum-seats": { type: "string" }, "required-seat": { type: "string" }, "quorum-min": { type: "string" },
  "max-unacked": { type: "string" }, prefix: { type: "string" }, from: { type: "string" }, "dry-run": { type: "boolean" } } });
const list = (s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);
const int = (s) => (s === undefined ? undefined : Number(s));
try {
  const repo = repoRoot(), o = { title: v.title, epic: v.epic, label: v.label, repos: list(v.repos), budget: int(v.budget), cycleClose: v["cycle-close"],
    quorumSeats: list(v["quorum-seats"]), requiredSeat: v["required-seat"], quorumMin: int(v["quorum-min"]), maxUnacked: int(v["max-unacked"]), prefix: v.prefix };
  const r = charter(repo, srsCli(repo), o, { dryRun: v["dry-run"], from: v.from });
  if (v["dry-run"]) {
    console.log(`Plan for ${o.title} (${r.plan.writes.length} writes, acting as ${process.env.SRS_ACTOR ?? "no SRS_ACTOR"}):`);
    for (const w of r.plan.writes) console.log(`  ${w.op.padEnd(10)} ${(w.type ?? w.to ?? w.title ?? w.container ?? "").toString().slice(0, 52).padEnd(53)} ${w.fieldValues?.title ?? (w.source ? `${w.source} -> ${w.target}` : (w.ref ?? ""))}`);
  } else { console.log(`Created (draft/proposed):\n  ` + r.done.join("\n  ")); console.log("\nRun `srs repo validate`, commit, and open the owner session."); }
  console.log("\nOwner steps (not performed):\n  - " + r.plan.ownerSteps.join("\n  - "));
} catch (e) { console.error(e.message.startsWith("clerk charter") ? e.message : "clerk charter: " + e.message); process.exit(1); }
