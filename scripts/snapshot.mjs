#!/usr/bin/env node
// clerk snapshot --json [--repo <programme>]: the programme as one snapshot (records with field values, relations, containers
// with their ordered outlines), read through the srs CLI. For clients such as the srs-lab control room, via clerk serve.
import { srsCli } from '../lib/adapters/cli.mjs';
import { programmeSnapshot } from '../lib/adapters/snapshot.mjs';
import { repoRoot } from './lib/repo-arg.mjs';

if (!process.argv.includes('--json')) { console.error('usage: clerk snapshot --json [--repo <programme>]'); process.exit(2); }
const repo = repoRoot();
try { process.stdout.write(JSON.stringify(programmeSnapshot(srsCli(repo), repo))); }
catch (e) { console.error(`clerk snapshot: ${e.message}`); process.exit(1); }
