// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutomationExecutionOptionsResponse } from "bb-plugin-automations/rpc-types";

const { rpc, rpcCall } = vi.hoisted(() => {
  const call = vi.fn();
  return { rpc: { call }, rpcCall: call };
});

vi.mock("@get-bb/plugin-sdk/app", () => ({
  definePluginApp: vi.fn((setup) => ({ setup })),
  useBbNavigate: vi.fn(),
  useRealtime: vi.fn(),
  useRpc: () => rpc,
}));

import { useAutomationExecutionOptions } from "../app.js";

afterEach(() => {
  cleanup();
  rpcCall.mockReset();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("automation execution option loading", () => {
  it("replaces a pending request after editing closes and reopens", async () => {
    const first = deferred<AutomationExecutionOptionsResponse>();
    const replacement = deferred<AutomationExecutionOptionsResponse>();
    rpcCall
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(replacement.promise);

    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useAutomationExecutionOptions(
          { projectId: "proj_test", automationId: "auto_test" },
          enabled,
          "codex:project-default",
        ),
      { initialProps: { enabled: true } },
    );

    await waitFor(() => expect(rpcCall).toHaveBeenCalledTimes(1));
    rerender({ enabled: false });
    rerender({ enabled: true });
    await waitFor(() => expect(rpcCall).toHaveBeenCalledTimes(2));

    await act(async () => {
      first.resolve({
        models: [{ id: "stale", model: "stale", displayName: "Stale" }],
        permissionModes: ["auto"],
      });
      await first.promise;
    });
    expect(result.current.options).toBeNull();

    await act(async () => {
      replacement.resolve({
        models: [{ id: "fresh", model: "fresh", displayName: "Fresh" }],
        permissionModes: ["auto"],
      });
      await replacement.promise;
    });
    expect(result.current.options?.models[0]?.id).toBe("fresh");
  });
});
