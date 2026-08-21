import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  getJsonRpcStringParam,
  JsonRpcResponseError,
  type PendingJsonRpcRequest,
  parseJsonRpcLine,
  ProviderRequestDecodeError,
  ProviderResponseEncodeError,
  sendJsonRpc,
  sendJsonRpcError,
  sendJsonRpcRequest,
  sendJsonRpcResult,
  sendProviderRequestDecodeErrorIfKnown,
  sendProviderResponseEncodeErrorIfKnown,
  settleJsonRpcResponse,
  toJsonRpcMessage,
} from "./runtime-json-rpc.js";

const EPIPE_PAYLOAD_SIZE = 1024 * 1024;

type ChildStdoutChunk = Buffer | string;

function readChildStdout(child: ChildProcess): Promise<string> {
  if (!child.stdout) {
    throw new Error("Expected child stdout to be readable");
  }
  const stdout = child.stdout;
  return new Promise((resolve) => {
    stdout.once("data", (chunk: ChildStdoutChunk) => {
      resolve(String(chunk));
    });
  });
}

function waitForChildExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
  });
}

function readChildStdoutLines(
  child: ChildProcess,
  expectedCount: number,
): Promise<string[]> {
  if (!child.stdout) {
    throw new Error("Expected child stdout to be readable");
  }
  const stdout = child.stdout;
  return new Promise((resolve, reject) => {
    let buffered = "";
    const onData = (chunk: ChildStdoutChunk) => {
      buffered += String(chunk);
      const lines = buffered.split("\n");
      if (lines.length <= expectedCount) return;
      cleanup();
      resolve(lines.slice(0, expectedCount));
    };
    const onExit = () => {
      cleanup();
      reject(new Error("Child exited before emitting the expected JSON lines"));
    };
    const cleanup = () => {
      stdout.off("data", onData);
      child.off("exit", onExit);
    };
    stdout.on("data", onData);
    child.once("exit", onExit);
  });
}

function spawnEchoChild(): ChildProcess {
  return spawn(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], {
    stdio: ["pipe", "pipe", "ignore"],
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
  await waitForChildExit(child);
}

describe("runtime JSON-RPC parsing", () => {
  it("classifies responses, requests, notifications, and malformed lines", () => {
    expect(parseJsonRpcLine("not json")).toEqual({ kind: "non_json" });
    expect(parseJsonRpcLine("null")).toEqual({ kind: "invalid_json_rpc" });
    expect(parseJsonRpcLine("[]")).toEqual({ kind: "invalid_json_rpc" });
    expect(parseJsonRpcLine('{"jsonrpc":"2.0","id":7,"result":true}')).toEqual({
      kind: "response",
      parsed: { jsonrpc: "2.0", id: 7, result: true },
      parsedId: 7,
    });
    expect(
      parseJsonRpcLine(
        '{"jsonrpc":"2.0","id":"req-1","method":"tool","params":{"x":1}}',
      ),
    ).toEqual({
      kind: "request",
      parsedId: "req-1",
      parsedMethod: "tool",
      rawRequest: {
        jsonrpc: "2.0",
        id: "req-1",
        method: "tool",
        params: { x: 1 },
      },
    });
    expect(
      parseJsonRpcLine('{"jsonrpc":"2.0","method":"progress","params":null}'),
    ).toEqual({
      kind: "notification",
      notificationMethod: "progress",
      parsed: { jsonrpc: "2.0", method: "progress", params: null },
    });
    expect(parseJsonRpcLine('{"jsonrpc":"2.0","id":false}')).toEqual({
      kind: "invalid_json_rpc",
    });
  });

  it("reads string params without coercing other values", () => {
    expect(
      getJsonRpcStringParam({ params: { cwd: "/tmp/project" } }, "cwd"),
    ).toBe("/tmp/project");
    expect(
      getJsonRpcStringParam({ params: { cwd: 42 } }, "cwd"),
    ).toBeUndefined();
    expect(getJsonRpcStringParam({ params: null }, "cwd")).toBeUndefined();
  });

  it("preserves JSON-RPC messages and converts provider command plans", () => {
    const rpcMessage = {
      jsonrpc: "2.0" as const,
      id: 4,
      method: "already-rpc",
    };
    expect(toJsonRpcMessage(rpcMessage)).toBe(rpcMessage);
    expect(
      toJsonRpcMessage({
        kind: "request",
        method: "provider-command",
        params: { enabled: true },
      }),
    ).toEqual({
      jsonrpc: "2.0",
      method: "provider-command",
      params: { enabled: true },
    });
    expect(toJsonRpcMessage({ kind: "request", method: "no-params" })).toEqual({
      jsonrpc: "2.0",
      method: "no-params",
    });
  });
});

describe("runtime JSON-RPC response settlement", () => {
  it("settles a matching response exactly once and ignores unknown ids", () => {
    const resolve = vi.fn();
    const reject = vi.fn();
    const pending = new Map<string | number, PendingJsonRpcRequest>([
      [7, { resolve, reject }],
    ]);

    settleJsonRpcResponse({ id: 7, pending, response: { result: "ok" } });
    settleJsonRpcResponse({ id: 7, pending, response: { result: "late" } });

    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith("ok");
    expect(reject).not.toHaveBeenCalled();
    expect(pending.size).toBe(0);
  });

  it("preserves structured provider error codes", () => {
    const resolve = vi.fn();
    const reject = vi.fn();
    const pending = new Map<string | number, PendingJsonRpcRequest>([
      ["request", { resolve, reject }],
    ]);

    settleJsonRpcResponse({
      id: "request",
      pending,
      response: { error: { code: -32042, message: "provider failed" } },
    });

    expect(resolve).not.toHaveBeenCalled();
    expect(reject).toHaveBeenCalledOnce();
    const error = reject.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(JsonRpcResponseError);
    expect(error).toMatchObject({ code: -32042, message: "provider failed" });
  });
});

describe("runtime JSON-RPC transport", () => {
  it("does not surface closed provider stdin errors as unhandled process errors", async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        "process.stdin.destroy(); process.stdout.write('stdin-closed\\n'); setTimeout(() => process.exit(0), 1000);",
      ],
      { stdio: ["pipe", "pipe", "ignore"] },
    );

    try {
      await readChildStdout(child);
      sendJsonRpcResult({
        child,
        id: 1,
        result: { payload: "x".repeat(EPIPE_PAYLOAD_SIZE) },
      });
      await delay(50);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      await waitForChildExit(child);
    }
  });

  it("serializes requests and validates their settled results", async () => {
    const child = spawnEchoChild();
    const linesPromise = readChildStdoutLines(child, 2);
    const pending = new Map<string | number, PendingJsonRpcRequest>();
    try {
      let nextId = 10;
      const accepted = sendJsonRpcRequest({
        child,
        getNextId: () => nextId++,
        message: {
          kind: "request",
          method: "read",
          params: { path: "/tmp/file" },
        },
        pending,
        resultSchema: z.object({ contents: z.string() }),
      });
      const rejected = sendJsonRpcRequest({
        child,
        getNextId: () => nextId++,
        message: { kind: "request", method: "stat" },
        pending,
        resultSchema: z.object({ size: z.number() }),
      });

      const lines = (await linesPromise).map((line) => JSON.parse(line));
      expect(lines).toEqual([
        {
          jsonrpc: "2.0",
          id: 10,
          method: "read",
          params: { path: "/tmp/file" },
        },
        { jsonrpc: "2.0", id: 11, method: "stat" },
      ]);

      settleJsonRpcResponse({
        id: 10,
        pending,
        response: { result: { contents: "hello" } },
      });
      settleJsonRpcResponse({
        id: 11,
        pending,
        response: { result: { size: "not-a-number" } },
      });

      await expect(accepted).resolves.toEqual({ contents: "hello" });
      await expect(rejected).rejects.toThrow(
        "Invalid JSON-RPC result for stat",
      );
      expect(pending.size).toBe(0);
    } finally {
      await stopChild(child);
    }
  });

  it("removes timed-out requests from the pending map", async () => {
    const child = spawnEchoChild();
    const pending = new Map<string | number, PendingJsonRpcRequest>();
    try {
      const result = sendJsonRpcRequest({
        child,
        getNextId: () => 12,
        message: { kind: "request", method: "never-answers" },
        pending,
        resultSchema: z.unknown(),
        timeoutMs: 10,
      });

      await expect(result).rejects.toThrow(
        "JSON-RPC request timed out: never-answers",
      );
      expect(pending.size).toBe(0);
    } finally {
      await stopChild(child);
    }
  });

  it("encodes protocol errors and only handles known boundary errors", async () => {
    const child = spawnEchoChild();
    const linesPromise = readChildStdoutLines(child, 3);
    try {
      sendJsonRpcError({
        child,
        id: 1,
        code: -32001,
        message: "explicit failure",
      });
      expect(
        sendProviderRequestDecodeErrorIfKnown({
          child,
          id: 2,
          error: new ProviderRequestDecodeError("bad request"),
        }),
      ).toBe(true);
      expect(
        sendProviderResponseEncodeErrorIfKnown({
          child,
          id: 3,
          error: new ProviderResponseEncodeError("bad response"),
        }),
      ).toBe(true);
      expect(
        sendProviderRequestDecodeErrorIfKnown({
          child,
          id: 4,
          error: new Error("unrelated"),
        }),
      ).toBe(false);

      const lines = (await linesPromise).map((line) => JSON.parse(line));
      expect(lines).toEqual([
        {
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32001, message: "explicit failure" },
        },
        {
          jsonrpc: "2.0",
          id: 2,
          error: { code: -32602, message: "bad request" },
        },
        {
          jsonrpc: "2.0",
          id: 3,
          error: { code: -32602, message: "bad response" },
        },
      ]);
    } finally {
      await stopChild(child);
    }
  });

  it("writes notifications without inventing request ids", async () => {
    const child = spawnEchoChild();
    const linesPromise = readChildStdoutLines(child, 1);
    try {
      sendJsonRpc(child, {
        kind: "request",
        method: "turn/progress",
        params: { amount: 1 },
      });
      await expect(linesPromise).resolves.toEqual([
        '{"jsonrpc":"2.0","method":"turn/progress","params":{"amount":1}}',
      ]);
    } finally {
      await stopChild(child);
    }
  });
});
