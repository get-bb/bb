import { createFileRoute } from "@tanstack/react-router";
import { getEnv } from "@/server/env";
import { serveMarketplaceObject } from "@/server/marketplace";

// The reserved bb-community plugin marketplace: `marketplace.json` and its icons, read
// from the bb-marketplace R2 bucket that the registry repository publishes to.
const handle = ({ request }: { request: Request }) =>
  serveMarketplaceObject({ bucket: getEnv().MARKETPLACE, request });

export const Route = createFileRoute("/marketplace/v1/$")({
  server: { handlers: { GET: handle, HEAD: handle } },
});
