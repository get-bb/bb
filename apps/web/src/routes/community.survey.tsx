import { createFileRoute } from "@tanstack/react-router";
import { handleCommunityForm } from "../community/handler";
import { getEnv } from "../server/env";

export const Route = createFileRoute("/community/survey")({
  server: {
    handlers: {
      GET: ({ request }) => handleCommunityForm(request, getEnv(), "survey"),
      POST: ({ request }) => handleCommunityForm(request, getEnv(), "survey"),
    },
  },
});
