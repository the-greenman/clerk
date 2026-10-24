#!/usr/bin/env node
// pr-tree: open PRs as merge chains, read from the desk snapshot clerk serve keeps (no GitHub calls; logic in lib/practice/pr-tree.mjs).
//   clerk pr-tree [--desk <desk.json>] [--json]      default desk: $CLERK_STATE_DIR/desk.json (~/.local/state/clerk)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { prTree } from "../lib/practice/pr-tree.mjs";

const argv = process.argv.slice(2), at = argv.indexOf("--desk");
const file = at >= 0 ? argv[at + 1] : join(process.env.CLERK_STATE_DIR || join(homedir(), ".local", "state", "clerk"), "desk.json");
let desk;
try { desk = JSON.parse(readFileSync(file, "utf8")); }
catch (e) { console.error(`clerk pr-tree: no desk snapshot at ${file} (run clerk serve, or clerk desk --json > file and pass --desk): ${e.message}`); process.exit(1); }
const t = prTree(desk.prs ?? [], desk.gates);
if (argv.includes("--json")) { console.log(JSON.stringify({ at: desk.now, ...t }, null, 2)); process.exit(0); }
const next = (r) => { const n = t.prs[r].next, d = t.prs[r].decisions; return `${n.do}${n.ref ? ` ${n.ref}` : ""}${n.why ? ` (${n.why})` : ""}${d.asks + d.made + d.recorded ? `  [decisions: ${d.open}/${d.asks} open, ${d.made} made, ${d.recorded} recorded]` : ""}`; };
console.log(`PR chains, desk of ${desk.now}`);
for (const c of t.chains) { console.log(`\n${c.repo}`); for (const r of c.order) console.log(`  ${r.padEnd(18)} ${next(r)}`); for (const e of c.edges) console.log(`    ${e.from} -> ${e.to}  ${e.kind}: ${e.why}`); }
for (const c of t.cycles) console.log(`\ncycle: ${c.join(" <-> ")}`);
if (t.singles.length) { console.log("\nsingles"); for (const r of t.singles) console.log(`  ${r.padEnd(18)} ${next(r)}`); }
