import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import {
  type JsonRpcMessage,
  sendJsonRpc,
  sendJsonRpcResult,
} from "./runtime-json-rpc.js";
import { createBridgeIo } from "./shared/bridge-harness.js";

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

function readLines(input: string): Promise<string[]> {
  const readline = createInterface({ input: Readable.from([input]) });
  const lines: string[] = [];
  readline.on("line", (line) => lines.push(line));
  return new Promise((resolve) => {
    readline.once("close", () => resolve(lines));
  });
}

describe("runtime JSON-RPC transport", () => {
  it("preserves Unicode line separators inside messages", async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        `const readline = require("node:readline");
const input = readline.createInterface({ input: process.stdin });
input.once("line", (line) => {
  try {
    const message = JSON.parse(line);
    process.stdout.write(JSON.stringify({ ok: true, text: message.params.text }) + "\\n");
  } catch {
    process.stdout.write(JSON.stringify({ ok: false }) + "\\n");
  }
});`,
      ],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    const text = "before\u2028middle\u2029after";

    try {
      sendJsonRpc(child, {
        jsonrpc: "2.0",
        id: 1,
        method: "test",
        params: { text },
      });

      await expect(readChildStdout(child)).resolves.toBe(
        `${JSON.stringify({ ok: true, text })}\n`,
      );
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      await waitForChildExit(child);
    }
  });

  it("preserves Unicode line separators inside bridge messages", async () => {
    const text = "before\u2028middle\u2029after";
    const message: JsonRpcMessage = {
      jsonrpc: "2.0",
      method: "test",
      params: { text },
    };
    let output = "";
    const { send } = createBridgeIo<JsonRpcMessage>({
      write: (line) => {
        output += line;
      },
    });

    send(message);

    const lines = await readLines(output);
    expect(lines.map((line) => JSON.parse(line))).toEqual([message]);
  });

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
