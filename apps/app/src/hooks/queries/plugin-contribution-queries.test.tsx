// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { SystemConfigResponse } from "@bb/server-contract";
import { defaultAppTheme, defaultExperiments } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  runPluginThreadAction,
  usePluginContributions,
} from "./plugin-contribution-queries";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getSystemConfig: vi.fn(),
  };
});

function systemConfig(pluginsEnabled: boolean): SystemConfigResponse {
  return {
    experiments: { ...defaultExperiments, plugins: pluginsEnabled },
    appearance: defaultAppTheme,
    customThemes: [],
    featureFlags: { placeholder: false },
    hostDaemonPort: null,
    voiceTranscriptionEnabled: false,
    dataDir: "/tmp/bb-test",
  };
}

function mockFetchJsonOnce(body: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("usePluginContributions", () => {
  it("fetches contributions and drops malformed entries once the plugins experiment is on", async () => {
    vi.mocked(api.getSystemConfig).mockResolvedValue(systemConfig(true));
    const fetchMock = mockFetchJsonOnce({
      cliCommands: [],
      threadActions: [
        {
          pluginId: "linear",
          id: "run-tests",
          title: "Run tests",
          icon: "beaker",
          confirm: null,
        },
        { pluginId: "broken" }, // malformed: dropped at the boundary
        {
          pluginId: "linear",
          id: "sync",
          title: "Sync issues",
          icon: null,
          confirm: "Sync now?",
        },
      ],
      mentionProviders: [
        { pluginId: "linear", id: "issues", label: "Linear issues" },
        { pluginId: "broken" }, // malformed: dropped at the boundary
      ],
    });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => usePluginContributions(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual({
        threadActions: [
          {
            pluginId: "linear",
            id: "run-tests",
            title: "Run tests",
            icon: "beaker",
            confirm: null,
          },
          {
            pluginId: "linear",
            id: "sync",
            title: "Sync issues",
            icon: null,
            confirm: "Sync now?",
          },
        ],
        mentionProviders: [
          { pluginId: "linear", id: "issues", label: "Linear issues" },
        ],
      });
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/plugins/contributions",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("does not fetch while the plugins experiment is off", async () => {
    vi.mocked(api.getSystemConfig).mockResolvedValue(systemConfig(false));
    const fetchMock = mockFetchJsonOnce({ cliCommands: [], threadActions: [] });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => usePluginContributions(), { wrapper });

    // Give the system-config query time to settle; the contributions query
    // must stay disabled the whole way.
    await waitFor(() => {
      expect(api.getSystemConfig).toHaveBeenCalled();
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shapes a failed contributions request as empty rather than an error", async () => {
    vi.mocked(api.getSystemConfig).mockResolvedValue(systemConfig(true));
    mockFetchJsonOnce({ ok: false }, { status: 503 });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => usePluginContributions(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual({
        threadActions: [],
        mentionProviders: [],
      });
    });
  });
});

describe("runPluginThreadAction", () => {
  it("resolves with the returned toast on success", async () => {
    const fetchMock = mockFetchJsonOnce({
      ok: true,
      toast: { kind: "success", message: "Tests requested" },
    });

    await expect(
      runPluginThreadAction({
        pluginId: "linear",
        actionId: "run-tests",
        threadId: "thr_1",
      }),
    ).resolves.toEqual({ kind: "success", message: "Tests requested" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/plugins/linear/actions/run-tests",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: "thr_1" }),
      }),
    );
  });

  it("resolves with null when the action returns no toast", async () => {
    mockFetchJsonOnce({ ok: true });
    await expect(
      runPluginThreadAction({
        pluginId: "linear",
        actionId: "quiet",
        threadId: "thr_1",
      }),
    ).resolves.toBeNull();
  });

  it("throws the server's error message for handler failures", async () => {
    mockFetchJsonOnce({ ok: false, error: "action boom" }, { status: 500 });
    await expect(
      runPluginThreadAction({
        pluginId: "linear",
        actionId: "boom",
        threadId: "thr_1",
      }),
    ).rejects.toThrow("action boom");
  });
});
