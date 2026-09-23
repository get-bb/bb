import { createFileRoute } from "@tanstack/react-router";
import { serverCredentialFromHeaders } from "@bb/connect-db";
import { accountApiResponse, issueTunnelTicket } from "@/server/account";
import { depsFromEnv } from "@/server/api";
import { getEnv } from "@/server/env";

export const Route = createFileRoute("/api/connect/tunnel-ticket")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const env = getEnv();
        return accountApiResponse(
          await issueTunnelTicket(
            depsFromEnv(env),
            serverCredentialFromHeaders(request.headers),
            env.BETTER_AUTH_SECRET,
          ),
        );
      },
    },
  },
});
