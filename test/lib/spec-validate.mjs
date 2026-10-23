// Tests only (ajv is a devDependency; the clerk's runtime imports nothing outside Node). Validate a response envelope against
// the schema api/openapi.json gives the operation: 200 bodies against the operation's ok schema, anything else against Failure.
import Ajv2020 from 'ajv/dist/2020.js';

export function specValidator(spec) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const compiled = new Map();
  const schemaFor = (operationId, status) => {
    const key = `${operationId} ${status === 200 ? 200 : 'default'}`;
    if (!compiled.has(key)) {
      const op = Object.values(spec.paths).flatMap((item) => Object.values(item)).find((o) => o.operationId === operationId);
      if (!op) throw new Error(`no operation ${operationId} in the spec`);
      const res = op.responses[status === 200 ? '200' : 'default'];
      compiled.set(key, ajv.compile({ ...res.content['application/json'].schema, components: spec.components }));
    }
    return compiled.get(key);
  };
  // returns [] when the body conforms, else the ajv errors as readable lines
  return (operationId, status, body) => {
    const v = schemaFor(operationId, status);
    return v(body) ? [] : v.errors.map((e) => `${e.instancePath || '(root)'} ${e.message}${e.params ? ' ' + JSON.stringify(e.params) : ''}`);
  };
}
