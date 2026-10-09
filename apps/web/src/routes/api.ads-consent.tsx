import { createFileRoute } from "@tanstack/react-router";
import { consentRequiredForCountry } from "@/landing/google-ads";

export const Route = createFileRoute("/api/ads-consent")({
  server: {
    handlers: {
      GET: ({ request }) =>
        Response.json(
          {
            required: consentRequiredForCountry(
              request.headers.get("cf-ipcountry"),
            ),
          },
          { headers: { "cache-control": "private, no-store" } },
        ),
    },
  },
});
