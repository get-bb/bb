import { createFileRoute } from "@tanstack/react-router";
import { handleSurveySubmission } from "@/community/handler";
import { getEnv } from "@/server/env";

export const Route = createFileRoute("/api/community/survey")({
  server: {
    handlers: {
      POST: ({ request }) => handleSurveySubmission(request, getEnv()),
    },
  },
});
