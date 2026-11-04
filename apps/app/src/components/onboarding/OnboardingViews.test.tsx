// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  RedesignedDevicesStep,
  AgentInstallErrorDetails,
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
      agent("pi", { status: "installing", update: false }),
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
    overrides: { userCode?: string; paste?: boolean } = {},
  ) {
    render(
      <p data-testid="instruction">
        <AgentSignInInstruction
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
            started: url !== null,
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
});

describe("AgentSignInPanel", () => {
  it("stays hidden while sign-in is still starting", () => {
    const { container } = render(
      <AgentSignInPanel
        connect={false}
        agentName="Cursor"
        view={{ guide: null, terminalVisible: false, started: false }}
        code=""
        codeSubmitted={false}
        alternate={null}
        terminal={null}
        onCodeChange={vi.fn()}
        onSubmitCode={vi.fn()}
        onOpenUrl={vi.fn()}
        onCopy={vi.fn()}
        onToggleTerminal={vi.fn()}
      />,
    );

    expect(container.textContent).toBe("");
  });

  it("keeps the terminal toggle once the terminal was hidden after showing", () => {
    render(
      <AgentSignInPanel
        connect={false}
        agentName="Cursor"
        view={{ guide: null, terminalVisible: false, started: true }}
        code=""
        codeSubmitted={false}
        alternate={null}
        terminal={null}
        onCodeChange={vi.fn()}
        onSubmitCode={vi.fn()}
        onOpenUrl={vi.fn()}
        onCopy={vi.fn()}
        onToggleTerminal={vi.fn()}
      />,
    );

    expect(screen.getByText("Show terminal")).toBeTruthy();
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
          started: true,
        }}
        code=""
        codeSubmitted={false}
        alternate={null}
        terminal={null}
        onCodeChange={vi.fn()}
        onSubmitCode={vi.fn()}
        onOpenUrl={vi.fn()}
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

  it("links the sign-in page when the browser sign-in line has no link", () => {
    const url = "https://auth.openai.com/oauth/authorize?state=abc";
    const onOpenUrl = vi.fn();
    const onCopy = vi.fn();
    const panel = (alternate: "browser" | "code" | null) => (
      <AgentSignInPanel
        connect={false}
        agentName="Codex"
        view={{
          guide: { url, userCode: null, acceptsPastedCode: false },
          terminalVisible: false,
          started: true,
        }}
        code=""
        codeSubmitted={false}
        alternate={alternate}
        terminal={null}
        onCodeChange={vi.fn()}
        onSubmitCode={vi.fn()}
        onOpenUrl={onOpenUrl}
        onCopy={onCopy}
        onToggleTerminal={vi.fn()}
      />
    );
    const { rerender } = render(panel("code"));

    const link = screen.getByRole("link", { name: "Open sign-in page" });
    expect(link.getAttribute("href")).toBe(url);
    fireEvent.click(link);
    expect(onOpenUrl).toHaveBeenCalledExactlyOnceWith(url);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(onCopy).toHaveBeenCalledExactlyOnceWith(url);

    rerender(panel(null));
    expect(
      screen.queryByRole("link", { name: "Open sign-in page" }),
    ).toBeNull();
  });

  it("links the sign-in page next to the paste box when signing in in the agent's terminal", () => {
    const url = "https://claude.ai/oauth/authorize?code=true&state=abc";
    const onOpenUrl = vi.fn();
    const onCopy = vi.fn();
    render(
      <AgentSignInPanel
        connect
        agentName="Pi"
        view={{
          guide: { url, userCode: null, acceptsPastedCode: true },
          terminalVisible: true,
          started: true,
        }}
        code=""
        codeSubmitted={false}
        alternate={null}
        terminal={null}
        onCodeChange={vi.fn()}
        onSubmitCode={vi.fn()}
        onOpenUrl={onOpenUrl}
        onCopy={onCopy}
        onToggleTerminal={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "Pi authorization code" }),
    ).toBeTruthy();
    const link = screen.getByRole("link", { name: "Open sign-in page" });
    expect(link.getAttribute("href")).toBe(url);
    fireEvent.click(link);
    expect(onOpenUrl).toHaveBeenCalledExactlyOnceWith(url);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(onCopy).toHaveBeenCalledExactlyOnceWith(url);
  });
});

function renderQuiet(agents: OnboardingAgent[]) {
  const handlers = {
    onSignIn: vi.fn(),
    onInstall: vi.fn(),
    onViewInstallLog: vi.fn(),
    onCancelSignIn: vi.fn(),
    onRecheck: vi.fn(),
  };
  const view = render(
    <TooltipProvider>
      <AgentStep quiet machineName="bee" agents={agents} {...handlers} />
    </TooltipProvider>,
  );
  return { ...view, handlers };
}

function rowOf(id: string): HTMLElement {
  const row = document.querySelector(`[data-agent-id="${id}"]`);
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${id}`);
  return row;
}

function hasSubtitle(id: string): boolean {
  const column = within(rowOf(id)).getByText(id).parentElement;
  return (column?.childElementCount ?? 0) > 1;
}

describe("AgentStep progress in the redesign", () => {
  it("drops subtitles the button already says and keeps informative ones", () => {
    renderQuiet([
      agent("claude-code", {
        status: "signIn",
        reason: "signedOut",
        canSignIn: true,
      }),
      {
        ...agent("pi", {
          status: "signIn",
          reason: "signedOut",
          canSignIn: true,
        }),
        setup: "connect",
      },
      agent("codex", { status: "install", canInstall: true }),
      agent("cursor", { status: "ready", detail: "me@example.com · Pro" }),
      agent("amp", { status: "update", detail: null, canInstall: true }),
    ]);

    expect(hasSubtitle("claude-code")).toBe(false);
    expect(hasSubtitle("pi")).toBe(false);
    expect(hasSubtitle("codex")).toBe(false);
    expect(hasSubtitle("cursor")).toBe(true);
    expect(hasSubtitle("amp")).toBe(true);
    within(
      document.querySelector<HTMLElement>('[data-agent-id="pi"]')!,
    ).getByRole("button", { name: "Sign in" });
    expect(screen.getByText("me@example.com · Pro")).toBeTruthy();
    expect(screen.getByText("Update needed")).toBeTruthy();
    expect(
      screen.queryByText(/not signed in|Not installed|no model/u),
    ).toBeNull();
  });

  it("shows Installing… in the same disabled button", () => {
    const { rerender } = renderQuiet([
      agent("codex", { status: "install", canInstall: true }),
    ]);
    screen.getByRole("button", { name: "Install" });

    rerender(
      <TooltipProvider>
        <AgentStep
          quiet
          machineName="bee"
          agents={[agent("codex", { status: "installing", update: false })]}
          onSignIn={vi.fn()}
          onInstall={vi.fn()}
          onViewInstallLog={vi.fn()}
          onCancelSignIn={vi.fn()}
          onRecheck={vi.fn()}
        />
      </TooltipProvider>,
    );
    const busy = screen.getByRole("button", { name: "Installing…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(busy.querySelector('[data-icon="Spinner"]')).not.toBeNull();
    expect(busy.textContent).toBe("Installing…");
  });

  it("shows Updating… while an update installs", () => {
    renderQuiet([agent("codex", { status: "installing", update: true })]);
    const busy = screen.getByRole("button", { name: "Updating…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows Starting… in the button until the sign-in instruction is ready", () => {
    const { rerender, handlers } = renderQuiet([
      {
        ...agent("claude-code", {
          status: "signIn",
          reason: "signedOut",
          canSignIn: true,
        }),
        busy: true,
      },
    ]);
    const starting = screen.getByRole("button", { name: "Starting…" });
    expect((starting as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(starting);
    expect(handlers.onSignIn).not.toHaveBeenCalled();

    rerender(
      <TooltipProvider>
        <AgentStep
          quiet
          machineName="bee"
          agents={[
            { ...agent("claude-code", { status: "signingIn" }), busy: true },
          ]}
          {...handlers}
        />
      </TooltipProvider>,
    );
    screen.getByRole("button", { name: "Starting…" });
    expect(
      screen.queryByRole("button", { name: /Cancel signing in/u }),
    ).toBeNull();
    expect(hasSubtitle("claude-code")).toBe(false);

    rerender(
      <TooltipProvider>
        <AgentStep
          quiet
          machineName="bee"
          agents={[
            {
              ...agent("claude-code", { status: "signingIn" }),
              subline: "Finish signing in on claude.ai.",
            },
          ]}
          {...handlers}
        />
      </TooltipProvider>,
    );
    screen.getByRole("button", { name: "Cancel signing in to claude-code" });
    expect(screen.queryByRole("button", { name: "Starting…" })).toBeNull();
    const subtitle = screen.getByText("Finish signing in on claude.ai.");
    expect(
      subtitle.closest("span.flex")?.querySelector('[data-icon="Spinner"]'),
    ).not.toBeNull();
  });

  it("keeps the control guide's subtitles", () => {
    renderAgents([
      agent("claude-code", {
        status: "signIn",
        reason: "signedOut",
        canSignIn: true,
      }),
      agent("pi", { status: "installing", update: false }),
    ]);
    expect(screen.getByText("Installed · not signed in")).toBeTruthy();
    expect(screen.getByText("Installing…")).toBeTruthy();
  });
});

describe("Agent step header and install details in the redesign", () => {
  it("shows the machine line without Check again", () => {
    renderQuiet([agent("codex", { status: "install", canInstall: true })]);
    expect(screen.getByText("On bee")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Check again/u })).toBeNull();
  });

  it("opens the install output from the details strip", () => {
    render(<AgentInstallErrorDetails log="npm ERR! code ECONNRESET" />);
    expect(screen.queryByText("npm ERR! code ECONNRESET")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show details/u }));
    expect(screen.getByText("npm ERR! code ECONNRESET")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Hide details/u }));
    expect(screen.queryByText("npm ERR! code ECONNRESET")).toBeNull();
  });

  it("shows the install output without terminal escape codes and wraps long lines", () => {
    render(
      <AgentInstallErrorDetails
        log={"\u001b[31mnpm error\u001b[39m code ECONNREFUSED\r\n"}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Show details/u }));
    const output = screen.getByText(/npm error code ECONNREFUSED/u);
    expect(output.textContent).toBe("npm error code ECONNREFUSED\n");
    expect(output.className).toContain("wrap-anywhere");
  });

  it("hides the old failure details while a retry waits", () => {
    const failed = {
      ...agent("codex", {
        status: "installFailed",
        message: "Couldn't install.",
        canInstall: true,
      }),
      installLog: "npm error code ECONNREFUSED",
    };
    const { rerender, handlers } = renderQuiet([failed]);
    within(rowOf("codex")).getByRole("button", { name: /Show details/u });

    rerender(
      <TooltipProvider>
        <AgentStep
          quiet
          machineName="bee"
          agents={[
            {
              ...failed,
              state: { status: "installing", update: false },
              installQueued: true,
            },
          ]}
          {...handlers}
        />
      </TooltipProvider>,
    );
    within(rowOf("codex")).getByRole("button", { name: "Waiting…" });
    expect(
      within(rowOf("codex")).queryByRole("button", { name: /Show details/u }),
    ).toBeNull();
  });
});

describe("Agent rows active at once in the redesign", () => {
  it("shows a queued install as Waiting… behind the running one", () => {
    renderQuiet([
      agent("pi", { status: "installing", update: false }),
      {
        ...agent("codex", { status: "installing", update: false }),
        installQueued: true,
      },
    ]);

    within(rowOf("pi")).getByRole("button", { name: "Installing…" });
    const waiting = within(rowOf("codex")).getByRole("button", {
      name: "Waiting…",
    });
    expect((waiting as HTMLButtonElement).disabled).toBe(true);
    expect(waiting.querySelector('[data-icon="Spinner"]')).not.toBeNull();
  });
});

describe("RedesignedDevicesStep", () => {
  it("hides the machine section until bb connect is on", () => {
    const props = {
      hostName: "bee",
      connectSection: <li>bb connect</li>,
      addMachinePanel: null,
      onAddMachine: vi.fn(),
      onCloseAddMachine: vi.fn(),
    };
    const { rerender } = render(
      <TooltipProvider>
        <RedesignedDevicesStep {...props} showMachines={false} />
      </TooltipProvider>,
    );
    expect(screen.queryByText("Where agents run")).toBeNull();
    expect(screen.queryByText("Add another machine")).toBeNull();
    expect(screen.getByText("Where you use bb").className).toContain("sr-only");

    rerender(
      <TooltipProvider>
        <RedesignedDevicesStep {...props} showMachines />
      </TooltipProvider>,
    );
    screen.getByText("Where agents run");
    expect(screen.getByText("Where you use bb").className).not.toContain(
      "sr-only",
    );
    fireEvent.click(screen.getByRole("button", { name: "Add a machine" }));
    expect(props.onAddMachine).toHaveBeenCalledOnce();
  });
});
