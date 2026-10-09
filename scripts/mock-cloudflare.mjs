// Local stand-in for the Cloudflare Workers AI REST API, used only by verify-live.mjs.
// It counts every upstream request so tests can prove there are no retries or extra calls.
// Control: POST /__mode {"mode":"ok"|"error"|"capacity"}; GET /__stats.
import { createServer } from "node:http";

let mode = "ok";
const stats = { requests: 0, lastBody: null, lastAuth: null };

const SAMPLE = `<<<ARCHITECT>>>
**Outcome:** Visitors get a friendly 429 after 20 requests a minute.
- Riskiest: in-memory counters don't survive serverless instances.
1. Shared-store limiter helper
2. Wire into the route
<<<BUILDER>>>
### lib/limit.ts
\`\`\`ts
export async function limit(key: string) { return { ok: true }; }
\`\`\`
<<<CRITIC>>>
1. [major] The stub always allows, so it limits nothing. Fix: back it with a shared store.
Verdict: REVISE
<<<WITNESS>>>
1. Request hits the route. 2. limit() is called. 3. Always passes.
Run this to verify: curl -i localhost:3000/api/x
<<<GATES>>>
{"intent":"pass","journey":"unverified","craft":"pass","correctness":"fail","safety":"pass","truth":"pass"}`;

createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const send = (status, obj) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  if (req.url === "/__mode") {
    mode = JSON.parse(body).mode;
    return send(200, { mode });
  }
  if (req.url === "/__stats") return send(200, stats);

  if (req.method === "POST" && req.url.includes("/ai/run/")) {
    stats.requests++;
    stats.lastBody = JSON.parse(body);
    stats.lastAuth = req.headers.authorization ? "present" : "missing";
    if (mode === "capacity") {
      return send(429, { success: false, errors: [{ code: 3036, message: "Account limited: daily free allocation of neurons exceeded" }] });
    }
    if (mode === "error") return send(500, { success: false, errors: [{ code: 7000, message: "Internal error" }] });
    return send(200, { success: true, errors: [], result: { response: SAMPLE, usage: { prompt_tokens: 812, completion_tokens: 344 } } });
  }
  send(404, { error: "not found" });
}).listen(8787, "127.0.0.1", () => console.log("mock cloudflare on :8787"));
