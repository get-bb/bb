import { createFileRoute } from "@tanstack/react-router";
import { serverCredentialFromHeaders } from "@bb/connect-db";
import { accountApiResponse } from "@/server/account";
import { depsFromEnv } from "@/server/api";
import { getEnv } from "@/server/env";
import { listOAuthGrantsForCredential } from "@/server/oauth";

export const Route = createFileRoute("/api/mcp/grants")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        accountApiResponse(
          await listOAuthGrantsForCredential(
            depsFromEnv(getEnv()).db,
            serverCredentialFromHeaders(request.headers),
          ),
        ),
    },
  },
});
