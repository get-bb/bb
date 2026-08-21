import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import { createAgentRuntime } from "./runtime.js";
import { createProviderForId } from "./provider-registry.js";
import { RuntimeProviderProcessManager } from "./runtime-provider-process.js";
import { RuntimeThreadIdentityRegistry } from "./runtime-thread-identity.js";
import type { BridgeProtocolAdapter } from "./bridge-protocol-adapter.js";
import {
  parseJsonRpcLine,
  settleJsonRpcResponse,
} from "@bb/provider-bridge-protocol/bridge-kit";
import {
  createScriptedEchoLaunch,
  createScriptedEchoProcessLog,
  createScriptedEchoRequestRecord,
  createScriptedEchoRuntime,
  fullRuntimeOptions,
  scriptedEchoProcessEnv,
  waitForRuntimeState,
  waitForThreadAgentMessageText,
  waitForThreadTurnCompleted,
  waitForThreadTurnStarted,
  withBridgeLaunch,
  type ScriptedEchoLaunchScript,
} from "./test/runtime-test-harness.js";
import { promptTextInput } from "./test/prompt-input.js";
import type { AgentRuntimeBridgeLaunch, AgentRuntimeOptions } from "./types.js";

interface CreateProviderProcessManagerArgs {
  /** Extra env the adapter's own process spec carries (overlays the runtime env). */
  adapterProcessEnv?: Record<string, string>;
  env?: Record<string, string>;
  handleStdoutLine?: (line: string, childPid: number | undefined) => void;
  onStderr?: NonNullable<AgentRuntimeOptions["onStderr"]>;
  onProcessExit: NonNullable<AgentRuntimeOptions["onProcessExit"]>;
  /**
   * A raw script to run instead of the bridge bootstrap + scripted echo
   * bridge: the process-manager tests are about spawn, stderr, exit and
   * replacement mechanics, and some of them need a process that never
   * answers the handshake at all.
   */
  rawScriptPath?: string;
  workspacePath: string;
}

/** The codex thread-process tests share this launch: pid-stamped identities. */
const CODEX_SCRIPT: ScriptedEchoLaunchScript = { identifyProcess: true };

describe("createAgentRuntime process lifecycle", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bb-runtime-test-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * The real bridge-protocol adapter for the scripted echo launch; with a
   * `rawScriptPath` its process spec is redirected at that script (the
   * adapter's request plans still go down the pipe, so a raw script that
   * wants to pass startup answers `initialize` itself).
   */
  function createManagerAdapter(
    args: Pick<
      CreateProviderProcessManagerArgs,
      "adapterProcessEnv" | "rawScriptPath"
    >,
  ): BridgeProtocolAdapter {
    const adapter = createProviderForId("fake", {
      additionalWorkspaceWriteRoots: [],
      bridgeLaunch: createScriptedEchoLaunch(),
    });
    const process =
      args.rawScriptPath === undefined
        ? adapter.process
        : { command: adapter.process.command, args: [args.rawScriptPath] };
    return {
      ...adapter,
      process: {
        ...process,
        ...(args.adapterProcessEnv !== undefined
          ? { env: args.adapterProcessEnv }
          : {}),
      },
    };
  }

  function createProviderProcessManager(
    args: CreateProviderProcessManagerArgs,
  ): RuntimeProviderProcessManager {
    const identityRegistry = new RuntimeThreadIdentityRegistry();
    let nextRequestId = 1;
    const adapter = createManagerAdapter(args);
    return new RuntimeProviderProcessManager({
      additionalWorkspaceWriteRoots: [],
      createAdapter: () => adapter,
      bridgeBundleDir: undefined,
      bridgeNodeExecutablePath: process.execPath,
      captureThreadExitState: (threadId) => ({
        activeTurnId: null,
        pendingTurnStart: false,
        providerThreadId:
          identityRegistry.getProviderThreadId(threadId) ?? null,
        threadId,
      }),
      createProviderIdentityState: (providerId) =>
        identityRegistry.createProviderState({ providerId }),
      env: args.env,
      getNextRequestId: () => nextRequestId++,
      handleStdoutLine: ({ line, providerProcess }) => {
        args.handleStdoutLine?.(line, providerProcess.child.pid);
        // The manager owns the pipe but not the protocol: the runtime settles
        // the handshake's response from its stdout handler, so this stand-in
        // does the same (anything else a raw script writes is ignored).
        const parsed = parseJsonRpcLine(line);
        if (parsed.kind === "response") {
          settleJsonRpcResponse({
            id: parsed.parsedId,
            pending: providerProcess.pending,
            response: parsed.parsed,
          });
        }
      },
      onProcessExit: args.onProcessExit,
      onProviderIdentityWaitersInterrupted: (providerProcess) =>
        identityRegistry.resolvePendingIdentityWaiters(
          providerProcess.identity,
        ),
      onProviderThreadDetached: (threadId) =>
        identityRegistry.clearThread(threadId),
      onStderr: args.onStderr,
      skillRoots: [],
      workspacePath: args.workspacePath,
    });
  }

  /**
   * A raw process that dies during startup never answers `initialize`, so
   * `ensureProvider` rejects; the exit callback still fires. The tests about
   * stderr and exit mechanics only need the spawn and the exit.
   */
  async function ensureCrashingProvider(
    manager: RuntimeProviderProcessManager,
  ): Promise<void> {
    await expect(
      manager.ensureProvider({ processKey: "fake", providerId: "fake" }),
    ).rejects.toThrow(/exited during startup|exited/i);
  }

  /** The pids a crash-once script recorded, first start first. */
  function startedPids(startsLog: string): number[] {
    return readLogLines(startsLog).map((line) => Number(line));
  }

  it("handles JSON-RPC error responses from provider", async () => {
    const runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath: tmpDir,
        onEvent: () => {},
      },
      launch: { scripted: { unsupportedMethods: ["turn/start"] } },
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    // The bridge answers turn/start with METHOD_NOT_FOUND: the runtime
    // surfaces the JSON-RPC error to the caller.
    await expect(
      runtime.runTurn({
        clientRequestId: "creq_222222224w",
        threadId: "t1",
        input: [promptTextInput({ text: "hi" })],
        options: fullRuntimeOptions,
      }),
    ).rejects.toThrow("Method not found");
    await runtime.shutdown();
  });

  // ---- Process lifecycle ----

  it("fires onProcessExit when provider crashes", async () => {
    const exitInfo = vi.fn();
    const runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath: tmpDir,
        env: scriptedEchoProcessEnv({ exitAfter: "initialize" }),
        onEvent: () => {},
        onProcessExit: exitInfo,
      },
    });

    await runtime.ensureProvider({ providerId: "fake" });
    await waitForRuntimeState({
      label: "provider process exit callback",
      predicate: () => exitInfo.mock.calls.length === 1,
    });

    expect(exitInfo).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "fake", code: 0, expected: false }),
    );
    await runtime.shutdown();
  });

  // A plugin update changes the bridge artifact hash, which is part of the
  // process key, so the new artifact spawns a fresh process. Nothing releases
  // a threadless model-list/maintenance process, so without retirement every
  // superseded artifact leaks a node process until daemon shutdown.
  it("retires a threadless bridge process superseded by a new artifact hash", async () => {
    const manager = createProviderProcessManager({
      onProcessExit: vi.fn(),
      workspacePath: tmpDir,
    });

    const staleKey = "fake#bridge:aaaaaaaaaaaaaaaa";
    const freshKey = "fake#bridge:bbbbbbbbbbbbbbbb";
    await manager.ensureProvider({
      processKey: staleKey,
      providerId: "fake",
    });
    const staleProcess = manager.requireProviderProcess({
      processKey: staleKey,
      providerId: "fake",
    });

    await manager.ensureProvider({
      processKey: freshKey,
      providerId: "fake",
    });

    expect(staleProcess.child.killed).toBe(true);
    expect(() =>
      manager.requireProviderProcess({
        processKey: staleKey,
        providerId: "fake",
      }),
    ).toThrow();
    expect(
      manager.requireProviderProcess({
        processKey: freshKey,
        providerId: "fake",
      }).child.killed,
    ).toBe(false);

    await manager.shutdown();
  });

  it("keeps an old-hash bridge process that still owns a thread", async () => {
    const manager = createProviderProcessManager({
      onProcessExit: vi.fn(),
      workspacePath: tmpDir,
    });

    const staleKey = "fake#bridge:aaaaaaaaaaaaaaaa";
    await manager.ensureProvider({
      processKey: staleKey,
      providerId: "fake",
    });
    const staleProcess = manager.requireProviderProcess({
      processKey: staleKey,
      providerId: "fake",
    });
    staleProcess.identity.threadIds.add("thread-live");

    await manager.ensureProvider({
      processKey: "fake#bridge:bbbbbbbbbbbbbbbb",
      providerId: "fake",
    });

    expect(staleProcess.child.killed).toBe(false);
    expect(
      manager.requireProviderProcess({
        processKey: staleKey,
        providerId: "fake",
      }),
    ).toBe(staleProcess);

    await manager.shutdown();
  });

  // The sweep above only runs when a process is ensured, so the process kept
  // alive by its threads is never revisited. Releasing its last thread is the
  // one moment it becomes retirable.
  it("retires an old-hash bridge process when it loses its last thread", async () => {
    const manager = createProviderProcessManager({
      onProcessExit: vi.fn(),
      workspacePath: tmpDir,
    });

    const staleKey = "fake#bridge:aaaaaaaaaaaaaaaa";
    await manager.ensureProvider({ processKey: staleKey, providerId: "fake" });
    const staleProcess = manager.requireProviderProcess({
      processKey: staleKey,
      providerId: "fake",
    });
    staleProcess.identity.threadIds.add("thread-live");

    await manager.ensureProvider({
      processKey: "fake#bridge:bbbbbbbbbbbbbbbb",
      providerId: "fake",
    });
    expect(staleProcess.child.killed).toBe(false);

    // Still owns the thread: releasing anything else changes nothing.
    await manager.retireSupersededBridgeProcessIfIdle(staleProcess);
    expect(staleProcess.child.killed).toBe(false);

    staleProcess.identity.threadIds.delete("thread-live");
    await manager.retireSupersededBridgeProcessIfIdle(staleProcess);
    expect(staleProcess.child.killed).toBe(true);

    await manager.shutdown();
  });

  it("keeps the current-hash bridge process when a thread is released", async () => {
    const manager = createProviderProcessManager({
      onProcessExit: vi.fn(),
      workspacePath: tmpDir,
    });

    const currentKey = "fake#bridge:aaaaaaaaaaaaaaaa";
    await manager.ensureProvider({
      processKey: currentKey,
      providerId: "fake",
    });
    const providerProcess = manager.requireProviderProcess({
      processKey: currentKey,
      providerId: "fake",
    });

    await manager.retireSupersededBridgeProcessIfIdle(providerProcess);
    expect(providerProcess.child.killed).toBe(false);

    await manager.shutdown();
  });

  it("bounds provider stderr while data arrives without a newline", async () => {
    const exitInfo = vi.fn<NonNullable<AgentRuntimeOptions["onProcessExit"]>>();
    const stderrLines: string[] = [];
    const crashScript = join(tmpDir, "large-stderr-provider.cjs");
    writeFileSync(
      crashScript,
      `process.exitCode = 42;
      process.stderr.write("a".repeat(100_000) + "stderr-tail");`,
    );
    const manager = createProviderProcessManager({
      onProcessExit: exitInfo,
      onStderr: (line) => stderrLines.push(line),
      rawScriptPath: crashScript,
      workspacePath: tmpDir,
    });

    await ensureCrashingProvider(manager);
    await waitForRuntimeState({
      label: "bounded provider stderr exit callback",
      predicate: () => exitInfo.mock.calls.length === 1,
    });

    const stderr = exitInfo.mock.calls[0]?.[0].stderr;
    expect(Buffer.byteLength(stderr ?? "", "utf8")).toBeLessThanOrEqual(4_000);
    expect(stderr?.endsWith("stderr-tail")).toBe(true);
    expect(stderrLines).toHaveLength(1);
    expect(Buffer.byteLength(stderrLines[0] ?? "", "utf8")).toBeLessThanOrEqual(
      4_000,
    );
    await manager.shutdown();
  });

  it("drains provider stderr before reporting process exit", async () => {
    const exitInfo = vi.fn<NonNullable<AgentRuntimeOptions["onProcessExit"]>>();
    const crashScript = join(tmpDir, "delayed-stderr-provider.cjs");
    const delayedWriter =
      'setTimeout(() => process.stderr.write("stderr-after-exit"), 50);';
    writeFileSync(
      crashScript,
      `const { spawn } = require("node:child_process");
      const writer = spawn(process.execPath, ["-e", ${JSON.stringify(delayedWriter)}], {
        stdio: ["ignore", "ignore", "inherit"],
      });
      writer.unref();
      process.exit(42);`,
    );
    const manager = createProviderProcessManager({
      onProcessExit: exitInfo,
      rawScriptPath: crashScript,
      workspacePath: tmpDir,
    });

    await ensureCrashingProvider(manager);
    await waitForRuntimeState({
      label: "drained provider stderr exit callback",
      predicate: () => exitInfo.mock.calls.length === 1,
    });

    expect(exitInfo.mock.calls[0]?.[0].stderr).toBe("stderr-after-exit");
    await manager.shutdown();
  });

  it("does not wait for an already-exited provider during shutdown", async () => {
    const crashScript = join(tmpDir, "open-stderr-provider.cjs");
    const delayedWriter = "setTimeout(() => {}, 400);";
    writeFileSync(
      crashScript,
      `const { spawn } = require("node:child_process");
      const writer = spawn(process.execPath, ["-e", ${JSON.stringify(delayedWriter)}], {
        stdio: ["ignore", "ignore", "inherit"],
      });
      writer.unref();
      setTimeout(() => process.exit(42), 100);`,
    );
    const exitInfo = vi.fn<NonNullable<AgentRuntimeOptions["onProcessExit"]>>();
    const manager = createProviderProcessManager({
      onProcessExit: exitInfo,
      rawScriptPath: crashScript,
      workspacePath: tmpDir,
    });

    await ensureCrashingProvider(manager);
    await waitForRuntimeState({
      label: "exited provider reported",
      predicate: () => exitInfo.mock.calls.length === 1,
    });

    // A descendant still holds the stderr pipe open, so shutdown must not fall
    // back to the multi-second SIGTERM/SIGKILL escalation for a process that
    // has already exited.
    const startedAt = Date.now();
    await manager.shutdown();

    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  /**
   * A raw script that crashes on its first start and idles (answering
   * `initialize`) on every later one, so a replacement can be ensured.
   */
  function writeCrashOnceScript(args: {
    scriptPath: string;
    startMarker: string;
    /** Every start (the crash and each replacement) appends its pid here. */
    startsLog: string;
    firstStartBody: string;
  }): void {
    writeFileSync(
      args.scriptPath,
      `const { existsSync, writeFileSync, appendFileSync } = require("node:fs");
      const { spawn } = require("node:child_process");
      const startMarker = ${JSON.stringify(args.startMarker)};
      appendFileSync(${JSON.stringify(args.startsLog)}, process.pid + "\\n");
      if (!existsSync(startMarker)) {
        writeFileSync(startMarker, "started");
        ${args.firstStartBody}
      } else {
        const rl = require("node:readline").createInterface({ input: process.stdin });
        rl.on("line", (line) => {
          const msg = JSON.parse(line);
          if (msg.method === "initialize") {
            process.stdout.write(JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              result: { protocolVersion: 2, capabilities: { grammarVersions: [3, 3] } },
            }) + "\\n");
          }
        });
        setInterval(() => {}, 1_000);
      }`,
    );
  }

  it("waits for an exited provider to finalize before replacing it", async () => {
    const crashScript = join(tmpDir, "replace-after-stderr-provider.cjs");
    const startMarker = join(tmpDir, "replace-after-stderr.started");
    const startsLog = join(tmpDir, "replace-after-stderr.starts");
    const delayedWriter = "setTimeout(() => {}, 400);";
    writeCrashOnceScript({
      scriptPath: crashScript,
      startMarker,
      startsLog,
      firstStartBody: `const writer = spawn(process.execPath, ["-e", ${JSON.stringify(delayedWriter)}], {
          stdio: ["ignore", "ignore", "inherit"],
        });
        writer.unref();
        setTimeout(() => process.exit(42), 100);`,
    });
    const exitInfo = vi.fn<NonNullable<AgentRuntimeOptions["onProcessExit"]>>();
    const manager = createProviderProcessManager({
      onProcessExit: exitInfo,
      rawScriptPath: crashScript,
      workspacePath: tmpDir,
    });

    await ensureCrashingProvider(manager);
    await waitForRuntimeState({
      label: "exited provider reported",
      predicate: () => exitInfo.mock.calls.length === 1,
    });
    const [exitedPid] = startedPids(startsLog);

    await manager.ensureProvider({ processKey: "fake", providerId: "fake" });
    const replacementProvider = manager.requireProviderProcess({
      processKey: "fake",
      providerId: "fake",
    });
    expect(exitedPid).toBeDefined();
    expect(replacementProvider.child.pid).not.toBe(exitedPid);
    await manager.shutdown();
  });

  it("starts a single replacement for concurrent callers after an exit", async () => {
    const crashScript = join(tmpDir, "concurrent-replace-provider.cjs");
    const startsLog = join(tmpDir, "concurrent-replace.starts");
    const startMarker = join(tmpDir, "concurrent-replace.started");
    const delayedWriter = "setTimeout(() => {}, 400);";
    writeCrashOnceScript({
      scriptPath: crashScript,
      startMarker,
      startsLog,
      firstStartBody: `const writer = spawn(process.execPath, ["-e", ${JSON.stringify(delayedWriter)}], {
          stdio: ["ignore", "ignore", "inherit"],
        });
        writer.unref();
        setTimeout(() => process.exit(42), 100);`,
    });
    const exitInfo = vi.fn<NonNullable<AgentRuntimeOptions["onProcessExit"]>>();
    const manager = createProviderProcessManager({
      onProcessExit: exitInfo,
      rawScriptPath: crashScript,
      workspacePath: tmpDir,
    });

    await ensureCrashingProvider(manager);
    await waitForRuntimeState({
      label: "exited provider reported",
      predicate: () => exitInfo.mock.calls.length === 1,
    });
    const [exitedPid] = startedPids(startsLog);

    // Every caller waits on the same exit finalization, so each one resumes
    // needing to re-check whether a peer already spawned the replacement.
    await Promise.all([
      manager.ensureProvider({ processKey: "fake", providerId: "fake" }),
      manager.ensureProvider({ processKey: "fake", providerId: "fake" }),
      manager.ensureProvider({ processKey: "fake", providerId: "fake" }),
    ]);

    const replacementProvider = manager.requireProviderProcess({
      processKey: "fake",
      providerId: "fake",
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(exitedPid).toBeDefined();
    expect(replacementProvider.child.pid).not.toBe(exitedPid);
    expect(startedPids(startsLog)).toHaveLength(2);
    expect(manager.listRunningProviders()).toEqual(["fake"]);
    await manager.shutdown();
  });

  it("cuts off inherited provider output before starting a replacement", async () => {
    const crashScript = join(tmpDir, "stale-descendant-output-provider.cjs");
    const startMarker = join(tmpDir, "stale-descendant-output.started");
    const startsLog = join(tmpDir, "stale-descendant-output.starts");
    const writeMarker = join(tmpDir, "stale-descendant-output.wrote");
    // The descendant keeps holding both inherited pipes past the assertions
    // below, so the pipes can only be closed by the grace-deadline cleanup
    // rather than by the descendant itself exiting and letting them EOF.
    const delayedWriter = `const fs = require("node:fs");
      const writeMarker = ${JSON.stringify(writeMarker)};
      setTimeout(() => {
        fs.writeFileSync(writeMarker, "wrote");
        process.stdout.write("stale-from-old-provider\\n");
      }, 1_200);
      setTimeout(() => process.exit(0), 5_000);`;
    writeCrashOnceScript({
      scriptPath: crashScript,
      startMarker,
      startsLog,
      firstStartBody: `const writer = spawn(process.execPath, ["-e", ${JSON.stringify(delayedWriter)}], {
          stdio: ["ignore", "inherit", "inherit"],
        });
        writer.unref();
        setTimeout(() => process.exit(42), 50);`,
    });
    const lines: Array<{ childPid: number | undefined; line: string }> = [];
    const exitInfo = vi.fn<NonNullable<AgentRuntimeOptions["onProcessExit"]>>();
    const manager = createProviderProcessManager({
      handleStdoutLine: (line, childPid) => lines.push({ childPid, line }),
      onProcessExit: exitInfo,
      rawScriptPath: crashScript,
      workspacePath: tmpDir,
    });

    await ensureCrashingProvider(manager);
    await waitForRuntimeState({
      label: "exited provider reported",
      predicate: () => exitInfo.mock.calls.length === 1,
    });
    const [exitedPid] = startedPids(startsLog);

    await manager.ensureProvider({ processKey: "fake", providerId: "fake" });
    const replacementProvider = manager.requireProviderProcess({
      processKey: "fake",
      providerId: "fake",
    });
    await waitForRuntimeState({
      label: "old provider descendant attempted delayed output",
      predicate: () => existsSync(writeMarker),
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(exitedPid).toBeDefined();
    expect(replacementProvider.child.pid).not.toBe(exitedPid);
    expect(lines).not.toContainEqual({
      childPid: exitedPid,
      line: "stale-from-old-provider",
    });
    await manager.shutdown();
  });

  it("shutdown kills processes and rejects pending requests", async () => {
    const runtime = createScriptedEchoRuntime({
      runtime: { workspacePath: tmpDir, onEvent: () => {} },
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await runtime.shutdown();
    // Should not hang
  });

  it("treats shutdown process errors as expected without carrying state to replacement processes", async () => {
    const exitInfo = vi.fn<NonNullable<AgentRuntimeOptions["onProcessExit"]>>();
    const manager = createProviderProcessManager({
      onProcessExit: exitInfo,
      workspacePath: tmpDir,
    });

    await manager.ensureProvider({ processKey: "fake", providerId: "fake" });
    const shuttingDownProcess = manager.requireProviderProcess({
      processKey: "fake",
      providerId: "fake",
    });
    const shutdown = manager.shutdownProvider({
      processKey: "fake",
      providerId: "fake",
      timeoutMs: 50,
    });
    shuttingDownProcess.child.emit(
      "error",
      new Error("simulated shutdown process error"),
    );

    expect(exitInfo).toHaveBeenCalledTimes(1);
    expect(exitInfo).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        code: null,
        expected: true,
        providerId: "fake",
      }),
    );
    await shutdown;

    await manager.ensureProvider({ processKey: "fake", providerId: "fake" });
    const replacementProcess = manager.requireProviderProcess({
      processKey: "fake",
      providerId: "fake",
    });
    replacementProcess.child.emit("exit", 64, null);
    replacementProcess.child.emit("close", 64, null);

    await waitForRuntimeState({
      label: "unexpected replacement process exit",
      predicate: () => exitInfo.mock.calls.length === 2,
    });
    expect(exitInfo).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        code: 64,
        expected: false,
        providerId: "fake",
      }),
    );
    replacementProcess.child.kill("SIGTERM");
    await manager.shutdown();
  });

  // ---- Codex thread-scoped processes ----

  function createCodexRuntime(args: {
    events: ThreadEvent[];
    scripted?: ScriptedEchoLaunchScript;
    env?: Record<string, string>;
  }) {
    const processLog = createScriptedEchoProcessLog();
    const runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath: tmpDir,
        env: { ...processLog.env, ...args.env },
        onEvent: (event) => args.events.push(event),
      },
      launch: {
        pluginId: "provider-codex",
        scripted: { ...CODEX_SCRIPT, ...args.scripted },
      },
    });
    return { processLog, runtime };
  }

  it("runs each codex thread on a separate provider process", async () => {
    const events: ThreadEvent[] = [];
    const { processLog, runtime } = createCodexRuntime({ events });
    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "codex",
      options: fullRuntimeOptions,
    });
    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t2",
      projectId: "p1",
      providerId: "codex",
      options: fullRuntimeOptions,
    });
    await waitForRuntimeState({
      label: "two codex provider processes spawned",
      predicate: () =>
        processLog.read().filter((line) => line.startsWith("spawn:")).length ===
        2,
      runtime,
    });
    const firstSession = runtime.getProviderSession("t1");
    const secondSession = runtime.getProviderSession("t2");
    if (!firstSession || !secondSession) {
      throw new Error("Expected both codex threads to have provider sessions");
    }
    expect(firstSession.providerThreadId).not.toBe(
      secondSession.providerThreadId,
    );
    await Promise.all([
      runtime.runTurn({
        clientRequestId: "creq_222222225a",
        threadId: "t1",
        input: [promptTextInput({ text: "first" })],
        options: fullRuntimeOptions,
      }),
      runtime.runTurn({
        clientRequestId: "creq_222222225b",
        threadId: "t2",
        input: [promptTextInput({ text: "second" })],
        options: fullRuntimeOptions,
      }),
    ]);
    await waitForThreadAgentMessageText({
      events,
      providerId: "codex",
      runtime,
      text: "first",
      threadId: "t1",
    });
    await waitForThreadAgentMessageText({
      events,
      providerId: "codex",
      runtime,
      text: "second",
      threadId: "t2",
    });
    // Each answer carries the pid of the process that served it: two
    // different processes.
    const pidOf = (threadId: string): string | undefined =>
      events
        .filter(
          (event): event is Extract<ThreadEvent, { type: "item/completed" }> =>
            event.type === "item/completed" && event.threadId === threadId,
        )
        .map((event) =>
          event.item.type === "agentMessage"
            ? event.item.text.split(":")[1]
            : undefined,
        )
        .find((pid) => pid !== undefined);
    expect(pidOf("t1")).toBeDefined();
    expect(pidOf("t1")).not.toBe(pidOf("t2"));

    await runtime.stopThread({ threadId: "t1" });
    await waitForRuntimeState({
      label: "one codex provider process exited after stopping one thread",
      predicate: () =>
        processLog.read().filter((line) => line.startsWith("exit:")).length ===
        1,
      runtime,
    });
    await runtime.runTurn({
      clientRequestId: "creq_2222222252",
      threadId: "t2",
      input: [promptTextInput({ text: "still alive" })],
      options: fullRuntimeOptions,
    });
    await waitForThreadAgentMessageText({
      events,
      providerId: "codex",
      runtime,
      text: "still alive",
      threadId: "t2",
    });
    await runtime.shutdown();
  });

  it("stops a thread-scoped codex process when session construction fails", async () => {
    const events: ThreadEvent[] = [];
    const { processLog, runtime } = createCodexRuntime({
      events,
      scripted: {
        failMethods: [
          { method: "thread/start", message: "no rollout found for t1" },
        ],
      },
    });
    await expect(
      runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "codex",
        options: fullRuntimeOptions,
      }),
    ).rejects.toThrow("no rollout found");
    // The process the failed construction spawned does not linger.
    await waitForRuntimeState({
      label: "thread-scoped codex process exited after failed construction",
      predicate: () =>
        processLog.read().filter((line) => line.startsWith("exit:")).length ===
        1,
      runtime,
      timeoutMs: 5_000,
    });
    expect(runtime.getProviderSession("t1")).toBeNull();
    await waitForRuntimeState({
      label: "no codex provider process left running",
      predicate: () => runtime.listRunningProviders().length === 0,
      runtime,
      timeoutMs: 5_000,
    });
    await runtime.shutdown();
  });

  it("restarts a codex thread process after a terminal account error before the next turn", async () => {
    const events: ThreadEvent[] = [];
    const { processLog, runtime } = createCodexRuntime({ events });
    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "codex",
        options: fullRuntimeOptions,
      });
      const initialSession = runtime.getProviderSession("t1");
      await runtime.runTurn({
        clientRequestId: "creq_2222222253",
        threadId: "t1",
        input: [
          promptTextInput({
            text: "fail_turn:unexpected_status_401_Unauthorized:_Missing_bearer",
          }),
        ],
        options: fullRuntimeOptions,
      });
      await waitForThreadTurnCompleted({
        events,
        providerId: "codex",
        runtime,
        threadId: "t1",
      });
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "turn/completed",
          threadId: "t1",
          status: "failed",
        }),
      );
      // The 401 was the point; the waits below must not fail fast on it.
      events.splice(0, events.length);

      await runtime.runTurn({
        clientRequestId: "creq_2222222254",
        threadId: "t1",
        input: [promptTextInput({ text: "after reauth" })],
        options: fullRuntimeOptions,
      });
      await waitForThreadAgentMessageText({
        events,
        providerId: "codex",
        runtime,
        text: "after reauth",
        threadId: "t1",
      });

      // Same provider session, resumed on a fresh process.
      expect(runtime.getProviderSession("t1")).toEqual(initialSession);
      const logLines = processLog.read();
      expect(logLines.filter((line) => line.startsWith("spawn:"))).toHaveLength(
        2,
      );
      expect(logLines.filter((line) => line.startsWith("exit:"))).toHaveLength(
        1,
      );
      expect(
        logLines.some(
          (line) =>
            line.startsWith("thread/resume:") &&
            line.endsWith(`:t1:${initialSession?.providerThreadId ?? ""}`),
        ),
      ).toBe(true);
      const turnStarts = logLines.filter((line) =>
        line.startsWith("turn/start:"),
      );
      expect(turnStarts).toHaveLength(2);
      const [accountErrorTurn, afterReauthTurn] = turnStarts;
      expect(accountErrorTurn?.split(":")[1]).not.toBe(
        afterReauthTurn?.split(":")[1],
      );
    } finally {
      await runtime.shutdown();
    }
  });

  // A graduated provider has no daemon-bundled bridge, so the runtime's
  // account restart must re-resume with the launch the session started with —
  // otherwise the restart fails with "no provider bridge launch".
  it("re-resumes the codex account restart with the thread's bridge launch", async () => {
    const events: ThreadEvent[] = [];
    const record = createScriptedEchoRequestRecord();
    const bridgeLaunch = createScriptedEchoLaunch({
      pluginId: "provider-codex",
      scripted: CODEX_SCRIPT,
    });
    const runtime = createAgentRuntime({
      workspacePath: tmpDir,
      env: record.env,
      onEvent: (event) => events.push(event),
      onToolCall: async () => ({ contentItems: [], success: true }),
    });
    try {
      // The launch rides only this startThread; the restart's resume must
      // reuse it on its own.
      await runtime.startThread({
        bridgeLaunch,
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "codex",
        options: fullRuntimeOptions,
      });
      await runtime.runTurn({
        clientRequestId: "creq_2222222255",
        threadId: "t1",
        input: [promptTextInput({ text: "fail_turn:401_Unauthorized" })],
        options: fullRuntimeOptions,
      });
      await waitForThreadTurnCompleted({
        events,
        providerId: "codex",
        runtime,
        threadId: "t1",
      });
      events.splice(0, events.length);
      await runtime.runTurn({
        clientRequestId: "creq_2222222256",
        threadId: "t1",
        input: [promptTextInput({ text: "after reauth" })],
        options: fullRuntimeOptions,
      });
      await waitForThreadAgentMessageText({
        events,
        providerId: "codex",
        runtime,
        text: "after reauth",
        threadId: "t1",
      });
      // Two bridge processes were launched from the same artifact, and the
      // second one received the resume.
      const requests = record.read();
      expect(requests.filter((r) => r.method === "initialize")).toHaveLength(2);
      expect(requests.filter((r) => r.method === "thread/resume")).toHaveLength(
        1,
      );
    } finally {
      await runtime.shutdown();
    }
  });

  it("gives a changed declaration its own bridge process at the same artifact hash", async () => {
    const record = createScriptedEchoRequestRecord();
    const bridgeLaunch: AgentRuntimeBridgeLaunch = createScriptedEchoLaunch({
      pluginId: "provider-declared",
      digest: "d".repeat(64),
    });
    const runtime = createAgentRuntime({
      workspacePath: tmpDir,
      env: record.env,
      onEvent: () => {},
      onToolCall: async () => ({ contentItems: [], success: true }),
    });
    const initializeCount = (): number =>
      record.read().filter((r) => r.method === "initialize").length;
    try {
      await runtime.startThread({
        bridgeLaunch,
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "declared",
        options: fullRuntimeOptions,
      });
      await runtime.startThread({
        bridgeLaunch,
        environmentId: "env-1",
        threadId: "t2",
        projectId: "p1",
        providerId: "declared",
        options: fullRuntimeOptions,
      });
      // Same launch: one process serves both threads.
      expect(initializeCount()).toBe(1);

      const updatedDeclaration: AgentRuntimeBridgeLaunch = {
        ...bridgeLaunch,
        capabilities: {
          ...bridgeLaunch.capabilities,
          supportsThreadRename: !bridgeLaunch.capabilities.supportsThreadRename,
        },
      };
      await runtime.startThread({
        bridgeLaunch: updatedDeclaration,
        environmentId: "env-1",
        threadId: "t3",
        projectId: "p1",
        providerId: "declared",
        options: fullRuntimeOptions,
      });
      // A changed declaration at the same artifact hash is a new process.
      expect(initializeCount()).toBe(2);

      const rewound: AgentRuntimeBridgeLaunch = {
        ...updatedDeclaration,
        capabilities: { ...updatedDeclaration.capabilities, fork: "tip" },
      };
      await runtime.startThread({
        bridgeLaunch: rewound,
        environmentId: "env-1",
        threadId: "t4",
        projectId: "p1",
        providerId: "declared",
        options: fullRuntimeOptions,
      });
      expect(initializeCount()).toBe(3);
    } finally {
      await runtime.shutdown();
    }
  });

  it("reaps a codex thread process after a terminal provider error before turn start", async () => {
    const events: ThreadEvent[] = [];
    const { processLog, runtime } = createCodexRuntime({ events });
    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "codex",
        options: fullRuntimeOptions,
      });
      const initialSession = runtime.getProviderSession("t1");
      if (!initialSession) {
        throw new Error("Expected a codex session");
      }
      // The provider refuses before any turn opens: a thread-scoped 401.
      await runtime.runTurn({
        clientRequestId: "creq_2222222257",
        threadId: "t1",
        input: [promptTextInput({ text: "prestart_fail:401_Unauthorized" })],
        options: fullRuntimeOptions,
      });
      await waitForRuntimeState({
        events,
        label: "pre-start provider error",
        predicate: () =>
          events.some(
            (event) =>
              event.type === "provider/error" && event.threadId === "t1",
          ),
        providerId: "codex",
        runtime,
      });
      expect(runtime.getActiveTurnId("t1")).toBeNull();

      const result = await runtime.reapIdleProviderSessions({
        idleForMs: 0,
        nowMs: Date.now() + 60 * 60 * 1000,
        providerSessionReapingEnabled: false,
      });
      expect(result.reapedSessions).toEqual([
        expect.objectContaining({
          providerId: "codex",
          providerThreadId: initialSession.providerThreadId,
          threadId: "t1",
        }),
      ]);
      await waitForRuntimeState({
        label: "reaped codex process exited",
        predicate: () =>
          processLog.read().filter((line) => line.startsWith("exit:"))
            .length === 1,
        runtime,
      });
    } finally {
      await runtime.shutdown();
    }
  });

  it("reaps an idle codex thread process and resumes it later", async () => {
    const events: ThreadEvent[] = [];
    const { processLog, runtime } = createCodexRuntime({ events });
    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "codex",
        options: fullRuntimeOptions,
      });
      const initialSession = runtime.getProviderSession("t1");
      if (!initialSession) {
        throw new Error("Expected a codex session");
      }
      await runtime.runTurn({
        clientRequestId: "creq_2222222258",
        threadId: "t1",
        input: [promptTextInput({ text: "before reap" })],
        options: fullRuntimeOptions,
      });
      await waitForThreadAgentMessageText({
        events,
        providerId: "codex",
        runtime,
        text: "before reap",
        threadId: "t1",
      });

      const belowThresholdResult = await runtime.reapIdleProviderSessions({
        idleForMs: 30 * 60 * 1000,
        nowMs: Date.now() + 29 * 60 * 1000,
        providerSessionReapingEnabled: false,
      });
      expect(belowThresholdResult.reapedSessions).toEqual([]);
      expect(runtime.hasThread("t1")).toBe(true);
      expect(
        processLog.read().filter((line) => line.startsWith("exit:")),
      ).toHaveLength(0);

      const result = await runtime.reapIdleProviderSessions({
        idleForMs: 30 * 60 * 1000,
        nowMs: Date.now() + 31 * 60 * 1000,
        providerSessionReapingEnabled: false,
      });
      const reapedSession = result.reapedSessions[0];
      if (!reapedSession) {
        throw new Error("Expected the idle codex session to be reaped");
      }
      expect(result.reapedSessions).toHaveLength(1);
      expect(reapedSession).toMatchObject({
        providerId: "codex",
        providerThreadId: initialSession.providerThreadId,
        threadId: "t1",
      });
      expect(reapedSession.idleForMs).toBeGreaterThanOrEqual(30 * 60 * 1000);
      await waitForRuntimeState({
        label: "reaped codex process exited",
        predicate: () =>
          processLog.read().filter((line) => line.startsWith("exit:"))
            .length === 1,
        runtime,
      });
      expect(runtime.hasThread("t1")).toBe(false);
      expect(runtime.getProviderSession("t1")).toBeNull();

      await runtime.resumeThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "codex",
        providerThreadId: initialSession.providerThreadId,
        options: fullRuntimeOptions,
      });
      await runtime.runTurn({
        clientRequestId: "creq_2222222259",
        threadId: "t1",
        input: [promptTextInput({ text: "after reap" })],
        options: fullRuntimeOptions,
      });
      await waitForThreadAgentMessageText({
        events,
        providerId: "codex",
        runtime,
        text: "after reap",
        threadId: "t1",
      });
      const logLines = processLog.read();
      expect(logLines.filter((line) => line.startsWith("spawn:"))).toHaveLength(
        2,
      );
      expect(logLines.filter((line) => line.startsWith("exit:"))).toHaveLength(
        1,
      );
      expect(
        logLines.some(
          (line) =>
            line.startsWith("thread/resume:") &&
            line.endsWith(`:t1:${initialSession.providerThreadId}`),
        ),
      ).toBe(true);
    } finally {
      await runtime.shutdown();
    }
  });

  it("does not reap a codex thread process while a turn is active", async () => {
    const events: ThreadEvent[] = [];
    const { processLog, runtime } = createCodexRuntime({ events });
    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "codex",
        options: fullRuntimeOptions,
      });
      await runtime.runTurn({
        clientRequestId: "creq_222222226a",
        threadId: "t1",
        input: [promptTextInput({ text: "hold_turn" })],
        options: fullRuntimeOptions,
      });
      const { turnId } = await waitForThreadTurnStarted({
        events,
        providerId: "codex",
        runtime,
        threadId: "t1",
      });
      expect(runtime.getActiveTurnId("t1")).toBe(turnId);
      const firstResult = await runtime.reapIdleProviderSessions({
        idleForMs: 0,
        nowMs: Date.now() + 60 * 60 * 1000,
        providerSessionReapingEnabled: false,
      });
      const secondResult = await runtime.reapIdleProviderSessions({
        idleForMs: 0,
        nowMs: Date.now() + 60 * 60 * 1000,
        providerSessionReapingEnabled: false,
      });
      expect(firstResult.reapedSessions).toEqual([]);
      expect(secondResult.reapedSessions).toEqual([]);
      expect(runtime.hasThread("t1")).toBe(true);
      expect(
        processLog.read().filter((line) => line.startsWith("exit:")),
      ).toHaveLength(0);
    } finally {
      await runtime.shutdown();
    }
  });

  // Providers shipped as plugin artifacts are not in the runtime's restorable
  // seed table at all, so the one thing that makes a non-Codex provider's idle
  // sessions reapable is the `sessionRestorable` its bridge reports on
  // session construction.
  it("reaps a restorable non-Codex session only when the experiment is on", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath: tmpDir,
        onEvent: (event) => events.push(event),
      },
      launch: {
        pluginId: "provider-claude-code",
        scripted: { sessionRestorable: true },
      },
    });
    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "claude-code",
        options: fullRuntimeOptions,
      });
      await expect(
        runtime.reapIdleProviderSessions({
          idleForMs: 0,
          nowMs: Date.now(),
          providerSessionReapingEnabled: false,
        }),
      ).resolves.toEqual({ reapedSessions: [] });
      expect(runtime.hasThread("t1")).toBe(true);
      const result = await runtime.reapIdleProviderSessions({
        idleForMs: 0,
        nowMs: Date.now(),
        providerSessionReapingEnabled: true,
      });
      expect(result.reapedSessions).toEqual([
        expect.objectContaining({
          providerId: "claude-code",
          threadId: "t1",
        }),
      ]);
      expect(runtime.hasThread("t1")).toBe(false);
    } finally {
      await runtime.shutdown();
    }
  });

  it("keeps releasing later sessions after one release fails", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath: tmpDir,
        onEvent: (event) => events.push(event),
      },
      launch: {
        pluginId: "provider-claude-code",
        scripted: {
          sessionRestorable: true,
          failStopForThreadIds: ["t-stopfail-1"],
        },
      },
    });
    try {
      for (const threadId of ["t-stopfail-1", "t2"]) {
        await runtime.startThread({
          environmentId: "env-1",
          threadId,
          projectId: "p1",
          providerId: "claude-code",
          options: fullRuntimeOptions,
        });
      }
      const result = await runtime.reapIdleProviderSessions({
        idleForMs: 0,
        nowMs: Date.now(),
        providerSessionReapingEnabled: true,
      });
      expect(result.reapedSessions).toEqual([
        expect.objectContaining({ threadId: "t2" }),
      ]);
      expect(runtime.hasThread("t-stopfail-1")).toBe(true);
      expect(runtime.hasThread("t2")).toBe(false);
    } finally {
      await runtime.shutdown();
    }
  });

  // ---- Spawn environment ----

  it("scrubs inherited bb runtime env vars before spawning provider processes", async () => {
    vi.stubEnv("BB_DATA_DIR", "/tmp/leaked-bb-data");
    vi.stubEnv("BB_SERVER_PORT", "38886");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("OPENAI_API_KEY", "external-secret");
    const envScript = join(tmpDir, "env-provider.cjs");
    writeFileSync(
      envScript,
      `const values = [
        process.env.BB_DATA_DIR ?? "missing",
        process.env.BB_SERVER_PORT ?? "missing",
        process.env.NODE_ENV ?? "missing",
        process.env.OPENAI_API_KEY ?? "missing",
        process.env.BB_THREAD_ID ?? "missing"
      ];
      process.stderr.write(values.join("|") + "\\n");
      setInterval(() => {}, 1000);`,
    );
    const stderrLines: string[] = [];
    const manager = createProviderProcessManager({
      env: {
        BB_THREAD_ID: "thr_explicit",
      },
      onProcessExit: vi.fn(),
      onStderr: (line) => {
        stderrLines.push(line);
      },
      rawScriptPath: envScript,
      workspacePath: tmpDir,
    });

    try {
      // The idle script never answers initialize; the spawn env is what is
      // under test, so the stderr line is awaited while startup is pending.
      const ensure = manager
        .ensureProvider({ processKey: "fake", providerId: "fake" })
        .catch(() => undefined);
      await waitForRuntimeState({
        label: "provider env stderr",
        predicate: () => stderrLines.length > 0,
      });
      expect(stderrLines[0]).toBe(
        "missing|missing|missing|external-secret|thr_explicit",
      );
      await manager.shutdown();
      await ensure;
    } finally {
      await manager.shutdown();
    }
  });

  it("launches runtime-managed node bridges with the current executable when node is absent from PATH", async () => {
    vi.stubEnv("PATH", "");
    const record = createScriptedEchoRequestRecord();
    const runtime = createScriptedEchoRuntime({
      runtime: { workspacePath: tmpDir, env: record.env, onEvent: () => {} },
    });
    try {
      // With no node on PATH the bridge bootstrap can only have run under the
      // runtime's own executable: the handshake completing proves it.
      await runtime.ensureProvider({ providerId: "fake" });
      expect(record.last("initialize")).toBeDefined();
    } finally {
      await runtime.shutdown();
    }
  });

  it("overlays adapter process env after inherited and runtime env", async () => {
    vi.stubEnv("ELECTRON_RUN_AS_NODE", "0");
    const envScript = join(tmpDir, "bridge-env-provider.cjs");
    writeFileSync(
      envScript,
      `const values = [
        process.env.ELECTRON_RUN_AS_NODE ?? "missing",
        process.env.BRIDGE_ONLY ?? "missing",
        process.env.BB_THREAD_ID ?? "missing"
      ];
      process.stderr.write(values.join("|") + "\\n");
      setInterval(() => {}, 1000);`,
    );
    const stderrLines: string[] = [];
    const manager = createProviderProcessManager({
      adapterProcessEnv: {
        BRIDGE_ONLY: "bridge",
        ELECTRON_RUN_AS_NODE: "1",
      },
      env: {
        BB_THREAD_ID: "thr_explicit",
        ELECTRON_RUN_AS_NODE: "runtime",
      },
      onProcessExit: vi.fn(),
      onStderr: (line) => {
        stderrLines.push(line);
      },
      rawScriptPath: envScript,
      workspacePath: tmpDir,
    });

    try {
      const ensure = manager
        .ensureProvider({ processKey: "fake", providerId: "fake" })
        .catch(() => undefined);
      await waitForRuntimeState({
        label: "bridge env stderr",
        predicate: () => stderrLines.length > 0,
      });
      expect(stderrLines[0]).toBe("1|bridge|thr_explicit");
      await manager.shutdown();
      await ensure;
    } finally {
      await manager.shutdown();
    }
  });

  it("ignores provider stdout emitted after shutdown starts", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath: tmpDir,
        env: scriptedEchoProcessEnv({ emitIdentityOnSigterm: true }),
        onEvent: (event) => events.push(event),
      },
    });
    const { providerThreadId } = await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await waitForRuntimeState({
      label: "initial provider identity event",
      predicate: () =>
        events.some(
          (event) =>
            event.type === "thread/identity" &&
            event.providerThreadId === providerThreadId,
        ),
    });
    events.splice(0, events.length);
    // The bridge emits a late thread/identity on SIGTERM; nothing written
    // after shutdown starts reaches consumers.
    await runtime.shutdown();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(events).toEqual([]);
  });

  // ---- Fail-fast behavior ----

  it("fails fast when the bridge artifact does not exist", async () => {
    // The bootstrap worker spawns, cannot import the artifact, and exits
    // before the handshake: ensureProvider must surface that instead of
    // waiting on a process that will never answer.
    const runtime = createAgentRuntime({
      workspacePath: tmpDir,
      onEvent: () => {},
      onToolCall: async () => ({ contentItems: [], success: true }),
    });
    await expect(
      withBridgeLaunch(
        runtime,
        createScriptedEchoLaunch({
          modulePath: join(tmpDir, "nonexistent-bridge.mjs"),
        }),
      ).ensureProvider({ providerId: "fake" }),
    ).rejects.toThrow(/exited unexpectedly[\s\S]*Cannot find module/);
    await runtime.shutdown();
  });

  it("fails fast when provider crashes during initialize", async () => {
    const runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath: tmpDir,
        env: scriptedEchoProcessEnv({ crashOn: "initialize" }),
        onEvent: () => {},
      },
    });
    await expect(
      runtime.ensureProvider({ providerId: "fake" }),
    ).rejects.toThrow(/exited during startup|exited/i);
    await runtime.shutdown();
  });

  it("removes the cached provider and retries when startup skill configuration fails", async () => {
    const record = createScriptedEchoRequestRecord();
    const runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath: tmpDir,
        // Process-level: skills/configure runs at startup, before any
        // session options exist. Only the first process fails it.
        env: {
          ...record.env,
          ...scriptedEchoProcessEnv({
            failMethods: [
              { method: "skills/configure", message: "configure failed" },
            ],
          }),
        },
        skillRoots: [
          {
            id: "skill-root",
            providerId: "codex",
            skillDirectoryRootPath: tmpDir,
          },
        ],
        onEvent: () => {},
      },
      launch: { pluginId: "provider-codex" },
    });
    try {
      await expect(
        runtime.startThread({
          environmentId: "env-1",
          threadId: "t1",
          projectId: "p1",
          providerId: "codex",
          options: fullRuntimeOptions,
        }),
      ).rejects.toThrow("configure failed");
      expect(runtime.listRunningProviders()).not.toContain("codex");
      // The failed process was discarded; the next start spawns a fresh one
      // which runs the startup configuration again before the thread starts.
      const requestsBefore = record.read();
      expect(requestsBefore.map((request) => request.method)).toEqual([
        "initialize",
        "skills/configure",
      ]);
      expect(requestsBefore.some((r) => r.method === "thread/start")).toBe(
        false,
      );
    } finally {
      await runtime.shutdown();
    }
    // A second runtime with a non-failing bridge process: the cached provider
    // was removed, so startup runs in full and the thread starts.
    const retryRecord = createScriptedEchoRequestRecord();
    const retryRuntime = createScriptedEchoRuntime({
      runtime: {
        workspacePath: tmpDir,
        env: retryRecord.env,
        skillRoots: [
          {
            id: "skill-root",
            providerId: "codex",
            skillDirectoryRootPath: tmpDir,
          },
        ],
        onEvent: () => {},
      },
      launch: { pluginId: "provider-codex" },
    });
    try {
      await retryRuntime.startThread({
        environmentId: "env-1",
        threadId: "t2",
        projectId: "p1",
        providerId: "codex",
        options: fullRuntimeOptions,
      });
      expect(retryRuntime.listRunningProviders()).toContain("codex");
      expect(retryRecord.read().map((request) => request.method)).toEqual([
        "initialize",
        "skills/configure",
        "thread/start",
      ]);
    } finally {
      await retryRuntime.shutdown();
    }
  });

  it("waits for startup skill configuration before starting a codex thread", async () => {
    const record = createScriptedEchoRequestRecord();
    const runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath: tmpDir,
        env: record.env,
        skillRoots: [
          {
            id: "skill-root",
            providerId: "codex",
            skillDirectoryRootPath: tmpDir,
          },
        ],
        onEvent: () => {},
      },
      launch: { pluginId: "provider-codex", scripted: { startDelayMs: 50 } },
    });
    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "codex",
        options: fullRuntimeOptions,
      });
      // Startup configuration is ordered before the thread reaches the
      // bridge, every time.
      expect(record.read().map((request) => request.method)).toEqual([
        "initialize",
        "skills/configure",
        "thread/start",
      ]);
    } finally {
      await runtime.shutdown();
    }
  });

  it("fails fast on runTurn after provider has crashed", async () => {
    const exitInfo = vi.fn();
    const runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath: tmpDir,
        onEvent: () => {},
        onProcessExit: exitInfo,
      },
      launch: { scripted: { exitAfter: "thread/start" } },
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await waitForRuntimeState({
      label: "provider process exit callback",
      predicate: () => exitInfo.mock.calls.length === 1,
    });
    await expect(
      runtime.runTurn({
        clientRequestId: "creq_222222226b",
        threadId: "t1",
        input: [promptTextInput({ text: "after crash" })],
        options: fullRuntimeOptions,
      }),
    ).rejects.toThrow(/exited|not running|no provider associated/i);
    await runtime.shutdown();
  });

  it("reports a pending turn when the provider exits after acknowledging turn/start", async () => {
    const exitInfo = vi.fn<NonNullable<AgentRuntimeOptions["onProcessExit"]>>();
    const runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath: tmpDir,
        onEvent: () => {},
        onProcessExit: exitInfo,
      },
      // Acknowledge turn/start, then exit before the turn opens.
      launch: { scripted: { swallowTurnStart: true, exitAfter: "turn/start" } },
    });

    const { providerThreadId } = await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await runtime.runTurn({
      clientRequestId: "creq_2222222262",
      threadId: "t1",
      input: [promptTextInput({ text: "never starts" })],
      options: fullRuntimeOptions,
    });
    await waitForRuntimeState({
      label: "provider process exit callback",
      predicate: () => exitInfo.mock.calls.length === 1,
    });
    expect(exitInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "fake",
        threads: [
          expect.objectContaining({
            threadId: "t1",
            providerThreadId,
            activeTurnId: null,
            pendingTurnStart: true,
          }),
        ],
      }),
    );
    await runtime.shutdown();
  });

  it("concurrent ensureProvider calls do not spawn duplicate processes", async () => {
    const record = createScriptedEchoRequestRecord();
    const runtime = createScriptedEchoRuntime({
      runtime: { workspacePath: tmpDir, env: record.env, onEvent: () => {} },
    });

    await Promise.all([
      runtime.ensureProvider({ providerId: "fake" }),
      runtime.ensureProvider({ providerId: "fake" }),
      runtime.ensureProvider({ providerId: "fake" }),
    ]);
    // One process, one handshake.
    expect(
      record.read().filter((request) => request.method === "initialize"),
    ).toHaveLength(1);
    expect(runtime.listRunningProviders()).toEqual(["fake"]);
    await runtime.shutdown();
  });
});

function readLogLines(logPath: string): string[] {
  if (!existsSync(logPath)) {
    return [];
  }
  const content = readFileSync(logPath, "utf8").trim();
  return content.length > 0 ? content.split("\n") : [];
}
