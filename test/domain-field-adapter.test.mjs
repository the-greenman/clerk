import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { affirmTension } from '../lib/adapters/domain-field.mjs';

// The acts run against a stand-in for the srs CLI that keeps a domain, a boundary and a suggested tension in a state file.
// Its fork does what the real one does: outgoing edges only, re-pointed to any fork of their target (srs-rust#1377).
const STUB = `#!/usr/bin/env node
const fs = require('fs'), args = process.argv.slice(2), file = ${'process.env.STUB_STATE'}, s = JSON.parse(fs.readFileSync(file, 'utf8'));
const say = (payload) => { fs.writeFileSync(file, JSON.stringify(s)); console.log(JSON.stringify({ ok: true, payload })); };
const [a, b, c] = args;
if (a === 'container' && b === 'list') say({ containers: s.containers.map(({ containerId, title }) => ({ containerId, title })) });
else if (a === 'container' && b === 'get') say({ container: s.containers.find((x) => x.containerId === c) });
else if (a === 'record' && b === 'list') say({ records: s.records });
else if (a === 'relation' && b === 'list') say({ relations: s.relations });
else if (a === 'relation' && b === 'create') {
  const i = JSON.parse(fs.readFileSync(0, 'utf8'));
  s.relations.push({ relationId: 'r' + s.relations.length, relationType: i.relationType, sourceId: i.sourceInstanceId, targetId: i.targetInstanceId });
  say({});
} else if (a === 'record' && b === 'fork') {
  const fork = c + '-fork', forkOf = (t) => s.relations.find((r) => r.relationType === 'derived-from' && r.targetId === t)?.sourceId ?? t;
  s.records.push({ ...s.records.find((r) => r.instanceId === c), instanceId: fork });
  s.containers.find((x) => x.containerId === args[args.indexOf('--into') + 1]).memberInstanceIds.push({ instanceId: fork });
  for (const r of s.relations.filter((x) => x.sourceId === c)) s.relations.push({ ...r, relationId: 'c' + s.relations.length, sourceId: fork, targetId: forkOf(r.targetId) });
  s.relations.push({ relationId: 'd' + s.relations.length, relationType: 'derived-from', sourceId: fork, targetId: c });
  say({ forks: [{ forkId: fork }] });
} else { console.log(JSON.stringify({ ok: false, errors: [{ code: 'stub', message: args.join(' ') }] })); }
`;

const rec = (instanceId, typeName) => ({ instanceId, record: { typeName, typeNamespace: typeName === 'boundary' ? 'com.mudemocracy.argument' : 'com.semanticops.method', fieldValues: { title: instanceId } } });
const rel = (relationType, sourceId, targetId, n) => ({ relationId: `s${n}`, relationType, sourceId, targetId });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'domain-field-')), cli = join(dir, 'srs'), state = join(dir, 'state.json');
  writeFileSync(cli, STUB, { mode: 0o755 });
  writeFileSync(state, JSON.stringify({
    containers: [{ containerId: 'aff', title: 'Affirmed', memberInstanceIds: [{ instanceId: 'dom' }] }],
    records: [rec('dom', 'domain'), rec('bnd', 'boundary'), rec('ten', 'tension'), rec('a', 'pole'), rec('b', 'pole')],
    relations: [rel('contains', 'dom', 'ten', 1), rel('com.mudemocracy.argument/holds-tension', 'bnd', 'ten', 2), rel('contains', 'ten', 'a', 3), rel('contains', 'ten', 'b', 4)],
  }));
  process.env.STUB_STATE = state;
  return { dir, cli, read: () => JSON.parse(readFileSync(state, 'utf8')) };
}

test('affirmTension leaves the fork in its domain and holder, containing its poles\' forks (clerk#271)', () => {
  const { dir, cli, read } = setup();
  const { done } = affirmTension(dir, cli, 'ten');
  assert.deepEqual(done, ['a-fork', 'b-fork', 'ten-fork']);
  const on = (x) => read().relations.filter((r) => r.targetId === 'ten-fork').map((r) => `${r.relationType.split('/').pop()} ${r.sourceId}`);
  assert.deepEqual(on().sort(), ['contains dom', 'holds-tension bnd']);
  const poles = read().relations.filter((r) => r.sourceId === 'ten-fork' && r.relationType === 'contains').map((r) => r.targetId).sort();
  assert.deepEqual(poles, ['a-fork', 'b-fork']);
});

test('a dry run says what it would link and writes nothing', () => {
  const { dir, cli, read } = setup();
  const before = read(), { plan, done } = affirmTension(dir, cli, 'ten', { dryRun: true });
  assert.deepEqual(done, []);
  assert.deepEqual(plan.filter((p) => p[1] === 'create').map((p) => [p[2].sourceInstanceId, p[2].targetInstanceId]).sort(), [['bnd', '@fork'], ['dom', '@fork']]);
  assert.deepEqual(read(), before);
});
