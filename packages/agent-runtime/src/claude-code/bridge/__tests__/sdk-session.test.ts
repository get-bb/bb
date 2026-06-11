import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

const mockQueryInstance = {
  close: vi.fn(),
  interrupt: vi.fn(),
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
  prompt: AsyncIterable<SDKUserMessage>;
}

function getLatestPrompt(): AsyncIterable<SDKUserMessage> {
  const latestCall = queryMock.mock.calls.at(-1)?.[0];
  if (
    latestCall === null ||
    typeof latestCall !== "object" ||
    !("prompt" in latestCall)
  ) {
    throw new Error("Expected Claude SDK prompt");
  }
  const call: ClaudeQueryPromptCall = latestCall;
  return call.prompt;
}

function keepSdkStreamOpen(): void {
  mockQueryInstance[Symbol.asyncIterator].mockReturnValue({
    next: vi.fn(() => new Promise<IteratorResult<SDKMessage>>(() => {})),
    return: vi.fn().mockResolvedValue({ value: undefined, done: true }),
  });
}

describe("SdkSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockImplementation(() => mockQueryInstance);
    // Make the query async iterable return immediately
    mockQueryInstance[Symbol.asyncIterator].mockReturnValue({
      next: vi.fn().mockResolvedValue({ value: undefined, done: true }),
      return: vi.fn().mockResolvedValue({ value: undefined, done: true }),
    });
  });

  it("starts with no session id", () => {
    const onMessage = vi.fn();
    const onDone = vi.fn();
    const session = new SdkSession(defaultOptions, onMessage, onDone);
    expect(session.getSessionId()).toBeUndefined();
    expect(session.getIsProcessing()).toBe(false);
  });

  it("pushInput queues messages before start", () => {
    const onMessage = vi.fn();
    const onDone = vi.fn();
    const session = new SdkSession(defaultOptions, onMessage, onDone);
    // Should not throw before start
    session.pushInput("hello");
  });

  it("resolves pushed input after the SDK prompt iterator yields it", async () => {
    keepSdkStreamOpen();
    const session = new SdkSession(defaultOptions, vi.fn(), vi.fn());

    session.start();
    const consumed = session.pushInput("hello");
    let consumedResolved = false;
    void consumed.then(() => {
      consumedResolved = true;
    });
    await Promise.resolve();

    expect(consumedResolved).toBe(false);
    const result = await getLatestPrompt()[Symbol.asyncIterator]().next();
    expect(result.done).toBe(false);
    expect(result.value?.message.content).toBe("hello");
    await consumed;
    expect(consumedResolved).toBe(true);
    session.stop();
  });

  it("rejects queued input when the SDK input stream closes before consumption", async () => {
    const session = new SdkSession(defaultOptions, vi.fn(), vi.fn());
    const consumed = session.pushInput("hello");

    session.stop();

    await expect(consumed).rejects.toThrow(
      "Claude SDK session stopped before input consumed",
    );
  });

  it("stop cleans up state", () => {
    const onMessage = vi.fn();
    const onDone = vi.fn();
    const session = new SdkSession(defaultOptions, onMessage, onDone);
    session.start();
    session.stop();
    expect(mockQueryInstance.close).toHaveBeenCalled();
    expect(session.getIsProcessing()).toBe(false);
  });

  it("waits for the SDK stream to finish during graceful close", async () => {
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
    const session = new SdkSession(defaultOptions, vi.fn(), vi.fn());

    session.start();
    const closePromise = session.closeGracefully(1_000);
    await Promise.resolve();

    expect(mockQueryInstance.close).not.toHaveBeenCalled();
    if (!finishStream) {
      throw new Error("Expected Claude SDK stream to be pending");
    }
    finishStream({ value: undefined, done: true });
    await closePromise;

    expect(mockQueryInstance.close).not.toHaveBeenCalled();
  });

  it("forwards restricted built-in tools to the SDK when configured", () => {
    const onMessage = vi.fn();
    const onDone = vi.fn();
    const session = new SdkSession(
      {
        ...defaultOptions,
        tools: ["Bash", "Read"],
      },
      onMessage,
      onDone,
    );

    session.start();

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          tools: ["Bash", "Read"],
        }),
      }),
    );
  });

  it("forwards local plugins to the SDK without a skills allowlist", () => {
    const onMessage = vi.fn();
    const onDone = vi.fn();
    const session = new SdkSession(
      {
        ...defaultOptions,
        plugins: [{ type: "local", path: "/tmp/bb-skills" }],
      },
      onMessage,
      onDone,
    );

    session.start();

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          plugins: [{ type: "local", path: "/tmp/bb-skills" }],
        }),
      }),
    );
    // The SDK `skills` option is an allowlist: setting it would hide every
    // skill the user installed outside bb (~/.claude, plugins, built-ins).
    expect(queryMock.mock.calls[0]?.[0]?.options).not.toHaveProperty("skills");
  });

  it("mirrors the Claude CLI settings cascade so user, project, and local settings all load", () => {
    const onMessage = vi.fn();
    const onDone = vi.fn();
    const session = new SdkSession(defaultOptions, onMessage, onDone);

    session.start();

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          settingSources: ["user", "project", "local"],
        }),
      }),
    );
  });

  it("forwards max reasoning effort and thinking display to the SDK when configured", () => {
    const onMessage = vi.fn();
    const onDone = vi.fn();
    const session = new SdkSession(
      {
        ...defaultOptions,
        effort: "max",
        thinking: {
          type: "adaptive",
          display: "summarized",
        },
      },
      onMessage,
      onDone,
    );

    session.start();

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          effort: "max",
          thinking: {
            type: "adaptive",
            display: "summarized",
          },
        }),
      }),
    );
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
        permissionMode: "dontAsk",
        disallowedTools: ["WebFetch"],
      },
      onMessage,
      onDone,
    );

    session.start();

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          permissionMode: "dontAsk",
          disallowedTools: ["WebFetch"],
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

  it("forwards sandbox and hooks to the SDK when configured", () => {
    const onMessage = vi.fn();
    const onDone = vi.fn();
    const hooks: NonNullable<SdkSessionOptions["hooks"]> = {
      PreToolUse: [{ hooks: [vi.fn()] }],
    };
    const session = new SdkSession(
      {
        ...defaultOptions,
        additionalDirectories: ["/repo/.git/worktrees/bb13"],
        sandbox: {
          enabled: true,
          autoAllowBashIfSandboxed: true,
          allowUnsandboxedCommands: false,
        },
        hooks,
      },
      onMessage,
      onDone,
    );

    session.start();

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          additionalDirectories: ["/repo/.git/worktrees/bb13"],
          sandbox: {
            enabled: true,
            autoAllowBashIfSandboxed: true,
            allowUnsandboxedCommands: false,
          },
          hooks,
        }),
      }),
    );
  });
});
