import { resolve } from "path";
// The programme repo a script works on: --repo <path>, else the current directory.
export const repoRoot = (argv = process.argv) => resolve(argv.includes("--repo") ? argv[argv.indexOf("--repo") + 1] : process.cwd());
