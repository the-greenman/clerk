// Resolution of the pinned `srs` CLI.
//
// The gate this repository runs corresponds to exactly one `srs-rust` build.
// That build is declared once, as SRS_RUST_CLI_TAG in
// `.github/workflows/validate.yml`, and is read from there — never restated
// here. A second copy of the tag is a second thing to forget to update, which
// is the defect class this module exists to close (srs#337).

import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { join, resolve } from "path";

import { repoRoot } from "./repo-arg.mjs";
export const ROOT = repoRoot();
export const WORKFLOW_PATH = join(ROOT, ".github", "workflows", "validate.yml");

// Matches the `SRS_RUST_CLI_TAG: <tag>` mapping entry. Comment lines start with
// `#`, so the prose in the workflow header that mentions the variable by name
// cannot match.
const TAG_LINE = /^\s*SRS_RUST_CLI_TAG:\s*["']?([^"'#\s]+)/;

/**
 * Read the pinned `srs-rust` release tag out of the validate workflow.
 * Throws if it is missing, or declared more than once.
 */
export async function readPinnedTag(workflowPath = WORKFLOW_PATH) {
  let text;
  try {
    text = await readFile(workflowPath, "utf8");
  } catch (error) {
    throw new Error(`cannot read the pinned tag: ${workflowPath}: ${error.message}`);
  }

  const found = [];
  for (const line of text.split("\n")) {
    const match = TAG_LINE.exec(line);
    if (match) found.push(match[1]);
  }

  if (found.length === 0) {
    throw new Error(`no SRS_RUST_CLI_TAG declaration found in ${workflowPath}`);
  }
  if (found.length > 1) {
    throw new Error(
      `SRS_RUST_CLI_TAG is declared ${found.length} times in ${workflowPath} (${found.join(", ")}). ` +
        `It must be declared exactly once — a second copy of the pin is a new drift source.`,
    );
  }
  return found[0];
}

export async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}
