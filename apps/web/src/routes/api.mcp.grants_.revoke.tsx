import { createFileRoute } from "@tanstack/react-router";
import { serverCredentialFromHeaders } from "@bb/connect-db";
import { accountApiResponse, readJsonObject } from "@/server/account";
import { depsFromEnv } from "@/server/api";
import { getEnv } from "@/server/env";
import { revokeOAuthGrantForCredential } from "@/server/oauth";

export const Route = createFileRoute("/api/mcp/grants_/revoke")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readJsonObject(request);
        return accountApiResponse(
          await revokeOAuthGrantForCredential(
            depsFromEnv(getEnv()).db,
            serverCredentialFromHeaders(request.headers),
            { grantId: body.grantId },
          ),
        );
      },
    },
  },
});
