#!/usr/bin/env node
// Render the handbook: handbook/ is an SRS repository (the source of truth),
// docs/handbook.md is its `handbook` Composition, rendered. Never edit the markdown.
//
//   node scripts/render-handbook.mjs           # validate, then write docs/handbook.md
//   node scripts/render-handbook.mjs --check   # exit 1 if docs/handbook.md differs from the records
//
// Uses SRS_CLI_PATH (export $(node scripts/fetch-pinned-srs.mjs --repo .)), else `srs` on PATH.

import { execFileSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(ROOT, "handbook");
const OUT = join(ROOT, "docs", "handbook.md");
const SRS = process.env.SRS_CLI_PATH || "srs";
const BANNER = "<!-- Rendered from handbook/ (an SRS repository) by scripts/render-handbook.mjs. Do not edit: change the records. -->\n\n";

const fail = (msg) => { console.error(`handbook: ${msg}`); process.exit(1); };

function srs(...args) {
  let out;
  try {
    out = JSON.parse(execFileSync(SRS, [...args, "--repo", REPO], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] }));
  } catch (error) {
    fail(`${SRS} ${args.slice(0, 2).join(" ")} failed: ${error.stderr || error.stdout || error.message}`);
  }
  if (!out.ok) fail(`srs ${args.slice(0, 2).join(" ")}: ${out.diagnostics.join("; ")}`);
  return out.payload;
}

const { summary } = srs("repo", "validate");
if (summary.errors > 0) fail(`${summary.errors} validation errors (srs repo validate --repo handbook)`);

const { containerId, identityInstanceId } = JSON.parse(readFileSync(join(REPO, "manifest.json"), "utf8")).container;
const composition = srs("composition", "list").compositions.find((c) => c.name === "handbook");
if (!composition) fail("no composition named handbook in handbook/");
const { rendered, diagnostics } = srs("render", "composition", "--view", composition.id, "--container", containerId,
  "--exclude", identityInstanceId, "--view-format", "markdown");
if (diagnostics.length) fail(`render diagnostics: ${JSON.stringify(diagnostics)}`);

const text = BANNER + rendered.trimEnd() + "\n";
if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(OUT, "utf8"); } catch {}
  if (current !== text) {
    console.error("docs/handbook.md differs from the handbook records. Edit the records, then run node scripts/render-handbook.mjs.");
    process.exit(1);
  }
  console.log("docs/handbook.md matches the handbook records");
} else {
  writeFileSync(OUT, text);
  console.log(`wrote docs/handbook.md (${summary.checked} instances)`);
}
