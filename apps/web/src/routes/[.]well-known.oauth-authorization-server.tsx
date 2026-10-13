import { createFileRoute } from "@tanstack/react-router";
import { getEnv } from "@/server/env";
import { oauthAuthorizationServerMetadataResponse } from "@/server/oauth";

export const Route = createFileRoute("/.well-known/oauth-authorization-server")(
  {
    server: {
      handlers: {
        GET: () => oauthAuthorizationServerMetadataResponse(getEnv()),
      },
    },
  },
);
