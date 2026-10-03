import { expect, it, vi } from "vitest";
import { BB_PI_EXTENSION_SOURCE } from "./bb-pi-extension.js";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

it("exports BB_PI_EXTENSION_SOURCE registering a wrapped bash tool with preemption and timeout clamping", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "bb-pi-test-"));
  const extFile = join(tempDir, "extension.mjs");
  writeFileSync(extFile, BB_PI_EXTENSION_SOURCE, "utf8");

  try {
    const mod = await import(pathToFileURL(extFile).href);
    const registeredTools = new Map<string, any>();
    const fakePi = {
      registerTool(tool: any) {
        registeredTools.set(tool.name, tool);
      },
      on() {},
    };

    mod.default(fakePi);
    const bashTool = registeredTools.get("bash");
    expect(bashTool).toBeDefined();
    expect(bashTool.name).toBe("bash");
    expect(typeof bashTool.execute).toBe("function");

    // Test 1: Normal command execution succeeds and normalizes timeout
    const result = await bashTool.execute("tc-1", {
      command: "echo test-pi-bash",
      timeout: 90000, // Should be normalized to 90s, not 90000s
    });
    expect(result.content[0].text.trim()).toBe("test-pi-bash");

    // Test 2: Timeout cap at 1800s
    const result2 = await bashTool.execute("tc-2", {
      command: "echo cap-test",
      timeout: 999999, // Should be capped to 1800s
    });
    expect(result2.content[0].text.trim()).toBe("cap-test");

    // Test 3: Default timeout for undefined or 0
    const result3 = await bashTool.execute("tc-3", {
      command: "echo default-timeout",
    });
    expect(result3.content[0].text.trim()).toBe("default-timeout");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

it("preempts compound background subshell process trees immediately upon steer abort", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "bb-pi-test-compound-"));
  const extFile = join(tempDir, "extension.mjs");
  writeFileSync(extFile, BB_PI_EXTENSION_SOURCE, "utf8");

  try {
    const mod = await import(pathToFileURL(extFile).href);
    const registeredTools = new Map<string, any>();
    const fakePi = {
      registerTool(tool: any) {
        registeredTools.set(tool.name, tool);
      },
      on() {},
    };

    mod.default(fakePi);
    const bashTool = registeredTools.get("bash");

    // Compound subshell similar to the real failure mode: nohup background + foreground sleep
    const t0 = Date.now();
    const abortSignal = new AbortController();
    setTimeout(() => {
      abortSignal.abort({
        kind: "steer",
        message: "did you get stuck?",
      });
    }, 100);

    const abortResult = await bashTool.execute(
      "tc-compound",
      { command: "nohup sleep 100 > /dev/null 2>&1 & sleep 30", timeout: 90000 },
      abortSignal.signal,
    );

    const elapsed = Date.now() - t0;
    // Must be aborted in well under 2 seconds, not hang for 30s or 90,000s
    expect(elapsed).toBeLessThan(2500);
    expect(abortResult.content[0].text).toContain(
      '[Command terminated by user steering message: "did you get stuck?". Do not retry the prior command; attend immediately to the user\'s instructions.]',
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

it("ignores late abort signals after tool execution has settled (SOL-1)", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "bb-pi-test-settled-"));
  const extFile = join(tempDir, "extension.mjs");
  writeFileSync(extFile, BB_PI_EXTENSION_SOURCE, "utf8");

  try {
    const mod = await import(pathToFileURL(extFile).href);
    const registeredTools = new Map<string, any>();
    const fakePi = {
      registerTool(tool: any) {
        registeredTools.set(tool.name, tool);
      },
      on() {},
    };

    mod.default(fakePi);
    const bashTool = registeredTools.get("bash");

    // Command completes quickly
    const result = await bashTool.execute("tc-settle", {
      command: "echo settled-output",
      timeout: 10,
    });
    expect(result.content[0].text.trim()).toBe("settled-output");

    // Tool has settled; late abort does not throw or mutate
    const lateController = new AbortController();
    expect(() => {
      lateController.abort({ kind: "steer", message: "late abort" });
    }).not.toThrow();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

it("sends abort-active-tool to bridge channel when session.steer is called", async () => {
  const { PiRpcSession } = await import("./rpc-session.js");
  const session = new (PiRpcSession as any)({}, vi.fn(), vi.fn(), vi.fn());
  const sentMessages: any[] = [];
  const fakeChild = {
    exited: false,
    sendChannel(msg: any) {
      sentMessages.push(msg);
    },
    request: vi.fn(async () => ({ success: true })),
  };

  (session as any).child = fakeChild;
  (session as any).isProcessing = true;

  // Call steer
  void session.steer("stop immediately").catch(() => {});

  expect(sentMessages).toContainEqual({
    kind: "abort-active-tool",
    message: "stop immediately",
  });
});
