import { createFileRoute } from "@tanstack/react-router";
import { handleAppLinkAssociationRequest } from "@bb/connect-db";
import { getEnv } from "@/server/env";

// Android app links for bb mobile: fingerprints come from the
// ASSETLINKS_SHA256_FINGERPRINTS var (empty list until the app is signed).
export const Route = createFileRoute("/.well-known/assetlinks.json")({
  server: {
    handlers: {
      GET: ({ request }) =>
        handleAppLinkAssociationRequest(request, getEnv()) ??
        new Response("not found\n", { status: 404 }),
    },
  },
});
