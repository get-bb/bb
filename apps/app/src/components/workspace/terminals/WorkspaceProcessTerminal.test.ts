// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findLatestLoopbackPreviewUrl,
  formatLoopbackPreviewLabel,
  getWorkspaceScriptConfigurationAction,
  getWorkspaceProcessAction,
  WorkspaceProcessTerminal,
} from "./WorkspaceProcessTerminal";

const { useThreadTerminalControllerMock } = vi.hoisted(() => ({
  useThreadTerminalControllerMock: vi.fn((_args: unknown) => ({
    activeSession: null,
    canCreateTerminal: false,
    handleCreateTerminal: vi.fn(),
    isCreateTerminalPending: false,
  })),
}));

vi.mock(
  "@/components/thread/terminal/useThreadTerminalController",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/components/thread/terminal/useThreadTerminalController")
      >();
    return {
      ...actual,
      useThreadTerminalController: useThreadTerminalControllerMock,
    };
  },
);

vi.mock("../ThreadWorkspaceShell", () => ({
  useWorkspaceTerminalToolbarHost: () => null,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("findLatestLoopbackPreviewUrl", () => {
  it("returns the latest ANSI-wrapped loopback URL", () => {
    expect(
      findLatestLoopbackPreviewUrl(
        "Local: http://localhost:3000\n\u001b[32mhttp://127.0.0.1:4173/app\u001b[0m",
      ),
    ).toBe("http://127.0.0.1:4173/app");
  });

  it("rejects public and non-HTTP URLs", () => {
    expect(
      findLatestLoopbackPreviewUrl("https://example.com ftp://localhost:21"),
    ).toBeNull();
  });

  it("accepts the complete IPv4 loopback range", () => {
    expect(findLatestLoopbackPreviewUrl("http://127.0.0.2:4173")).toBe(
      "http://127.0.0.2:4173/",
    );
  });
});

describe("workspace process actions", () => {
  it("shows Start only when the current terminal can start", () => {
    expect(
      getWorkspaceProcessAction({
        canCreateTerminal: true,
        isCreateTerminalPending: false,
        previewUrl: null,
        purpose: "setup",
        sessionStatus: null,
      }),
    ).toEqual({ kind: "start" });

    expect(
      getWorkspaceProcessAction({
        canCreateTerminal: false,
        isCreateTerminalPending: false,
        previewUrl: null,
        purpose: "setup",
        sessionStatus: null,
      }),
    ).toEqual({ kind: "none" });
  });

  it("replaces the Run action with the detected port and never returns Stop", () => {
    const previewUrl = "http://localhost:4173/app";
    expect(formatLoopbackPreviewLabel(previewUrl)).toBe("Open :4173");
    expect(
      getWorkspaceProcessAction({
        canCreateTerminal: true,
        isCreateTerminalPending: false,
        previewUrl,
        purpose: "run",
        sessionStatus: "running",
      }),
    ).toEqual({ kind: "open", label: "Open :4173", url: previewUrl });
    expect(
      getWorkspaceProcessAction({
        canCreateTerminal: true,
        isCreateTerminalPending: false,
        previewUrl: null,
        purpose: "run",
        sessionStatus: "running",
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("workspace script configuration actions", () => {
  it("links a missing Setup script to the current project setting", () => {
    expect(
      getWorkspaceScriptConfigurationAction({
        command: null,
        projectId: "project-one",
        purpose: "setup",
      }),
    ).toEqual({
      href: "/projects/project-one/settings#project-setup-script",
      label: "Add Setup Script",
    });
  });

  it("links a missing Run script to the current project setting", () => {
    expect(
      getWorkspaceScriptConfigurationAction({
        command: null,
        projectId: "project-one",
        purpose: "run",
      }),
    ).toEqual({
      href: "/projects/project-one/settings#project-run-script",
      label: "Add Run Script",
    });
  });

  it("does not offer configuration when a script exists, is unresolved, or for a shell", () => {
    expect(
      getWorkspaceScriptConfigurationAction({
        command: "pnpm install",
        projectId: "project-one",
        purpose: "setup",
      }),
    ).toBeNull();
    expect(
      getWorkspaceScriptConfigurationAction({
        command: undefined,
        projectId: "project-one",
        purpose: "run",
      }),
    ).toBeNull();
    expect(
      getWorkspaceScriptConfigurationAction({
        command: null,
        projectId: "project-one",
        purpose: "shell",
      }),
    ).toBeNull();
  });

  it.each([
    {
      expectedHref: "/projects/project-one/settings#project-setup-script",
      expectedLabel: "Add Setup Script",
      purpose: "setup" as const,
    },
    {
      expectedHref: "/projects/project-one/settings#project-run-script",
      expectedLabel: "Add Run Script",
      purpose: "run" as const,
    },
  ])(
    "renders the $expectedLabel project-settings link",
    ({ expectedHref, expectedLabel, purpose }) => {
      render(
        createElement(
          MemoryRouter,
          null,
          createElement(WorkspaceProcessTerminal, {
            canCreateTerminal: true,
            command: null,
            environmentId: "environment-one",
            onOpenPreview: vi.fn(),
            projectId: "project-one",
            purpose,
          }),
        ),
      );

      expect(
        screen.getByRole("link", { name: expectedLabel }).getAttribute("href"),
      ).toBe(expectedHref);
    },
  );

  it("keeps unresolved script settings neutral and disables command creation", () => {
    render(
      createElement(
        MemoryRouter,
        null,
        createElement(WorkspaceProcessTerminal, {
          canCreateTerminal: true,
          command: undefined,
          environmentId: "environment-one",
          onOpenPreview: vi.fn(),
          projectId: "project-one",
          purpose: "run",
        }),
      ),
    );

    expect(
      screen.getByText("Workspace script settings are unavailable."),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Add .* Script/u })).toBeNull();
    const controllerArgs = useThreadTerminalControllerMock.mock.lastCall?.[0];
    expect(controllerArgs).toEqual(
      expect.objectContaining({ canCreateTerminal: false }),
    );
    expect(controllerArgs).not.toHaveProperty("start");
  });

  it.each([
    { command: "pnpm install", purpose: "setup" as const },
    { command: "pnpm dev", purpose: "run" as const },
    { command: null, purpose: "shell" as const },
  ])(
    "does not show Add Script links for $purpose terminals with existing behaviour",
    ({ command, purpose }) => {
      render(
        createElement(
          MemoryRouter,
          null,
          createElement(WorkspaceProcessTerminal, {
            canCreateTerminal: true,
            command,
            environmentId: "environment-one",
            onOpenPreview: vi.fn(),
            projectId: "project-one",
            purpose,
          }),
        ),
      );

      expect(
        screen.queryByRole("link", { name: "Add Setup Script" }),
      ).toBeNull();
      expect(screen.queryByRole("link", { name: "Add Run Script" })).toBeNull();
    },
  );
});
