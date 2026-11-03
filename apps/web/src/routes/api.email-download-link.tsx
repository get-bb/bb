import { createFileRoute } from "@tanstack/react-router";
import { handleEmailDownloadLink } from "@/landing/endpoints";
import { getEnv } from "@/server/env";

export const Route = createFileRoute("/api/email-download-link")({
  server: {
    handlers: {
      POST: ({ request }) => handleEmailDownloadLink(request, getEnv()),
    },
  },
});
