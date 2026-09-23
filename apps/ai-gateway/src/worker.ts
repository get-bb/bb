import { drizzle } from "drizzle-orm/d1";
import { schema } from "@bb/connect-db";
import { type Env, type GatewayConfig, parseGatewayConfig } from "./config.js";
import { routeGatewayRequest, unavailableResponse } from "./gateway.js";
import { pruneAiUsage } from "./metering.js";
import { UPSTREAM_TIMEOUT_MS } from "./upstream.js";

function loadConfig(env: Env): GatewayConfig | null {
  try {
    return parseGatewayConfig(env);
  } catch (error) {
    console.error("bb ai gateway: invalid configuration", error);
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const config = loadConfig(env);
    if (config === null) {
      return unavailableResponse("hosted generation is not configured");
    }
    return routeGatewayRequest(request, {
      db: drizzle(env.DB, { schema }),
      config,
      rateLimiter: env.AI_RATE_LIMITER,
      fetch: (input, init) => fetch(input, init),
      now: () => Date.now(),
      upstreamTimeoutMs: UPSTREAM_TIMEOUT_MS,
    });
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await pruneAiUsage(drizzle(env.DB, { schema }), controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;
