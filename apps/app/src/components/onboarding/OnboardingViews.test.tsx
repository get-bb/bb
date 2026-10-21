// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentStep, type OnboardingAgent } from "./OnboardingViews";
import {
  resolveFreeAgentOffer,
  type AgentSetupState,
} from "./onboarding-model";

function agent(id: string, state: AgentSetupState): OnboardingAgent {
  return { id, name: id, provider: { id, logoUrl: null }, state };
}

function renderAgents(agents: OnboardingAgent[]) {
  const handlers = {
    onSignIn: vi.fn(),
    onInstall: vi.fn(),
    onViewInstallLog: vi.fn(),
    onCancelSignIn: vi.fn(),
    onGetNodejs: vi.fn(),
    onSetUpFreeAgent: vi.fn(),
    onCreateFreeAccount: vi.fn(),
    onRecheck: vi.fn(),
  };
  render(
    <AgentStep
      machineName="bee"
      agents={agents}
      freeAgentOffer={resolveFreeAgentOffer(agents)}
      {...handlers}
    />,
  );
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

  it("sends an agent that needs Node.js to the download instead of an install that cannot run", () => {
    const handlers = renderAgents([agent("pi", { status: "needsNodejs" })]);

    expect(screen.getByText("Needs Node.js to install")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Install/ })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Get Node.js (opens nodejs.org)" }),
    );

    expect(handlers.onGetNodejs).toHaveBeenCalledOnce();
  });

  it("offers the agent with a free sign-up when no agent is ready, and hides it once one is", () => {
    const freeAgent: OnboardingAgent = {
      ...agent("free-agent", { status: "install", canInstall: true }),
      name: "Free Agent",
      freeSignUp: { accountName: "Acme", url: "https://acme.test/" },
    };
    const handlers = renderAgents([
      agent("other-agent", { status: "install", canInstall: true }),
      freeAgent,
    ]);

    expect(screen.getByText("No agent yet? Start free with Free Agent")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Set up Free Agent" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Create a free Acme account (opens acme.test)",
      }),
    );

    expect(handlers.onSetUpFreeAgent).toHaveBeenCalledOnce();
    expect(handlers.onCreateFreeAccount).toHaveBeenCalledOnce();

    cleanup();
    renderAgents([
      agent("other-agent", { status: "ready", detail: null }),
      freeAgent,
    ]);
    expect(screen.queryByRole("button", { name: "Set up Free Agent" })).toBeNull();
  });
});
