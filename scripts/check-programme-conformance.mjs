#!/usr/bin/env node
/**
 * check-programme-conformance.mjs — this repository stays a conforming SRS repository.
 *
 * Moved out of `the-greenman/srs` (srs#786) into this standalone local repo. Two independent
 * assertions, both required:
 *   1. The `.srs/` marker resolves as a directory and holds at least one regular file. An empty
 *      marker directory round-trips as absent — git does not track empty directories — so the
 *      repository would silently stop being one on its first commit.
 *   2. `srs repo validate --repo .` reports zero errors. Diagnostics live in the payload, not the
 *      exit code, so this asserts on `payload.summary.errors`, never on process exit status alone.
 *
 * Resolves the `srs` binary from SRS_CLI_PATH if set, else the programme's pinned build
 * (srsCli in lib/adapters/cli.mjs), never a possibly stale `srs` on PATH.
 *
 *   node scripts/check-programme-conformance.mjs
 */
import { readdir, stat } from "fs/promises";
import { join, resolve } from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname } from "path";

import { repoRoot } from "./lib/repo-arg.mjs";
import { srsCli } from "../lib/adapters/cli.mjs";
const ROOT = repoRoot();
const MARKER = join(ROOT, ".srs");
const CLI = srsCli(ROOT);

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

async function assertMarker() {
  let st;
  try {
    st = await stat(MARKER);
  } catch {
    fail(`.srs does not exist. The marker directory is what makes this an SRS repository; manifest.json alone does not.`);
  }
  if (!st.isDirectory()) fail(`.srs is not a directory.`);

  const entries = await readdir(MARKER, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile());
  if (files.length === 0) {
    fail(`.srs holds no regular file. An empty marker directory round-trips as absent (git does not track empty directories), so the repository would silently stop being one.`);
  }
  console.log(`✓ .srs resolves as a directory holding ${files.length} regular file(s).`);
}

function runValidate() {
  return new Promise((resolvePromise) => {
    const child = spawn(CLI, ["repo", "validate", "--repo", ROOT, "--format", "json"], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", () => resolvePromise(out));
  });
}

async function assertValidates() {
  const raw = await runValidate();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    fail(`srs repo validate did not return parseable JSON (is '${CLI}' the srs binary? set SRS_CLI_PATH). Raw output:\n${raw.slice(0, 800)}`);
  }
  if (payload?.ok === false) {
    const top = (payload.diagnostics || []).slice(0, 10);
    fail(
      `srs repo validate could not load the repository.\n` +
        (top.length ? top.map((d) => `    - ${d.message || JSON.stringify(d)}`).join("\n") : "    (no diagnostics returned)"),
    );
  }
  const summary = payload?.payload?.summary;
  if (!summary) fail(`srs repo validate returned no payload.summary.`);
  const errors = summary.errors ?? 0;
  if (errors !== 0) {
    const diags = (payload.payload.diagnostics || []).slice(0, 10);
    fail(`srs repo validate reports ${errors} error(s).\n` + diags.map((d) => `    - ${d.message || JSON.stringify(d)}`).join("\n"));
  }
  console.log(`✓ repository validates: ${summary.checked} checked, 0 errors, ${summary.warnings ?? 0} warning(s).`);
}

async function main() {
  await assertMarker();
  await assertValidates();
  console.log(`\n✓ this is a conforming SRS repository.`);
}

main();
