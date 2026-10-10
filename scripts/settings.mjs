#!/usr/bin/env node
// settings: print the programme's settings record (the one com.semanticops.programme/programme record).
//   node scripts/settings.mjs [--repo <programme path>] [--json]      bash: clerk settings --json | jq -r .githubOwner
import { loadSettings } from "../lib/adapters/settings.mjs";
import { repoRoot } from "./lib/repo-arg.mjs";

try {
  const s = loadSettings(repoRoot());
  if (process.argv.includes("--json")) console.log(JSON.stringify(s, null, 2));
  else for (const [k, v] of Object.entries(s)) console.log(`${k.padEnd(14)} ${Array.isArray(v) ? v.join(", ") : v}`);
} catch (e) { console.error("clerk settings: " + e.message); process.exit(1); }
