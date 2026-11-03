import { drizzle } from "drizzle-orm/d1";
import {
  SERVER_CREDENTIAL_CACHE_TTL_MS,
  ServerCredentialCache,
  schema,
} from "@bb/connect-db";
import { type Env, type GatewayConfig, parseGatewayConfig } from "./config.js";
import { routeGatewayRequest, unavailableResponse } from "./gateway.js";
import { pruneAiUsage } from "./metering.js";
import { TRANSCRIBE_TIMEOUT_MS, UPSTREAM_TIMEOUT_MS } from "./upstream.js";

const credentials = new ServerCredentialCache(SERVER_CREDENTIAL_CACHE_TTL_MS);

function loadConfig(env: Env): GatewayConfig | null {
  try {
    return parseGatewayConfig(env);
  } catch (error) {
    console.error("bb ai gateway: invalid configuration", error);
    return null;
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const config = loadConfig(env);
    if (config === null) {
      return unavailableResponse("hosted generation is not configured");
    }
    return routeGatewayRequest(request, {
      db: drizzle(env.DB, { schema }),
      credentials,
      config,
      rateLimiter: env.AI_RATE_LIMITER,
      fetch: (input, init) => fetch(input, init),
      now: () => Date.now(),
      upstreamTimeoutMs: UPSTREAM_TIMEOUT_MS,
      transcribeTimeoutMs: TRANSCRIBE_TIMEOUT_MS,
      waitUntil: (promise) => ctx.waitUntil(promise),
    });
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await pruneAiUsage(drizzle(env.DB, { schema }), controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;
