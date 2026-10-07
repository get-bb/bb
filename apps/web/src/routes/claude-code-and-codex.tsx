import { createFileRoute } from "@tanstack/react-router";

import { AgentLandingPage, agentLandingHead } from "../landing/agent-landing";

export const Route = createFileRoute("/claude-code-and-codex")({
  head: () => agentLandingHead("codex-review"),
  component: ClaudeCodeAndCodexRoute,
});

function ClaudeCodeAndCodexRoute() {
  return <AgentLandingPage variant="codex-review" />;
}
