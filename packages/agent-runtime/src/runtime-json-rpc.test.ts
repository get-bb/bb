import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import {
  formatJsonRpcErrorMessage,
  sendJsonRpcResult,
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

describe("formatJsonRpcErrorMessage", () => {
  it("appends string details from error.data objects", () => {
    expect(
      formatJsonRpcErrorMessage({
        code: -32603,
        message: "Internal error",
        data: { details: "ACP session not found: 019fb4b0" },
      }),
    ).toBe("Internal error: ACP session not found: 019fb4b0");
  });

  it("appends plain-string error.data", () => {
    expect(
      formatJsonRpcErrorMessage({
        code: -32000,
        message: "Load failed",
        data: "missing rollout file",
      }),
    ).toBe("Load failed: missing rollout file");
  });

  it("does not duplicate details already present in the message", () => {
    expect(
      formatJsonRpcErrorMessage({
        code: -32000,
        message: "Load failed: missing rollout file",
        data: { details: "missing rollout file" },
      }),
    ).toBe("Load failed: missing rollout file");
  });

  it("keeps the bare message when data carries no string details", () => {
    expect(
      formatJsonRpcErrorMessage({
        code: -32603,
        message: "Internal error",
        data: { retryable: false },
      }),
    ).toBe("Internal error");
    expect(
      formatJsonRpcErrorMessage({ code: -32603, message: "Internal error" }),
    ).toBe("Internal error");
  });

  it("stringifies non-object errors", () => {
    expect(formatJsonRpcErrorMessage("boom")).toBe('"boom"');
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
});
