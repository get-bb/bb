import { expect, it, vi } from "vitest";
import { CodexAppServerRpcError } from "./app-server-connection.js";
import { resumeWithProviderMigration } from "./provider-migration.js";

it.each([
  ["openai", "bb-account-pool"],
  ["bb-account-pool", "openai"],
])(
  "forks the full existing history from %s into %s",
  async (source, target) => {
    const error = new CodexAppServerRpcError("provider mismatch", -32600, {
      type: "modelProviderMismatch",
      modelProvider: source,
      currentModelProvider: target,
    });
    const migrated = { thread: { id: "continued-history" } };
    const request = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(migrated);
    const params = {
      threadId: "original-history",
      cwd: "/workspace",
      excludeTurns: true,
      config: { permissions: "preserved" },
    };
    expect(
      await resumeWithProviderMigration({
        method: "thread/resume",
        params,
        request,
        currentProvider: async () => "openai",
      }),
    ).toBe(migrated);
    expect(request.mock.calls).toEqual([
      ["thread/resume", params],
      [
        "thread/fork",
        { ...params, modelProvider: target, deferGoalContinuation: true },
      ],
    ]);
  },
);

it.each([
  [
    "thread/start",
    {
      type: "modelProviderMismatch",
      modelProvider: "openai",
      currentModelProvider: "bb-account-pool",
    },
  ],
  [
    "thread/resume",
    {
      type: "modelProviderMismatch",
      modelProvider: "other-provider",
      currentModelProvider: "bb-account-pool",
    },
  ],
  [
    "thread/resume",
    {
      type: "modelProviderMismatch",
      modelProvider: "openai",
      currentModelProvider: "openai",
    },
  ],
  ["thread/resume", undefined],
])(
  "preserves failures without copying unrelated sessions (%s)",
  async (method, data) => {
    const error = new CodexAppServerRpcError("cannot resume", -32600, data);
    const request = vi.fn().mockRejectedValue(error);
    await expect(
      resumeWithProviderMigration({
        method,
        params: { threadId: "original" },
        request,
        currentProvider: async () => "openai",
      }),
    ).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
  },
);

it("returns a failed migration without starting an empty session", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(
      new CodexAppServerRpcError("mismatch", -32600, {
        type: "modelProviderMismatch",
        modelProvider: "openai",
        currentModelProvider: "bb-account-pool",
      }),
    )
    .mockRejectedValueOnce(new Error("fork unavailable"));
  await expect(
    resumeWithProviderMigration({
      method: "thread/resume",
      params: { threadId: "original" },
      request,
      currentProvider: async () => "openai",
    }),
  ).rejects.toThrow("fork unavailable");
  expect(request).toHaveBeenCalledTimes(2);
});

it("preserves pool history when direct login no longer configures the pool", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(
      new CodexAppServerRpcError("no longer configured", -32600, {
        type: "modelProviderNotConfigured",
        modelProvider: "bb-account-pool",
      }),
    )
    .mockResolvedValueOnce({ thread: { id: "direct-copy" } });
  const currentProvider = vi.fn().mockResolvedValue("openai");
  await resumeWithProviderMigration({
    method: "thread/resume",
    params: { threadId: "pool-history" },
    request,
    currentProvider,
  });
  expect(currentProvider).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenLastCalledWith("thread/fork", {
    threadId: "pool-history",
    modelProvider: "openai",
    deferGoalContinuation: true,
  });
});

it("does not migrate a missing pool to a different custom provider", async () => {
  const error = new CodexAppServerRpcError("no longer configured", -32600, {
    type: "modelProviderNotConfigured",
    modelProvider: "bb-account-pool",
  });
  const request = vi.fn().mockRejectedValue(error);
  await expect(
    resumeWithProviderMigration({
      method: "thread/resume",
      params: { threadId: "pool-history" },
      request,
      currentProvider: async () => "custom",
    }),
  ).rejects.toBe(error);
  expect(request).toHaveBeenCalledTimes(1);
});

it("preserves non-RPC failures without attempting migration", async () => {
  const error = new Error("connection lost");
  const request = vi.fn().mockRejectedValue(error);
  const currentProvider = vi.fn();
  await expect(
    resumeWithProviderMigration({
      method: "thread/resume",
      params: { threadId: "original" },
      request,
      currentProvider,
    }),
  ).rejects.toBe(error);
  expect(request).toHaveBeenCalledTimes(1);
  expect(currentProvider).not.toHaveBeenCalled();
});

it("propagates a failed effective-config read without forking", async () => {
  const error = new Error("config read failed");
  const request = vi.fn().mockRejectedValue(
    new CodexAppServerRpcError("missing pool", -32600, {
      type: "modelProviderNotConfigured",
      modelProvider: "bb-account-pool",
    }),
  );
  await expect(
    resumeWithProviderMigration({
      method: "thread/resume",
      params: { threadId: "original" },
      request,
      currentProvider: async () => {
        throw error;
      },
    }),
  ).rejects.toBe(error);
  expect(request).toHaveBeenCalledTimes(1);
});

it("returns a successful resume without inspecting provider configuration", async () => {
  const result = { thread: { id: "original" } };
  const request = vi.fn().mockResolvedValue(result);
  const currentProvider = vi.fn();
  await expect(
    resumeWithProviderMigration({
      method: "thread/resume",
      params: { threadId: "original" },
      request,
      currentProvider,
    }),
  ).resolves.toBe(result);
  expect(request).toHaveBeenCalledTimes(1);
  expect(currentProvider).not.toHaveBeenCalled();
});
