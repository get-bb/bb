import { createFileRoute } from "@tanstack/react-router";

import { AgentLandingPage, agentLandingHead } from "../landing/agent-landing";

export const Route = createFileRoute("/claude-code-mobile")({
  head: () => agentLandingHead("phone"),
  component: ClaudeCodeMobileRoute,
});

function ClaudeCodeMobileRoute() {
  return <AgentLandingPage variant="phone" />;
}
