import { createFileRoute } from "@tanstack/react-router";
import { handleCommunityForm } from "../community/handler";
import { getEnv } from "../server/env";

export const Route = createFileRoute("/community/merch")({
  server: {
    handlers: {
      GET: ({ request }) => handleCommunityForm(request, getEnv(), "merch"),
      POST: ({ request }) => handleCommunityForm(request, getEnv(), "merch"),
    },
  },
});
