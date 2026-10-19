import { createFileRoute } from "@tanstack/react-router";
import { depsFromEnv } from "@/server/api";
import { getEnv } from "@/server/env";
import { handleOAuthRevokeRequest } from "@/server/oauth";

export const Route = createFileRoute("/oauth/revoke")({
  server: {
    handlers: {
      POST: ({ request }) => {
        const env = getEnv();
        return handleOAuthRevokeRequest(env, depsFromEnv(env).db, request);
      },
    },
  },
});
