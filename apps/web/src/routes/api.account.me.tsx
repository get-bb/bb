import { createFileRoute } from "@tanstack/react-router";
import { serverCredentialFromHeaders } from "@bb/connect-db";
import { accountApiResponse, getAccountMe } from "@/server/account";
import { depsFromEnv } from "@/server/api";
import { getEnv } from "@/server/env";

export const Route = createFileRoute("/api/account/me")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        accountApiResponse(
          await getAccountMe(
            depsFromEnv(getEnv()),
            serverCredentialFromHeaders(request.headers),
          ),
        ),
    },
  },
});
