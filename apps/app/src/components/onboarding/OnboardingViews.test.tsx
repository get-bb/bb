// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentStep,
  OnboardingLayout,
  type OnboardingAgent,
} from "./OnboardingViews";
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

describe("AgentStep in the redesigned guide", () => {
  it("keeps a failed install quiet: retry stays, the log button and sign-in cancel go", () => {
    render(
      <AgentStep
        quiet
        machineName="bee"
        agents={[
          agent("codex", {
            status: "installFailed",
            message: "Couldn't install. Check your connection and retry.",
            canInstall: true,
          }),
          agent("claude-code", { status: "signingIn" }),
        ]}
        onSignIn={vi.fn()}
        onInstall={vi.fn()}
        onViewInstallLog={vi.fn()}
        onCancelSignIn={vi.fn()}
        onRecheck={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Retry/u })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View log" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });
});

describe("OnboardingLayout stepper", () => {
  function renderAt(skipped: ReadonlySet<"agent" | "projects">) {
    const onSelectStep = vi.fn();
    render(
      <OnboardingLayout
        step="plugins"
        composition="centered"
        showSkipAll={false}
        skippedSteps={skipped}
        title="Make bb yours"
        description=""
        primaryLabel="Continue"
        onPrimary={vi.fn()}
        onSelectStep={onSelectStep}
        onSkipAll={vi.fn()}
      >
        <div />
      </OnboardingLayout>,
    );
    return onSelectStep;
  }

  it("marks a step passed without finishing as skipped and still lets people go back to it", () => {
    const onSelectStep = renderAt(new Set(["projects"]));

    fireEvent.click(screen.getByRole("button", { name: "Projects (skipped)" }));

    expect(onSelectStep).toHaveBeenCalledExactlyOnceWith("projects");
    expect(screen.getByRole("button", { name: "Agent" })).toBeTruthy();
    expect(screen.queryByText("Skip setup")).toBeNull();
  });
});
