// The service contract as rules: what api/openapi.json says, read once (decision 46bb7a8c: the spec leads). Pure.
// routes() is the route table the server serves; checkSpec() refuses a spec the server cannot honour exactly (an operation
// with no handler, a handler with no operation, a parameter rule it cannot enforce, an opaque schema); checkQuery() is the
// parameter check, derived from the spec rather than written by hand.

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
// the only parameter schema the server enforces at runtime (the runtime has no dependencies); anything else is refused at startup
const PARAM_KEYS = new Set(['type', 'pattern', 'description']);

export function routes(spec) {
  const out = [];
  for (const [path, item] of Object.entries(spec.paths ?? {}))
    for (const m of METHODS) {
      const op = item[m];
      if (!op) continue;
      out.push({ method: m.toUpperCase(), path, operationId: op.operationId, act: Boolean(op['x-clerk-act']),
        params: (op.parameters ?? []).map((p) => ({ name: p.name, in: p.in, required: Boolean(p.required), pattern: p.schema?.pattern ?? null, schema: p.schema ?? {} })) });
    }
  return out;
}

// Every schema that says nothing about its value: no type, $ref, combinator, const or enum; an object with neither properties
// nor a typed additionalProperties; an array with no items. An explicit `x-clerk-any` (with its reason) is the one exception.
export function opaqueSchemas(spec) {
  const found = [];
  const walk = (s, at) => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return;
    if (s['x-clerk-any']) return;
    const typed = s.type || s.$ref || s.oneOf || s.anyOf || s.allOf || 'const' in s || s.enum;
    if (!typed) found.push(at);
    const types = [].concat(s.type ?? []);
    if (types.includes('object') && !s.properties && !(s.additionalProperties && typeof s.additionalProperties === 'object')) found.push(`${at} (object with no properties)`);
    if (types.includes('array') && !s.items) found.push(`${at} (array with no items)`);
    for (const [k, v] of Object.entries(s.properties ?? {})) walk(v, `${at}.${k}`);
    if (s.items) walk(s.items, `${at}[]`);
    if (s.additionalProperties && typeof s.additionalProperties === 'object') walk(s.additionalProperties, `${at}{}`);
    for (const k of ['oneOf', 'anyOf', 'allOf']) (s[k] ?? []).forEach((x, i) => walk(x, `${at}.${k}[${i}]`));
  };
  for (const [n, s] of Object.entries(spec.components?.schemas ?? {})) walk(s, `#/components/schemas/${n}`);
  for (const r of routes(spec)) {
    const op = spec.paths[r.path][r.method.toLowerCase()];
    for (const [code, res] of Object.entries(op.responses ?? {})) for (const [ct, c] of Object.entries(res.content ?? {})) walk(c.schema, `${r.method} ${r.path} ${code} ${ct}`);
  }
  return found;
}

// [] when the server can serve the spec exactly as written, else every reason it cannot
export function checkSpec(spec, handlerIds) {
  const errors = [], rs = routes(spec), ids = new Set(handlerIds);
  if (!/^3\.1\./.test(spec.openapi ?? '')) errors.push(`openapi must be 3.1.x, not ${spec.openapi}`);
  if (!/^\d+\.\d+\.\d+$/.test(spec.info?.version ?? '')) errors.push('info.version must be MAJOR.MINOR.PATCH');
  const seen = new Set();
  for (const r of rs) {
    if (!r.operationId) errors.push(`${r.method} ${r.path} has no operationId`);
    else if (seen.has(r.operationId)) errors.push(`operationId ${r.operationId} is used twice`);
    else seen.add(r.operationId);
    if (r.operationId && !ids.has(r.operationId)) errors.push(`operation ${r.operationId} has no handler`);
    for (const p of r.params) {
      if (p.in !== 'query') errors.push(`${r.operationId}: parameter ${p.name} is in ${p.in}; only query parameters are served`);
      if (p.schema.type !== 'string') errors.push(`${r.operationId}: parameter ${p.name} must be a string`);
      for (const k of Object.keys(p.schema)) if (!PARAM_KEYS.has(k)) errors.push(`${r.operationId}: parameter ${p.name} uses "${k}", which the server cannot enforce`);
    }
  }
  for (const id of ids) if (!seen.has(id)) errors.push(`handler ${id} has no operation`);
  for (const at of opaqueSchemas(spec)) errors.push(`opaque schema: ${at}`);
  return errors;
}

// null when the query is acceptable, else the error to return (400)
export function checkQuery(route, query) {
  const known = new Set(route.params.map((p) => p.name));
  for (const k of Object.keys(query)) if (!known.has(k)) return error('unknown-parameter', `${route.operationId} takes no parameter "${k}"`);
  for (const p of route.params) {
    const v = query[p.name];
    if (v === undefined) { if (p.required) return error('missing-parameter', `${route.operationId} needs "${p.name}"`); continue; }
    if (p.pattern && !new RegExp(p.pattern).test(v)) return error('bad-parameter', `"${p.name}" must match ${p.pattern}`);
  }
  return null;
}

export const ok = (payload) => ({ ok: true, payload });
export const error = (code, message) => ({ code, message });
export const fail = (...errors) => ({ ok: false, errors });
