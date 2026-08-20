import { createFileRoute } from "@tanstack/react-router";
import { handleAppLinkAssociationRequest } from "@bb/connect-db";
import { getEnv } from "@/server/env";

// iOS universal links for bb mobile (`applinks:getbb.app` +
// `applinks:*.getbb.app`): the apex serves the same association file the
// connect gate serves on every `<label>.getbb.app` (@bb/connect-db
// `app-links.ts` is the single source of truth). Anonymous, JSON, no redirect.
export const Route = createFileRoute("/.well-known/apple-app-site-association")(
  {
    server: {
      handlers: {
        GET: ({ request }) =>
          handleAppLinkAssociationRequest(request, getEnv()) ??
          new Response("not found\n", { status: 404 }),
      },
    },
  },
);
