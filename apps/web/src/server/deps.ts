import { tunnelConnectedLookup } from "@bb/connect-db";
import { resolveServerUrlTemplate, type Deps } from "./api.js";
import { connectDbFromEnv } from "./connect-db.js";
import type { Env } from "./env.js";

export function depsFromEnv(env: Env): Deps {
  return {
    db: connectDbFromEnv(env),
    appUrl: env.APP_URL,
    serverUrlTemplate: resolveServerUrlTemplate(
      env.CONNECT_SERVER_URL_TEMPLATE,
      env.BASE_DOMAIN,
    ),
    closeTunnel: async (routingKey) => {
      const stub = env.TUNNEL_DO.get(env.TUNNEL_DO.idFromName(routingKey));
      const response = await stub.fetch("https://tunnel/__control/close");
      if (!response.ok) {
        throw new Error(`tunnel close failed (${response.status})`);
      }
    },
    tunnelConnected: tunnelConnectedLookup(env, env.TUNNEL_DO),
  };
}
