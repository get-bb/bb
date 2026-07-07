import { createFileRoute } from "@tanstack/react-router";
import { waitUntil } from "cloudflare:workers";
import { handleDownloadMacos } from "@/landing/endpoints";
import { getEnv } from "@/server/env";

// Plain HTTP redirect (no page): resolves the current macOS dmg from the
// release feed and 302s to it, tracking the click server-side so ad blockers
// don't hide download conversions. Ported from the old landing worker.
export const Route = createFileRoute("/download/macos")({
  server: {
    handlers: {
      GET: ({ request }) => handleDownloadMacos(request, getEnv(), waitUntil),
    },
  },
});
