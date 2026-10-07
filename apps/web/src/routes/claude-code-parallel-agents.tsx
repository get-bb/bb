import { createFileRoute } from "@tanstack/react-router";

import { AgentLandingPage, agentLandingHead } from "../landing/agent-landing";

export const Route = createFileRoute("/claude-code-parallel-agents")({
  head: () => agentLandingHead("parallel"),
  component: ClaudeCodeParallelAgentsRoute,
});

function ClaudeCodeParallelAgentsRoute() {
  return <AgentLandingPage variant="parallel" />;
}
