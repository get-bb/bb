import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Options,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

const mockQueryInstance = {
  applyFlagSettings: vi.fn(),
  close: vi.fn(),
  interrupt: vi.fn(),
  setModel: vi.fn(),
  setPermissionMode: vi.fn(),
  [Symbol.asyncIterator]: vi.fn(),
};
const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
}));

import { SdkSession, type SdkSessionOptions } from "../sdk-session.js";

const defaultOptions: SdkSessionOptions = {
  cwd: "/tmp/test",
  systemPrompt: "You are a test assistant.",
};

interface ClaudeQueryPromptCall {
  options: Options;
  prompt: AsyncIterable<SDKUserMessage>;
}

function isClaudeQueryPromptCall(
  value: unknown,
): value is ClaudeQueryPromptCall {
  return (
    value !== null &&
    typeof value === "object" &&
    "options" in value &&
    "prompt" in value
  );
}

function getLatestQueryCall(): ClaudeQueryPromptCall {
  const latestCall = queryMock.mock.calls.at(-1)?.[0];
  if (!isClaudeQueryPromptCall(latestCall)) {
    throw new Error("Expected Claude SDK query call");
  }
  return latestCall;
}

function getLatestPrompt(): AsyncIterable<SDKUserMessage> {
  return getLatestQueryCall().prompt;
}

function keepSdkStreamOpen(): void {
  mockQueryInstance[Symbol.asyncIterator].mockReturnValue({
    next: vi.fn(() => new Promise<IteratorResult<SDKMessage>>(() => {})),
    return: vi.fn().mockResolvedValue({ value: undefined, done: true }),
  });
}

function mockProcessUid(uid: number): void {
  vi.spyOn(process, "getuid").mockReturnValue(uid);
}

function waitForAsyncWork(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("SdkSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockImplementation(() => mockQueryInstance);
    mockQueryInstance.applyFlagSettings.mockResolvedValue(undefined);
    mockQueryInstance.interrupt.mockResolvedValue(undefined);
    mockQueryInstance.setModel.mockResolvedValue(undefined);
    mockQueryInstance.setPermissionMode.mockResolvedValue(undefined);
    mockQueryInstance[Symbol.asyncIterator].mockReturnValue({
      next: vi.fn().mockResolvedValue({ value: undefined, done: true }),
      return: vi.fn().mockResolvedValue({ value: undefined, done: true }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects queued input when the SDK input stream closes before consumption", async () => {
    const session = new SdkSession(defaultOptions, vi.fn(), vi.fn());
    const consumed = session.pushInput("hello");

    session.stop();
    expect(session.canPushInput()).toBe(false);

    await expect(consumed).rejects.toThrow(
      "Claude SDK session stopped before input consumed",
    );
  });

  it("interrupts the running turn before ending SDK input during graceful close", async () => {
    let finishStream:
      | ((result: IteratorResult<SDKMessage>) => void)
      | undefined;
    const next = vi.fn(
      () =>
        new Promise<IteratorResult<SDKMessage>>((resolve) => {
          finishStream = resolve;
        }),
    );
    mockQueryInstance[Symbol.asyncIterator].mockReturnValue({
      next,
      return: vi.fn().mockResolvedValue({ value: undefined, done: true }),
    });
    let finishInterrupt: (() => void) | undefined;
    mockQueryInstance.interrupt.mockReturnValue(
      new Promise<void>((resolve) => {
        finishInterrupt = resolve;
      }),
    );
    const session = new SdkSession(defaultOptions, vi.fn(), vi.fn());

    session.start();
    const pendingInput = getLatestPrompt()[Symbol.asyncIterator]().next();
    let inputResolved = false;
    void pendingInput.then(() => {
      inputResolved = true;
    });
    const closePromise = session.closeGracefully(1_000);
    await waitForAsyncWork();

    expect(mockQueryInstance.interrupt).toHaveBeenCalledOnce();
    expect(inputResolved).toBe(false);
    if (!finishInterrupt) {
      throw new Error("Expected Claude SDK interrupt to be pending");
    }
    finishInterrupt();
    await expect(pendingInput).resolves.toEqual({
      value: undefined,
      done: true,
    });
    if (!finishStream) {
      throw new Error("Expected Claude SDK stream to be pending");
    }
    finishStream({ value: undefined, done: true });
    await closePromise;
    expect(mockQueryInstance.close).not.toHaveBeenCalled();
  });

  it("force-stops the session when the interrupt request fails during graceful close", async () => {
    keepSdkStreamOpen();
    mockQueryInstance.interrupt.mockRejectedValue(
      new Error("Claude CLI transport closed"),
    );
    const session = new SdkSession(defaultOptions, vi.fn(), vi.fn());

    session.start();
    await session.closeGracefully(60_000);
    expect(mockQueryInstance.close).toHaveBeenCalledOnce();
  });

  it("forwards an explicit Claude Code executable path to the SDK", () => {
    const onMessage = vi.fn();
    const onDone = vi.fn();
    const session = new SdkSession(
      {
        ...defaultOptions,
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
      },
      onMessage,
      onDone,
    );

    session.start();

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          pathToClaudeCodeExecutable: "/usr/local/bin/claude",
        }),
      }),
    );
  });

  it("passes non-bypass permission modes through without the dangerous skip flag", () => {
    const onMessage = vi.fn();
    const onDone = vi.fn();
    const session = new SdkSession(
      {
        ...defaultOptions,
        permissionMode: "acceptEdits",
      },
      onMessage,
      onDone,
    );

    session.start();

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          permissionMode: "acceptEdits",
        }),
      }),
    );
    expect(queryMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          allowDangerouslySkipPermissions: true,
        }),
      }),
    );
  });

  it("only enables dangerous permission skipping for bypass mode", () => {
    if (process.platform !== "win32") mockProcessUid(1000);
    const onMessage = vi.fn();
    const onDone = vi.fn();
    const session = new SdkSession(
      {
        ...defaultOptions,
        permissionMode: "bypassPermissions",
      },
      onMessage,
      onDone,
    );

    session.start();

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
        }),
      }),
    );
  });

  it("does not send root-forbidden bypass flags when running as root", ({
    skip,
  }) => {
    skip(process.platform === "win32", "Windows has no root uid");
    mockProcessUid(0);
    const onMessage = vi.fn();
    const onDone = vi.fn();
    const session = new SdkSession(
      {
        ...defaultOptions,
        permissionMode: "bypassPermissions",
      },
      onMessage,
      onDone,
    );

    session.start();

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          permissionMode: "default",
        }),
      }),
    );
    expect(queryMock.mock.calls[0]?.[0]?.options).not.toHaveProperty(
      "allowDangerouslySkipPermissions",
    );
  });
});
