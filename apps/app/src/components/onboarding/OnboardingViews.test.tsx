// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  AgentSignInInstruction,
  AgentSignInPanel,
  AgentStep,
  OnboardingLayout,
  ProjectsStep,
  type OnboardingAgent,
  type OnboardingRepo,
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
  it("keeps a failed install quiet and keeps a way out of signing in", () => {
    const onCancelSignIn = vi.fn();
    render(
      <TooltipProvider>
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
          onCancelSignIn={onCancelSignIn}
          onRecheck={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole("button", { name: /Retry/u })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View log" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel signing in to claude-code" }),
    );
    expect(onCancelSignIn).toHaveBeenCalledExactlyOnceWith("claude-code");
    expect(
      screen.getByText(
        "Don't see your agent? bb picks up other ACP agents once you have them installed.",
      ),
    ).toBeTruthy();
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

describe("ProjectsStep selection", () => {
  function repo(id: string, added = false): OnboardingRepo {
    return {
      id,
      name: id,
      path: `/projects/${id}`,
      lastActive: "1h ago",
      remote: null,
      added,
    };
  }

  function renderProjects(args: {
    selection?: "line" | "header";
    repos: OnboardingRepo[];
    selectedIds: string[];
  }) {
    const handlers = {
      onToggle: vi.fn(),
      onSelectAll: vi.fn(),
      onSelectNone: vi.fn(),
      onAddFolder: vi.fn(),
      onRetry: vi.fn(),
    };
    render(
      <ProjectsStep
        {...(args.selection === undefined ? {} : { selection: args.selection })}
        status={{ kind: "results", truncated: false }}
        repos={args.repos}
        selectedIds={new Set(args.selectedIds)}
        {...handlers}
      />,
    );
    return handlers;
  }

  it("keeps today's count line by default", () => {
    renderProjects({ repos: [repo("a"), repo("b")], selectedIds: ["a"] });

    expect(screen.getByText("1 of 2 selected")).toBeTruthy();
    expect(
      screen.queryByRole("checkbox", { name: "Select all projects" }),
    ).toBeNull();
  });

  it("selects every project from a partly selected header", () => {
    const handlers = renderProjects({
      selection: "header",
      repos: [repo("a"), repo("b"), repo("c", true)],
      selectedIds: ["a"],
    });

    expect(screen.queryByText(/selected/u)).toBeNull();
    const header = screen.getByRole("checkbox", {
      name: "Select all projects",
    });
    expect(header.getAttribute("data-state")).toBe("indeterminate");
    fireEvent.click(header);

    expect(handlers.onSelectAll).toHaveBeenCalledOnce();
    expect(handlers.onSelectNone).not.toHaveBeenCalled();
  });

  it("clears the selection when every selectable project is checked", () => {
    const handlers = renderProjects({
      selection: "header",
      repos: [repo("a"), repo("b"), repo("c", true)],
      selectedIds: ["a", "b"],
    });

    const header = screen.getByRole("checkbox", {
      name: "Clear project selection",
    });
    expect(header.getAttribute("data-state")).toBe("checked");
    fireEvent.click(header);

    expect(handlers.onSelectNone).toHaveBeenCalledOnce();
  });

  it("disables the header when every project is already added", () => {
    renderProjects({
      selection: "header",
      repos: [repo("a", true)],
      selectedIds: [],
    });

    const header = screen.getByRole("checkbox", {
      name: "Select all projects",
    });
    expect(header.getAttribute("data-state")).toBe("unchecked");
    expect(header.hasAttribute("disabled")).toBe(true);
  });
});

describe("AgentSignInInstruction", () => {
  function renderInstruction(
    url: string | null,
    overrides: { userCode?: string; paste?: boolean; connect?: boolean } = {},
  ) {
    render(
      <p data-testid="instruction">
        <AgentSignInInstruction
          connect={overrides.connect ?? false}
          agentName="Cursor"
          view={{
            guide:
              url === null
                ? null
                : {
                    url,
                    userCode: overrides.userCode ?? null,
                    acceptsPastedCode: overrides.paste ?? false,
                  },
            terminalVisible: false,
          }}
          alternate={null}
          onOpenUrl={vi.fn()}
          onUseAlternate={vi.fn()}
        />
      </p>,
    );
    return screen.getByTestId("instruction");
  }

  it("names the website to finish signing in on", () => {
    const line = renderInstruction("https://www.cursor.com/login");

    expect(screen.getByRole("link", { name: "cursor.com" })).toBeTruthy();
    expect(line.textContent).toBe("Finish signing in on cursor.com.");
  });

  it("names the website for paste sign-ins", () => {
    expect(
      renderInstruction("https://claude.ai/oauth/authorize", { paste: true })
        .textContent,
    ).toBe("Sign in on claude.ai, then paste the code it shows you.");
  });

  it("falls back to the browser when the URL has no website", () => {
    expect(renderInstruction("file:///tmp/sign-in").textContent).toBe(
      "Finish signing in in your browser.",
    );
  });

  it("says nothing for terminal connect flows", () => {
    expect(
      renderInstruction("https://example.com", { connect: true }).textContent,
    ).toBe("");
  });
});

describe("AgentSignInPanel", () => {
  it("stays hidden while sign-in is still starting", () => {
    const { container } = render(
      <AgentSignInPanel
        connect={false}
        agentName="Cursor"
        view={{ guide: null, terminalVisible: false }}
        code=""
        codeSubmitted={false}
        terminal={null}
        onCodeChange={vi.fn()}
        onSubmitCode={vi.fn()}
        onCopy={vi.fn()}
        onToggleTerminal={vi.fn()}
      />,
    );

    expect(container.textContent).toBe("");
  });

  it("holds only the controls, not the instruction or a waiting line", () => {
    render(
      <AgentSignInPanel
        connect={false}
        agentName="Claude Code"
        view={{
          guide: {
            url: "https://claude.ai/oauth/authorize",
            userCode: null,
            acceptsPastedCode: true,
          },
          terminalVisible: false,
        }}
        code=""
        codeSubmitted={false}
        terminal={null}
        onCodeChange={vi.fn()}
        onSubmitCode={vi.fn()}
        onCopy={vi.fn()}
        onToggleTerminal={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "Claude Code authorization code" }),
    ).toBeTruthy();
    expect(screen.queryByText(/paste the code it shows you/u)).toBeNull();
    expect(screen.queryByText(/continues automatically/u)).toBeNull();
  });
});

describe("AgentStep progress", () => {
  it("puts a spinner beside in-progress subtitles in the redesign only", () => {
    const { container, rerender } = render(
      <TooltipProvider>
        <AgentStep
          quiet
          machineName="bee"
          agents={[agent("pi", { status: "signingIn" })]}
          onSignIn={vi.fn()}
          onInstall={vi.fn()}
          onViewInstallLog={vi.fn()}
          onCancelSignIn={vi.fn()}
          onRecheck={vi.fn()}
        />
      </TooltipProvider>,
    );
    const subtitle = screen.getByText("Finish signing in below");
    expect(
      subtitle.closest("span.flex")?.querySelector('[data-icon="Spinner"]'),
    ).not.toBeNull();

    rerender(
      <AgentStep
        machineName="bee"
        agents={[agent("pi", { status: "installing" })]}
        onSignIn={vi.fn()}
        onInstall={vi.fn()}
        onViewInstallLog={vi.fn()}
        onCancelSignIn={vi.fn()}
        onRecheck={vi.fn()}
      />,
    );
    expect(
      screen
        .getByText("Installing…")
        .closest("span.flex")
        ?.querySelector('[data-icon="Spinner"]') ?? null,
    ).toBeNull();
    expect(container.querySelectorAll('[data-icon="Spinner"]')).toHaveLength(1);
  });
});
