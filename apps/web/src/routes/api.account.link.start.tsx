import { createFileRoute } from "@tanstack/react-router";
import {
  accountApiResponse,
  linkRequestOrigin,
  readJsonObject,
  startServerLink,
} from "@/server/account";
import { depsFromEnv } from "@/server/api";
import { getEnv } from "@/server/env";

export const Route = createFileRoute("/api/account/link/start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const env = getEnv();
        const body = await readJsonObject(request);
        return accountApiResponse(
          await startServerLink(
            {
              ...depsFromEnv(env),
              rateLimiter: env.LINK_START_RATE_LIMITER,
            },
            { clientName: body.clientName, ...linkRequestOrigin(request) },
          ),
        );
      },
    },
  },
});
