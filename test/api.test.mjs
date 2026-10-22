// The service contract (lib/practice/api.mjs) against api/openapi.json: the spec leads (decision 46bb7a8c).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routes, checkSpec, opaqueSchemas, checkQuery } from '../lib/practice/api.mjs';

const SPEC = JSON.parse(readFileSync(new URL('../api/openapi.json', import.meta.url), 'utf8'));
const { HANDLERS } = await import('../scripts/serve.mjs');
const clone = () => JSON.parse(JSON.stringify(SPEC));

test('the shipped spec can be served exactly: every operation has a handler and every handler an operation', () => {
  assert.deepEqual(checkSpec(SPEC, Object.keys(HANDLERS)), []);
});

test('the shipped spec has no opaque schema', () => {
  assert.deepEqual(opaqueSchemas(SPEC), []);
});

test('an operation with no handler, and a handler with no operation, are refused', () => {
  const ids = Object.keys(HANDLERS).filter((k) => k !== 'queue').concat('extra');
  const errors = checkSpec(SPEC, ids);
  assert.ok(errors.includes('operation queue has no handler'));
  assert.ok(errors.includes('handler extra has no operation'));
});

test('an opaque schema is refused: {}, an object with no properties, an array with no items', () => {
  const s = clone();
  s.components.schemas.Settings.properties.loose = {};
  s.components.schemas.Settings.properties.bag = { type: 'object' };
  s.components.schemas.Settings.properties.list = { type: 'array' };
  const found = opaqueSchemas(s).join('\n');
  assert.match(found, /Settings\.loose$/m);
  assert.match(found, /Settings\.bag \(object with no properties\)/);
  assert.match(found, /Settings\.list \(array with no items\)/);
});

test('x-clerk-any is the one way to say "any value", and it must give a reason', () => {
  assert.ok(SPEC.components.schemas.FieldValue['x-clerk-any'].length > 10);
  const s = clone();
  delete s.components.schemas.FieldValue['x-clerk-any']; // the same "any JSON value", without its reason
  assert.match(opaqueSchemas(s).join(), /FieldValue \(object with no properties\)/);
});

test('a parameter rule the server cannot enforce is refused at startup', () => {
  const s = clone();
  s.paths['/api/clerk/explain'].get.parameters[0].schema.maxLength = 5;
  assert.match(checkSpec(s, Object.keys(HANDLERS)).join(), /uses "maxLength", which the server cannot enforce/);
});

test('the spec is OpenAPI 3.1 with a MAJOR.MINOR.PATCH version', () => {
  assert.match(SPEC.openapi, /^3\.1\./);
  assert.match(SPEC.info.version, /^\d+\.\d+\.\d+$/);
});

test('query checks derive from the spec: required, pattern, unknown names', () => {
  const r = (id) => routes(SPEC).find((x) => x.operationId === id);
  assert.equal(checkQuery(r('explain'), { ref: 'clerk#97' }), null);
  assert.equal(checkQuery(r('explain'), {}).code, 'missing-parameter');
  assert.equal(checkQuery(r('explain'), { ref: 'clerk 97' }).code, 'bad-parameter');
  assert.equal(checkQuery(r('settings'), { x: '1' }).code, 'unknown-parameter');
  assert.equal(checkQuery(r('ground'), { since: '2026-10-01' }), null);
  assert.equal(checkQuery(r('ground'), { since: 'yesterday' }).code, 'bad-parameter');
});

test('only POST /api/sync is an act', () => {
  assert.deepEqual(routes(SPEC).filter((r) => r.act).map((r) => `${r.method} ${r.path}`), ['POST /api/sync']);
});
