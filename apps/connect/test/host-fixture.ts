import worker, { TunnelDO } from "../src/worker.js";
import type { Env } from "../src/tunnel-do.js";

export { TunnelDO };

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const headers = new Headers(request.headers);
    headers.set("host", new URL(request.url).host);
    return worker.fetch(new Request(request, { headers }), env, ctx);
  },
} satisfies ExportedHandler<Env>;
