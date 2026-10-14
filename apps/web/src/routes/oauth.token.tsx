import { createFileRoute } from "@tanstack/react-router";
import { depsFromEnv } from "@/server/api";
import { getEnv } from "@/server/env";
import { handleOAuthTokenRequest } from "@/server/oauth";

export const Route = createFileRoute("/oauth/token")({
  server: {
    handlers: {
      POST: ({ request }) => {
        const env = getEnv();
        return handleOAuthTokenRequest(env, depsFromEnv(env).db, request);
      },
    },
  },
});
