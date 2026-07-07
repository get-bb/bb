import { createFileRoute } from "@tanstack/react-router";
import { handleSubscribe } from "@/landing/endpoints";
import { getEnv } from "@/server/env";

// Email signup for the marketing page — adds the address to the bb audience
// in Resend. Ported from the old landing worker.
export const Route = createFileRoute("/api/subscribe")({
  server: {
    handlers: {
      POST: ({ request }) => handleSubscribe(request, getEnv()),
    },
  },
});
