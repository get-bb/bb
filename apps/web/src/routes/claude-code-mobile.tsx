import { createFileRoute } from "@tanstack/react-router";

import {
  ClaudeCodeMobilePage,
  claudeCodeMobileHead,
  parseLandingVariant,
  type LandingVariant,
} from "../landing/claude-code-mobile";

interface ClaudeCodeMobileSearch {
  for?: Exclude<LandingVariant, "phone">;
}

export const Route = createFileRoute("/claude-code-mobile")({
  validateSearch: (search: Record<string, unknown>): ClaudeCodeMobileSearch => {
    const variant = parseLandingVariant(search.for);
    return variant === "phone" ? {} : { for: variant };
  },
  head: ({ match }) =>
    claudeCodeMobileHead(parseLandingVariant(match.search.for)),
  component: ClaudeCodeMobileRoute,
});

function ClaudeCodeMobileRoute() {
  const search = Route.useSearch();
  return <ClaudeCodeMobilePage variant={parseLandingVariant(search.for)} />;
}
