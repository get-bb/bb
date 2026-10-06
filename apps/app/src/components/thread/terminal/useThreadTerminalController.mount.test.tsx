// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { TerminalSession } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  useThreadTerminalController,
  type ThreadTerminalControllerArgs,
} from "./useThreadTerminalController";
import { makeTerminalSession } from "@/test/fixtures/terminal-sessions";

vi.mock("@/lib/sdk", () => ({
  sdk: { terminals: { list: vi.fn() } },
}));

const session: TerminalSession = makeTerminalSession({
  id: "term_1",
  threadId: "thr_1",
  environmentId: "env_1",
  hostId: "host_1",
  createdAt: 1,
  updatedAt: 1,
});

interface PanelVisibility {
  isPanelOpen: boolean;
  isPanelPersistedOpen: boolean;
}

function controllerArgs(
  visibility: PanelVisibility,
): ThreadTerminalControllerArgs {
  return {
    canCreateTerminal: true,
    isPanelOpen: visibility.isPanelOpen,
    isPanelPersistedOpen: visibility.isPanelPersistedOpen,
    syncThreadId: null,
    target: { kind: "thread", threadId: "thr_1" },
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useThreadTerminalController terminal view mounting", () => {
  it("does not mount a persisted-open terminal the panel never showed", () => {
    vi.mocked(sdk.terminals.list).mockResolvedValue({ sessions: [session] });
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useThreadTerminalController(
          controllerArgs({ isPanelOpen: false, isPanelPersistedOpen: true }),
        ),
      { wrapper },
    );

    expect(result.current.shouldMountTerminalView).toBe(false);
    expect(sdk.terminals.list).not.toHaveBeenCalled();
  });

  it("mounts the view for an open panel that is not persisted open", () => {
    vi.mocked(sdk.terminals.list).mockResolvedValue({ sessions: [session] });
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useThreadTerminalController(
          controllerArgs({ isPanelOpen: true, isPanelPersistedOpen: false }),
        ),
      { wrapper },
    );

    expect(result.current.shouldMountTerminalView).toBe(true);
  });

  it("keeps the view mounted across a compact close and unmounts once persisted state closes", async () => {
    vi.mocked(sdk.terminals.list).mockResolvedValue({ sessions: [session] });
    const { wrapper } = createQueryClientTestHarness();
    const { result, rerender } = renderHook(
      (visibility: PanelVisibility) =>
        useThreadTerminalController(controllerArgs(visibility)),
      {
        wrapper,
        initialProps: { isPanelOpen: true, isPanelPersistedOpen: true },
      },
    );

    await waitFor(() => {
      expect(result.current.activeSession?.id).toBe(session.id);
    });
    expect(result.current.shouldMountTerminalView).toBe(true);

    rerender({ isPanelOpen: false, isPanelPersistedOpen: true });
    expect(result.current.shouldMountTerminalView).toBe(true);
    expect(result.current.activeSession?.id).toBe(session.id);

    rerender({ isPanelOpen: false, isPanelPersistedOpen: false });
    expect(result.current.shouldMountTerminalView).toBe(false);

    rerender({ isPanelOpen: false, isPanelPersistedOpen: true });
    expect(result.current.shouldMountTerminalView).toBe(false);
    rerender({ isPanelOpen: true, isPanelPersistedOpen: true });
    expect(result.current.shouldMountTerminalView).toBe(true);
  });
});
