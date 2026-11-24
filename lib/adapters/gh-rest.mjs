// Mutating REST for the no-`gh` fallback: ["-X", METHOD, "path", "-F"/"-f", "key=value"...].
// Like `gh api`, a non-2xx status is an error (clerk#304: this used to GET "/-X" and exit 0).
export function mutateApi(args, send) {
  const method = args[1];
  const body = {};
  for (let i = 3; i < args.length; i += 2) {
    const kv = args[i + 1] || "";
    const eq = kv.indexOf("=");
    const val = kv.slice(eq + 1);
    body[kv.slice(0, eq)] = args[i] === "-F" && val !== "" && !isNaN(val) ? Number(val) : val;
  }
  const r = send(method, `https://api.github.com/${args[2]}`, body);
  if (!(r.status >= 200 && r.status < 300)) {
    let why = r.body;
    try { why = JSON.parse(r.body).message || r.body; } catch { /* keep raw */ }
    throw new Error(`gh: HTTP ${r.status} ${method} ${args[2]}: ${String(why).trim()}`);
  }
  return r.body;
}
