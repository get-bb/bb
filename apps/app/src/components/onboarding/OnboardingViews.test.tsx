// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentStep, type OnboardingAgent } from "./OnboardingViews";
import type { AgentSetupState } from "./onboarding-model";

function agent(id: string, state: AgentSetupState): OnboardingAgent {
  return { id, name: id, provider: { id, logoUrl: null }, state };
}

function renderAgents(agents: OnboardingAgent[]) {
  const handlers = {
    onSignIn: vi.fn(),
    onInstall: vi.fn(),
    onViewInstallLog: vi.fn(),
    onCancelSignIn: vi.fn(),
    onRecheck: vi.fn(),
  };
  render(<AgentStep machineName="bee" agents={agents} {...handlers} />);
  return handlers;
}

afterEach(cleanup);

describe("AgentStep", () => {
  it("offers the install log only on the agent whose install failed", () => {
    const handlers = renderAgents([
      agent("claude-code", { status: "install", canInstall: true }),
      agent("codex", {
        status: "installFailed",
        message: "Install failed",
        canInstall: true,
      }),
      agent("pi", { status: "installing" }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "View log" }));

    expect(handlers.onViewInstallLog).toHaveBeenCalledExactlyOnceWith("codex");
    expect(handlers.onInstall).not.toHaveBeenCalled();
  });

  it("keeps the install log reachable when the machine offers no retry", () => {
    const handlers = renderAgents([
      agent("codex", {
        status: "installFailed",
        message: "Install failed",
        canInstall: false,
      }),
    ]);

    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View log" }));

    expect(handlers.onViewInstallLog).toHaveBeenCalledExactlyOnceWith("codex");
  });
});
