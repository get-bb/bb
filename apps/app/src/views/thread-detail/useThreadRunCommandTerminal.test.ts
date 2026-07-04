// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProjectRunCommandTargetState,
  TerminalSession,
} from "@bb/server-contract";
import type { ProjectRunCommandInfo } from "@/hooks/queries/sidebar-navigation-query";

const runCommandInfo = vi.hoisted(() => ({
  current: { runCommand: null, states: [] } as ProjectRunCommandInfo,
}));
const environmentSessions = vi.hoisted(() => ({
  current: undefined as { sessions: readonly TerminalSession[] } | undefined,
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useProjectRunCommand: () => runCommandInfo.current,
}));
vi.mock("@/hooks/mutations/project-mutations", () => ({
  useStartProjectRunCommand: () => ({ mutate: vi.fn(), isPending: false }),
  useStopProjectRunCommand: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/queries/thread-terminal-queries", () => ({
  useEnvironmentTerminals: () => ({ data: environmentSessions.current }),
  useTerminals: () => ({ data: undefined }),
}));

import { useThreadRunCommandTerminal } from "./useThreadRunCommandTerminal";

const envRunState: ProjectRunCommandTargetState = {
  target: { kind: "environment", environmentId: "env_1" },
  status: "running",
  terminalSessionId: "term_run",
  terminalTarget: { kind: "environment", environmentId: "env_1" },
  updatedAt: 1,
};

afterEach(() => {
  runCommandInfo.current = { runCommand: null, states: [] };
  environmentSessions.current = undefined;
});

describe("useThreadRunCommandTerminal", () => {
  it("resolves a worktree thread to its environment run and shows the Run tab", () => {
    runCommandInfo.current = { runCommand: "pnpm dev", states: [envRunState] };
    const { result } = renderHook(() =>
      useThreadRunCommandTerminal({
        projectId: "proj_1",
        environmentId: "env_1",
        isWorktreeEnvironment: true,
        isEnvironmentResolved: true,
        runTerminalEnabled: false,
      }),
    );
    expect(result.current.showRunTab).toBe(true);
    expect(result.current.runActive).toBe(true);
  });

  it("hides the Run tab while a thread's environment is still resolving", () => {
    runCommandInfo.current = { runCommand: "pnpm dev", states: [envRunState] };
    const { result } = renderHook(() =>
      useThreadRunCommandTerminal({
        projectId: "proj_1",
        environmentId: "env_1",
        isWorktreeEnvironment: false,
        isEnvironmentResolved: false,
        runTerminalEnabled: false,
      }),
    );
    expect(result.current.showRunTab).toBe(false);
  });

  it("loads the run session by id when the terminal is enabled", () => {
    runCommandInfo.current = { runCommand: "pnpm dev", states: [envRunState] };
    environmentSessions.current = {
      sessions: [{ id: "term_run", title: "Run" } as TerminalSession],
    };
    const { result } = renderHook(() =>
      useThreadRunCommandTerminal({
        projectId: "proj_1",
        environmentId: "env_1",
        isWorktreeEnvironment: true,
        isEnvironmentResolved: true,
        runTerminalEnabled: true,
      }),
    );
    expect(result.current.runSession?.id).toBe("term_run");
  });
});
