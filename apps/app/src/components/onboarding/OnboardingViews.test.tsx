// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentStep,
  ProjectsStep,
  type OnboardingAgent,
  type OnboardingRepo,
  type ProjectsStepStatus,
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

const repo: OnboardingRepo = {
  id: "/home/user/code/app",
  name: "app",
  path: "/home/user/code/app",
  lastActive: "2 days ago",
  remote: null,
  added: false,
};

function renderProjects(
  status: ProjectsStepStatus,
  options: { repos?: OnboardingRepo[]; failedNames?: string[] } = {},
) {
  const handlers = {
    onToggle: vi.fn(),
    onSelectAll: vi.fn(),
    onSelectNone: vi.fn(),
    onAddFolder: vi.fn(),
    onRetry: vi.fn(),
  };
  render(
    <ProjectsStep
      status={status}
      repos={options.repos ?? []}
      selectedIds={new Set()}
      failedNames={options.failedNames ?? []}
      {...handlers}
    />,
  );
  return handlers;
}

describe("ProjectsStep", () => {
  it("says the scan ran out of time and names unreadable folders when nothing was found", () => {
    const handlers = renderProjects({
      kind: "results",
      truncated: true,
      unreadableFolderNames: ["Documents", "Desktop"],
    });

    expect(
      screen.getByText(
        "The scan ran out of time before bb found a git repo you've worked in over the last 30 days.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "bb wasn't allowed to open Documents and Desktop, so repos there may be missing.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Scan again" }));
    expect(handlers.onRetry).toHaveBeenCalledOnce();
  });

  it("offers a rescan under a partial list", () => {
    const handlers = renderProjects(
      {
        kind: "results",
        truncated: false,
        unreadableFolderNames: ["Documents", "Desktop", "iCloud", "Shared"],
      },
      { repos: [repo] },
    );

    expect(
      screen.getByText(
        /bb wasn't allowed to open Documents, Desktop, iCloud, and 1 more/u,
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Scan again" }));
    expect(handlers.onRetry).toHaveBeenCalledOnce();
  });

  it("names the repos that failed to import", () => {
    renderProjects(
      { kind: "results", truncated: false, unreadableFolderNames: [] },
      { repos: [repo], failedNames: ["api", "web"] },
    );

    expect(screen.getByRole("alert").textContent).toBe(
      "bb couldn't add api and web.",
    );
    expect(screen.queryByRole("button", { name: "Scan again" })).toBeNull();
  });

  it("hides the folder picker when there is no machine to scan", () => {
    renderProjects({
      kind: "unavailable",
      message: "Add a computer to bb to find your projects.",
      canRetry: false,
    });

    expect(
      screen.getByText("Add a computer to bb to find your projects."),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
