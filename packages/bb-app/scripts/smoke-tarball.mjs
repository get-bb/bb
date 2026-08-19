import { fork, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HTTP_WAIT_TIMEOUT_MS = 60_000;
const HTTP_WAIT_INTERVAL_MS = 250;
const PLUGIN_LOAD_TIMEOUT_MS = 60_000;
const PLUGIN_LOAD_INTERVAL_MS = 1_000;
const HOST_PLUGIN_WORKER_TIMEOUT_MS = 60_000;
// Auto-installed, default-enabled builtins (apps/server/src/services/plugins/
// builtin-registry.ts). Each must reach "running" in the packed tarball —
// bundles that pass health checks can still fail to load (0.0.31 shipped with
// every builtin unable to resolve @get-bb/plugin-sdk at import time).
const EXPECTED_RUNNING_BUILTIN_PLUGINS = [
  "automations",
  // Providers whose bridge ships as a plugin artifact: if the plugin does not
  // load, its provider disappears from the install entirely.
  "provider-acp",
  "provider-claude-code",
  "provider-codex",
  "connect",
  "custom-instructions",
  "inline-vis",
  "keep-awake",
  "secrets",
];
// The smoke drives every bridge as a canonical Provider Bridge Protocol
// client, which is the only dialect the bridges still speak. Mirrors
// PROVIDER_BRIDGE_PROTOCOL_VERSION (packages/provider-bridge-protocol/src/
// version.ts); this script imports nothing from the workspace so it can run
// against a packed tarball.
const PROVIDER_BRIDGE_PROTOCOL_VERSION = 2;
// A canonical turn/start carries a client request id (`creq_` + ten
// Crockford-ish characters, @bb/domain's clientTurnRequestIdSchema).
const SMOKE_CLIENT_REQUEST_ID = "creq_smkptest23";
const BRIDGE_WAIT_TIMEOUT_MS = 10_000;
const PROCESS_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST = "127.0.0.1";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptsDir, "..");
const piConfigExtensionFixturePath = resolve(
  scriptsDir,
  "fixtures",
  "pi-config-extension.ts",
);
const tempRoot = await mkdtemp(join(tmpdir(), "bb-app-tarball-"));
const smokeProcessEnv = {
  BB_TELEMETRY: "false",
};

function delay(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function formatProcessOutput(output) {
  const sections = [];
  if (output.stdout.trim()) {
    sections.push(`stdout:\n${output.stdout}`);
  }
  if (output.stderr.trim()) {
    sections.push(`stderr:\n${output.stderr}`);
  }
  return sections.join("\n\n");
}

function collectProcessOutput(childProcess) {
  const output = {
    stderr: "",
    stdout: "",
  };
  childProcess.stdout?.on("data", (chunk) => {
    output.stdout += chunk.toString("utf8");
  });
  childProcess.stderr?.on("data", (chunk) => {
    output.stderr += chunk.toString("utf8");
  });
  return output;
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function waitForProcessExit(childProcess) {
  return new Promise((resolvePromise) => {
    childProcess.once("exit", (code, signal) => {
      resolvePromise({ code, signal });
    });
  });
}

async function runCommand({ args, command, cwd = tempRoot, env = {}, label }) {
  const childProcess = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      ...env,
      ...smokeProcessEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = collectProcessOutput(childProcess);
  const result = await waitForProcessExit(childProcess);
  if (result.code !== 0) {
    throw new Error(
      `${label} failed with ${result.code ?? result.signal}\n${formatProcessOutput(output)}`,
    );
  }
  return output.stdout;
}

function spawnManagedProcess({ args, command, env = {}, label }) {
  const detached = process.platform !== "win32";
  const childProcess = spawn(command, args, {
    cwd: tempRoot,
    detached,
    env: {
      ...process.env,
      ...env,
      ...smokeProcessEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = collectProcessOutput(childProcess);
  return {
    childProcess,
    detached,
    label,
    output,
  };
}

function reserveFreePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Expected TCP server address with a port"));
        return;
      }
      resolvePromise({ port: address.port, server });
    });
  });
}

async function getFreePorts(count) {
  const reservations = [];
  try {
    // Keep every listener open until the whole set is allocated. Closing each
    // one immediately lets the OS hand the same port to the next request.
    for (let index = 0; index < count; index += 1) {
      reservations.push(await reserveFreePort());
    }
    return reservations.map(({ port }) => port);
  } finally {
    await Promise.all(
      reservations.map(
        ({ server }) =>
          new Promise((resolvePromise, reject) => {
            server.close((error) => {
              if (error) {
                reject(error);
                return;
              }
              resolvePromise();
            });
          }),
      ),
    );
  }
}

async function waitForHttp({ label, processRef, url }) {
  const deadline = Date.now() + HTTP_WAIT_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    if (
      processRef.childProcess.exitCode !== null ||
      processRef.childProcess.signalCode !== null
    ) {
      throw new Error(
        `${label} exited before ${url} became healthy\n${formatProcessOutput(processRef.output)}`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }
    await delay(HTTP_WAIT_INTERVAL_MS);
  }
  throw new Error(
    `Timed out waiting for ${label} at ${url}\n${formatProcessOutput(processRef.output)}`,
  );
}

async function waitForHostPluginWorker({ pluginId, processRef }) {
  const deadline = Date.now() + HOST_PLUGIN_WORKER_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    if (
      processRef.output.stdout.includes("Host plugin worker ready") &&
      processRef.output.stdout.includes(pluginId)
    ) {
      return;
    }
    if (
      processRef.childProcess.exitCode !== null ||
      processRef.childProcess.signalCode !== null
    ) {
      throw new Error(
        `${processRef.label} exited before host plugin ${pluginId} started\n${formatProcessOutput(processRef.output)}`,
      );
    }
    await delay(HTTP_WAIT_INTERVAL_MS);
  }
  throw new Error(
    `Timed out waiting for host plugin ${pluginId} on ${processRef.label}\n${formatProcessOutput(processRef.output)}`,
  );
}

async function stopManagedProcess(processRef) {
  if (processRef.detached) {
    try {
      process.kill(-processRef.childProcess.pid, "SIGINT");
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ESRCH")
      ) {
        throw error;
      }
    }
  }

  if (
    processRef.childProcess.exitCode !== null ||
    processRef.childProcess.signalCode !== null
  ) {
    return;
  }
  if (!processRef.detached) {
    processRef.childProcess.kill("SIGINT");
  }
  const stopped = await Promise.race([
    waitForProcessExit(processRef.childProcess).then(() => true),
    delay(PROCESS_STOP_TIMEOUT_MS).then(() => false),
  ]);
  if (!stopped) {
    if (processRef.detached) {
      process.kill(-processRef.childProcess.pid, "SIGTERM");
    } else {
      processRef.childProcess.kill("SIGTERM");
    }
    await waitForProcessExit(processRef.childProcess);
  }
}

function createNpxArgs(tarballPath, bin, args) {
  return ["--yes", "--package", tarballPath, "--", bin, ...args];
}

async function packTarball() {
  const stdout = await runCommand({
    args: ["pack", packageRoot, "--pack-destination", tempRoot, "--json"],
    command: "npm",
    label: "npm pack",
  });
  const packed = JSON.parse(stdout);
  if (!Array.isArray(packed) || packed.length !== 1) {
    throw new Error(`Unexpected npm pack output: ${stdout}`);
  }
  const [entry] = packed;
  if (
    typeof entry !== "object" ||
    entry === null ||
    !("filename" in entry) ||
    typeof entry.filename !== "string"
  ) {
    throw new Error(`Unexpected npm pack entry: ${stdout}`);
  }
  return join(tempRoot, entry.filename);
}

function waitForJsonRpcResponse({ childProcess, id, label, output }) {
  return new Promise((resolvePromise, reject) => {
    let buffer = "";
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeout);
      childProcess.stdout?.off("data", onData);
      childProcess.off("exit", onExit);
    };
    const settle = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback(value);
    };
    const parseLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch (error) {
        settle(
          reject,
          new Error(
            `${label} emitted invalid JSON-RPC output: ${trimmed}\n${formatProcessOutput(output)}`,
          ),
        );
        return;
      }

      if (isRecord(parsed) && parsed.id === id) {
        settle(resolvePromise, parsed);
      }
    };
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (settled) {
          return;
        }
        parseLine(line);
      }
    };
    const onExit = (code, signal) => {
      settle(
        reject,
        new Error(
          `${label} exited before response ${id} with ${code ?? signal}\n${formatProcessOutput(output)}`,
        ),
      );
    };
    const timeout = setTimeout(() => {
      settle(
        reject,
        new Error(
          `${label} timed out waiting for response ${id}\n${formatProcessOutput(output)}`,
        ),
      );
    }, BRIDGE_WAIT_TIMEOUT_MS);

    childProcess.stdout?.on("data", onData);
    childProcess.once("exit", onExit);
  });
}

/**
 * Bridges are never spawned directly: the runtime runs the packed bootstrap
 * and hands it the bridge module plus the plugin scope. Driving it the same
 * way here is what makes this a smoke of the real launch path.
 */
function spawnPackedBridge({ bridgePath, packageDir, pluginId }) {
  const dataDir = join(tempRoot, "bridge-data", pluginId);
  mkdirSync(dataDir, { recursive: true });
  return spawn(
    process.execPath,
    [
      join(packageDir, "host-daemon", "dist", "bb-provider-bridge-worker.mjs"),
      bridgePath,
      pluginId,
      dataDir,
    ],
    { cwd: tempRoot, stdio: ["pipe", "pipe", "pipe"] },
  );
}

async function smokeBridgeModelList({
  allowUnavailableProvider = false,
  bridgePath,
  packageDir,
  pluginId,
  label,
}) {
  const childProcess = spawnPackedBridge({ bridgePath, packageDir, pluginId });
  const output = collectProcessOutput(childProcess);
  const modelListResponsePromise = waitForJsonRpcResponse({
    childProcess,
    id: 2,
    label,
    output,
  });
  childProcess.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
        client: { name: "bb-app-smoke", version: "0.0.0" },
      },
    })}\n`,
  );
  childProcess.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "model/list",
      params: {},
    })}\n`,
  );
  const modelListResponse = await modelListResponsePromise;
  childProcess.stdin.end();
  const result = await waitForProcessExit(childProcess);
  if (result.code !== 0) {
    throw new Error(
      `${label} failed with ${result.code ?? result.signal}\n${formatProcessOutput(output)}`,
    );
  }

  if (
    "result" in modelListResponse &&
    isRecord(modelListResponse.result) &&
    Array.isArray(modelListResponse.result.models)
  ) {
    return;
  }

  const unavailableProviderMessage =
    "error" in modelListResponse &&
    isRecord(modelListResponse.error) &&
    typeof modelListResponse.error.message === "string" &&
    /(?:Native CLI binary|Claude Code executable).*not found|could not find the (?:Claude Code|Codex) CLI/u.test(
      modelListResponse.error.message,
    );
  if (!allowUnavailableProvider || !unavailableProviderMessage) {
    throw new Error(
      `${label} did not return a model/list response\n${formatProcessOutput(output)}`,
    );
  }
}

async function smokeProviderBridgeBundles(packageDir) {
  await smokeBridgeModelList({
    // Claude Code ships its bridge as a plugin artifact (graduation wave 5),
    // so the packed bundle to smoke is the one `bb plugin build` produced for
    // the builtin plugin, not a daemon-side file. The bridge intentionally
    // relies on the host's Claude CLI for account-scoped discovery; CI does
    // not install that binary, so its explicit unavailable-provider response
    // is a valid smoke outcome.
    allowUnavailableProvider: true,
    bridgePath: join(
      packageDir,
      "server",
      "dist",
      "builtin-plugins",
      "provider-claude-code",
      "dist",
      "host.js",
    ),
    packageDir,
    pluginId: "provider-claude-code",
    label: "Claude Code host-artifact bridge model/list",
  });
  await smokeBridgeModelList({
    bridgePath: join(packageDir, "host-daemon", "dist", "bb-pi-bridge.mjs"),
    packageDir,
    pluginId: "provider-pi",
    label: "Pi bridge model/list",
  });
  await smokeBridgeModelList({
    // ACP ships its bridge as a plugin artifact (graduation wave 5). With no
    // launch spec in the provider options it serves its synthetic "Agent
    // default" model rather than spawning an agent, which is the whole point
    // of the smoke: the packed artifact runs standalone.
    bridgePath: join(
      packageDir,
      "server",
      "dist",
      "builtin-plugins",
      "provider-acp",
      "dist",
      "host.js",
    ),
    packageDir,
    pluginId: "provider-acp",
    label: "ACP host-artifact bridge model/list",
  });
  await smokeBridgeModelList({
    // Codex ships its bridge as a plugin artifact (graduation wave 5), so the
    // packed bundle to smoke is the one `bb plugin build` produced for the
    // builtin plugin, not a daemon-side file. The bridge spawns the host's
    // `codex app-server` for model discovery; CI does not install the Codex
    // CLI, so its explicit missing-CLI response is a valid smoke outcome.
    allowUnavailableProvider: true,
    bridgePath: join(
      packageDir,
      "server",
      "dist",
      "builtin-plugins",
      "provider-codex",
      "dist",
      "host.js",
    ),
    packageDir,
    pluginId: "provider-codex",
    label: "Codex provider-bridge artifact model/list",
  });
}

// The daemon forks bb-plugin-host-worker.mjs (a sibling of daemon-bundle.mjs)
// for every plugin `bb.host` entry. The published package must ship it, and
// it must load a packed builtin host artifact and report ready over IPC;
// otherwise every host plugin call fails with "host plugin worker exited (1)".
async function smokePluginHostWorkerBundle(packageDir) {
  const workerPath = join(
    packageDir,
    "host-daemon",
    "dist",
    "bb-plugin-host-worker.mjs",
  );
  const artifactPath = join(
    packageDir,
    "server",
    "dist",
    "builtin-plugins",
    "keep-awake",
    "dist",
    "host.js",
  );
  const dataDir = join(tempRoot, "plugin-host-worker", "data");
  const workerTempDir = join(tempRoot, "plugin-host-worker", "tmp");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(workerTempDir, { recursive: true });
  const generation = "smoke-generation";
  const childProcess = fork(
    workerPath,
    [artifactPath, "keep-awake", generation, dataDir, workerTempDir],
    { cwd: tempRoot, stdio: ["ignore", "ignore", "pipe", "ipc"] },
  );
  const output = collectProcessOutput(childProcess);
  const exited = waitForProcessExit(childProcess);
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("plugin host worker did not report ready in time"));
    }, BRIDGE_WAIT_TIMEOUT_MS);
    childProcess.on("message", (message) => {
      if (!isRecord(message)) return;
      if (message.type === "ready") {
        clearTimeout(timer);
        resolve(message);
      } else if (message.type === "startup-error") {
        clearTimeout(timer);
        reject(new Error(`plugin host worker startup error: ${message.error}`));
      }
    });
    void exited.then((result) => {
      clearTimeout(timer);
      reject(
        new Error(
          `plugin host worker exited before ready (${result.code ?? result.signal})`,
        ),
      );
    });
  });
  try {
    const message = await ready;
    if (
      !isRecord(message) ||
      message.pluginId !== "keep-awake" ||
      message.generation !== generation
    ) {
      throw new Error(
        `plugin host worker reported an unexpected identity: ${JSON.stringify(message)}`,
      );
    }
    childProcess.disconnect();
    const result = await exited;
    if (result.code !== 0) {
      throw new Error(
        `plugin host worker exited with ${result.code ?? result.signal} after disconnect`,
      );
    }
    process.stdout.write("bb-app tarball smoke: plugin host worker ready\n");
  } catch (error) {
    if (childProcess.exitCode === null) childProcess.kill("SIGKILL");
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${formatProcessOutput(output)}`,
    );
  }
}

function collectJsonRpcMessages({ childProcess, onMessage }) {
  const messages = [];
  let buffer = "";
  childProcess.stdout?.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const message = JSON.parse(trimmed);
      messages.push(message);
      onMessage?.(message);
    }
  });
  return messages;
}

async function waitForBridgeMessage({
  childProcess,
  label,
  messages,
  output,
  predicate,
}) {
  const deadline = Date.now() + BRIDGE_WAIT_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const message = messages.find(predicate);
    if (message) {
      return message;
    }
    if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
      throw new Error(
        `${label} exited before the expected message\n${formatProcessOutput(output)}`,
      );
    }
    await delay(10);
  }
  throw new Error(
    `${label} timed out waiting for the expected message\n${formatProcessOutput(output)}`,
  );
}

function sendBridgeRequest(childProcess, id, method, params) {
  childProcess.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
  );
}

/**
 * The semantic deltas a `thread/delta` notification batches, or [] for
 * anything else. Bridge-protocol v2 carries no finished timeline events on
 * this wire — the runtime's assembler builds those — so the smoke asserts
 * against the delta grammar directly.
 */
function threadDeltas(message) {
  if (
    !isRecord(message) ||
    message.method !== "thread/delta" ||
    !isRecord(message.params) ||
    !Array.isArray(message.params.deltas)
  ) {
    return [];
  }
  return message.params.deltas.filter(isRecord);
}

/** The full permission policy a canonical request carries in `options`. */
const SMOKE_EXECUTION_OPTIONS = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
};

async function smokePiUserConfiguration(packageDir) {
  const testRoot = join(tempRoot, "pi-user-config");
  const agentDir = join(testRoot, "agent");
  const workspaceDir = join(testRoot, "workspace");
  const maintenanceDir = join(testRoot, "provider-maintenance-workspace");
  const projectConfigDir = join(workspaceDir, ".pi");
  const extensionPath = join(testRoot, "configured-extension.ts");
  const sessionMarkerPath = join(testRoot, "session-marker.json");
  const toolMarkerPath = join(testRoot, "tool-marker.txt");
  await mkdir(agentDir, { recursive: true });
  await mkdir(projectConfigDir, { recursive: true });
  await mkdir(maintenanceDir, { recursive: true });
  // Pi keys trust decisions by canonical path. macOS temp paths can resolve
  // through /private, so the raw mkdtemp path is not always the trust key.
  const trustedWorkspaceDir = await realpath(workspaceDir);
  await writeFile(
    extensionPath,
    await readFile(piConfigExtensionFixturePath, "utf8"),
  );
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({ defaultProjectTrust: "ask" }, null, 2),
  );
  await writeFile(
    join(agentDir, "trust.json"),
    JSON.stringify({ [trustedWorkspaceDir]: true }, null, 2),
  );
  await writeFile(
    join(projectConfigDir, "settings.json"),
    JSON.stringify(
      {
        defaultModel: "bb-config-e2e-model",
        defaultProvider: "bb-config-e2e",
        defaultThinkingLevel: "high",
        extensions: [extensionPath],
      },
      null,
      2,
    ),
  );

  const label = "Pi installed-package configuration E2E";
  const bridgePath = join(
    packageDir,
    "host-daemon",
    "dist",
    "bb-pi-bridge.mjs",
  );
  const childProcess = spawn(
    process.execPath,
    [
      join(packageDir, "host-daemon", "dist", "bb-provider-bridge-worker.mjs"),
      bridgePath,
      "provider-pi",
      maintenanceDir,
    ],
    {
      cwd: maintenanceDir,
      env: {
        ...process.env,
        BB_PI_BRIDGE_SESSION_DIR: join(testRoot, "sessions"),
        BB_PI_E2E_SESSION_MARKER: sessionMarkerPath,
        BB_PI_E2E_TOOL_MARKER: toolMarkerPath,
        PI_CODING_AGENT_DIR: agentDir,
        PI_OFFLINE: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const output = collectProcessOutput(childProcess);
  const dynamicToolCalls = [];
  const messages = collectJsonRpcMessages({
    childProcess,
    onMessage(message) {
      if (!isRecord(message) || message.method !== "item/tool/call") {
        return;
      }
      dynamicToolCalls.push(message);
      childProcess.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            contentItems: [{ type: "inputText", text: "BB tool result" }],
            success: true,
          },
        })}\n`,
      );
    },
  });

  try {
    sendBridgeRequest(childProcess, 101, "initialize", {
      protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
      client: { name: "bb-app-smoke", version: "0.0.0" },
    });
    sendBridgeRequest(childProcess, 105, "model/list", { cwd: workspaceDir });
    const modelListResponse = await waitForBridgeMessage({
      childProcess,
      label,
      messages,
      output,
      predicate: (message) => isRecord(message) && message.id === 105,
    });
    if (
      !isRecord(modelListResponse.result) ||
      !Array.isArray(modelListResponse.result.models) ||
      !modelListResponse.result.models.some(
        (model) =>
          isRecord(model) && model.id === "bb-config-e2e/bb-config-e2e-model",
      )
    ) {
      throw new Error(
        `${label} did not add the extension provider to model/list: ${JSON.stringify(modelListResponse)}`,
      );
    }
    sendBridgeRequest(childProcess, 102, "thread/start", {
      cwd: workspaceDir,
      dynamicTools: [
        {
          name: "bb_dynamic_tool",
          description: "A tool provided by BB.",
          inputSchema: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
          },
        },
      ],
      instructionMode: "append",
      options: SMOKE_EXECUTION_OPTIONS,
      threadId: "pi-config-e2e-thread",
    });
    await waitForBridgeMessage({
      childProcess,
      label,
      messages,
      output,
      predicate: (message) => isRecord(message) && message.id === 102,
    });

    sendBridgeRequest(childProcess, 103, "turn/start", {
      clientRequestId: SMOKE_CLIENT_REQUEST_ID,
      input: [{ type: "text", text: "Run both configured tools." }],
      options: SMOKE_EXECUTION_OPTIONS,
      providerThreadId: "pi-config-e2e-thread",
      threadId: "pi-config-e2e-thread",
    });
    // The turn must reach the "completed" terminal boundary: an interrupted
    // or failed settlement would otherwise satisfy a bare boundary wait and
    // hide a broken configuration.
    await waitForBridgeMessage({
      childProcess,
      label,
      messages,
      output,
      predicate: (message) =>
        threadDeltas(message).some(
          (delta) =>
            delta.kind === "turn.boundary" && delta.status === "completed",
        ),
    });

    const errors = messages.filter(
      (message) =>
        isRecord(message) && ("error" in message || message.method === "error"),
    );
    if (errors.length > 0) {
      throw new Error(`${label} emitted errors: ${JSON.stringify(errors)}`);
    }
    if (dynamicToolCalls.length !== 1) {
      throw new Error(
        `${label} expected one BB tool call, received ${dynamicToolCalls.length}`,
      );
    }
    const dynamicToolCall = dynamicToolCalls[0];
    if (
      !isRecord(dynamicToolCall.params) ||
      dynamicToolCall.params.tool !== "bb_dynamic_tool" ||
      !isRecord(dynamicToolCall.params.arguments) ||
      dynamicToolCall.params.arguments.value !== "BB tool input"
    ) {
      throw new Error(
        `${label} received an invalid BB tool call: ${JSON.stringify(dynamicToolCall)}`,
      );
    }

    // Neither tool is a pi command/file-change tool, so both settle as
    // generic `tool` terminal shapes on their `item.close` deltas.
    const completedToolNames = messages
      .flatMap((message) => threadDeltas(message))
      .filter(
        (delta) =>
          delta.kind === "item.close" &&
          delta.status === "completed" &&
          isRecord(delta.item) &&
          delta.item.type === "tool",
      )
      .map((delta) => delta.item.tool);
    if (
      !completedToolNames.includes("configured_tool") ||
      !completedToolNames.includes("bb_dynamic_tool")
    ) {
      throw new Error(
        `${label} did not complete both tools: ${completedToolNames.join(", ")}`,
      );
    }

    const sessionMarker = JSON.parse(await readFile(sessionMarkerPath, "utf8"));
    if (
      sessionMarker.provider !== "bb-config-e2e" ||
      sessionMarker.model !== "bb-config-e2e-model" ||
      sessionMarker.thinkingLevel !== "high"
    ) {
      throw new Error(
        `${label} did not apply project settings: ${JSON.stringify(sessionMarker)}`,
      );
    }
    const toolMarker = await readFile(toolMarkerPath, "utf8");
    if (toolMarker !== "extension tool input") {
      throw new Error(`${label} did not execute the configured extension tool`);
    }

    sendBridgeRequest(childProcess, 104, "thread/stop", {
      activeTurnId: null,
      intent: "release",
      providerThreadId: "pi-config-e2e-thread",
      threadId: "pi-config-e2e-thread",
    });
    await waitForBridgeMessage({
      childProcess,
      label,
      messages,
      output,
      predicate: (message) => isRecord(message) && message.id === 104,
    });
  } finally {
    childProcess.stdin.end();
    if (childProcess.exitCode === null && childProcess.signalCode === null) {
      const exited = await Promise.race([
        waitForProcessExit(childProcess).then(() => true),
        delay(PROCESS_STOP_TIMEOUT_MS).then(() => false),
      ]);
      if (!exited) {
        childProcess.kill("SIGTERM");
        await waitForProcessExit(childProcess);
      }
    }
  }
}

async function smokeHelpCommands(tarballPath) {
  await runCommand({
    args: createNpxArgs(tarballPath, "bb-app", ["--help"]),
    command: "npx",
    label: "bb-app help",
  });
  await runCommand({
    args: createNpxArgs(tarballPath, "bb", ["--help"]),
    command: "npx",
    label: "bb cli help",
  });
  await runCommand({
    args: createNpxArgs(tarballPath, "bb-server", ["--help"]),
    command: "npx",
    label: "bb-server help",
  });
  await runCommand({
    args: createNpxArgs(tarballPath, "bb-host-daemon", ["--help"]),
    command: "npx",
    label: "bb-host-daemon help",
  });
}

async function smokeConfigCommand(tarballPath) {
  const dataDir = join(tempRoot, "config-command-data");
  await runCommand({
    args: createNpxArgs(tarballPath, "bb-app", [
      "--data-dir",
      dataDir,
      "env",
      "set",
      "OPENAI_API_KEY",
      "test-openai-key",
    ]),
    command: "npx",
    label: "bb-app env OPENAI_API_KEY",
  });
  await runCommand({
    args: createNpxArgs(tarballPath, "bb-app", [
      "--data-dir",
      dataDir,
      "config",
      "set",
      "BB_APP_URL",
      "https://bb.example.test",
    ]),
    command: "npx",
    label: "bb-app config BB_APP_URL",
  });

  const configJson = JSON.parse(
    await readFile(join(dataDir, "config.json"), "utf8"),
  );
  const envJson = JSON.parse(await readFile(join(dataDir, "env.json"), "utf8"));
  if (envJson.env?.OPENAI_API_KEY !== "test-openai-key") {
    throw new Error("Expected bb-app env to persist OPENAI_API_KEY");
  }
  if (configJson.config?.BB_APP_URL !== "https://bb.example.test") {
    throw new Error("Expected bb-app config to persist BB_APP_URL");
  }
}

async function smokeSdkPackage(tarballPath) {
  const sdkDir = join(tempRoot, "sdk-import");
  await mkdir(sdkDir, { recursive: true });
  await writeFile(
    join(sdkDir, "package.json"),
    JSON.stringify({ type: "module", private: true }, null, 2),
  );
  await runCommand({
    args: [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarballPath,
    ],
    command: "npm",
    cwd: sdkDir,
    label: "install bb-app SDK smoke package",
  });
  await runCommand({
    args: [
      "--input-type=module",
      "-e",
      'import { BBSdk } from "bb-app"; if (typeof BBSdk !== "function") process.exit(1);',
    ],
    command: "node",
    cwd: sdkDir,
    label: "bb-app SDK JavaScript import",
  });
  await writeFile(
    join(sdkDir, "sdk-smoke.ts"),
    [
      'import { BBSdk, BbHttpError } from "bb-app";',
      "",
      'const bb = new BBSdk({ baseUrl: "http://127.0.0.1:38886" });',
      "const error: typeof BbHttpError = BbHttpError;",
      "void bb.status.get();",
      "void error;",
      "",
    ].join("\n"),
  );
  await runCommand({
    args: [
      "--yes",
      "--package",
      "typescript",
      "--",
      "tsc",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "--noEmit",
      "sdk-smoke.ts",
    ],
    command: "npx",
    cwd: sdkDir,
    label: "bb-app SDK TypeScript import",
  });
  return sdkDir;
}

async function smokeBuiltinPluginsRunning({ cliEnv, tarballPath }) {
  const deadline = Date.now() + PLUGIN_LOAD_TIMEOUT_MS;
  let lastSummary = "no plugin list output yet";
  // Plugins load after the HTTP server starts listening, so poll until every
  // expected builtin settles into "running".
  while (Date.now() <= deadline) {
    const stdout = await runCommand({
      args: createNpxArgs(tarballPath, "bb", ["plugin", "list", "--json"]),
      command: "npx",
      env: cliEnv,
      label: "bb plugin list",
    });
    const plugins = JSON.parse(stdout).plugins ?? [];
    const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]));
    const errored = plugins.filter((plugin) => plugin.status === "error");
    if (errored.length > 0) {
      throw new Error(
        `Builtin plugins failed to load:\n${errored
          .map((plugin) => `- ${plugin.id}: ${plugin.statusDetail}`)
          .join("\n")}`,
      );
    }
    const pending = EXPECTED_RUNNING_BUILTIN_PLUGINS.filter(
      (id) => byId.get(id)?.status !== "running",
    );
    if (pending.length === 0) {
      return;
    }
    lastSummary = pending
      .map((id) => `${id}=${byId.get(id)?.status ?? "missing"}`)
      .join(", ");
    await delay(PLUGIN_LOAD_INTERVAL_MS);
  }
  throw new Error(
    `Timed out waiting for builtin plugins to run: ${lastSummary}`,
  );
}

async function smokeFullStack(tarballPath, sdkDir) {
  const dataDir = join(tempRoot, "full-stack-data");
  const [serverPort, daemonPort] = await getFreePorts(2);
  const serverUrl = `http://127.0.0.1:${serverPort}`;
  const stack = spawnManagedProcess({
    args: createNpxArgs(tarballPath, "bb-app", [
      "--data-dir",
      dataDir,
      "--server-port",
      String(serverPort),
      "--host-daemon-port",
      String(daemonPort),
    ]),
    command: "npx",
    env: {
      BB_LOG_LEVEL: "info",
    },
    label: "bb-app full stack",
  });

  try {
    await waitForHttp({
      label: stack.label,
      processRef: stack,
      url: `${serverUrl}/health`,
    });
    await waitForHttp({
      label: stack.label,
      processRef: stack,
      url: `http://${DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST}:${daemonPort}/health`,
    });
    const cliEnv = {
      BB_DATA_DIR: dataDir,
      BB_HOST_DAEMON_PORT: String(daemonPort),
      BB_SERVER_URL: serverUrl,
    };
    await runCommand({
      args: createNpxArgs(tarballPath, "bb", ["status"]),
      command: "npx",
      env: cliEnv,
      label: "bb cli status",
    });
    await smokeBuiltinPluginsRunning({ cliEnv, tarballPath });
    // Keep Awake reconciles even its default disabled state, so reaching this
    // log proves the packed daemon found its companion worker, downloaded the
    // plugin artifact, and started the worker for a host RPC call.
    await waitForHostPluginWorker({
      pluginId: "keep-awake",
      processRef: stack,
    });
    await runCommand({
      args: [
        "--input-type=module",
        "-e",
        [
          'import { BBSdk } from "bb-app";',
          "const bb = new BBSdk({ baseUrl: process.env.BB_SERVER_URL });",
          "await bb.status.get();",
        ].join("\n"),
      ],
      command: "node",
      cwd: sdkDir,
      env: {
        BB_SERVER_URL: serverUrl,
      },
      label: "bb-app SDK status",
    });
  } finally {
    await stopManagedProcess(stack);
  }
}

async function smokeDaemonJoin(tarballPath) {
  const serverDataDir = join(tempRoot, "join-server-data");
  const [serverPort, firstDaemonPort, secondDaemonPort, staleEnvPort] =
    await getFreePorts(4);
  const serverUrl = `http://127.0.0.1:${serverPort}`;
  const staleEnvServerUrl = `http://127.0.0.1:${staleEnvPort}`;
  const daemonSpecs = [
    {
      dataDir: join(tempRoot, "join-daemon-data-1"),
      label: "bb-app host-daemon join 1",
      port: firstDaemonPort,
    },
    {
      dataDir: join(tempRoot, "join-daemon-data-2"),
      label: "bb-app host-daemon join 2",
      port: secondDaemonPort,
    },
  ];
  const server = spawnManagedProcess({
    args: createNpxArgs(tarballPath, "bb-server", [
      "--data-dir",
      serverDataDir,
      "--server-port",
      String(serverPort),
      "--host-daemon-port",
      String(firstDaemonPort),
    ]),
    command: "npx",
    env: {
      BB_LOG_LEVEL: "warn",
    },
    label: "bb-server",
  });

  const daemons = [];
  try {
    await waitForHttp({
      label: server.label,
      processRef: server,
      url: `${serverUrl}/health`,
    });
    for (const spec of daemonSpecs) {
      const daemon = spawnManagedProcess({
        args: createNpxArgs(tarballPath, "bb-app", [
          "host-daemon",
          "join",
          "--data-dir",
          spec.dataDir,
          "--server-url",
          serverUrl,
          "--host-daemon-port",
          String(spec.port),
        ]),
        command: "npx",
        env: {
          BB_LOG_LEVEL: "info",
          BB_SERVER_URL: staleEnvServerUrl,
        },
        label: spec.label,
      });
      daemons.push(daemon);
      await waitForHttp({
        label: daemon.label,
        processRef: daemon,
        url: `http://${DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST}:${spec.port}/health`,
      });
      const configJson = JSON.parse(
        await readFile(join(spec.dataDir, "config.json"), "utf8"),
      );
      if (configJson.serverUrl !== serverUrl) {
        throw new Error(
          `Expected persisted server URL ${serverUrl}, received ${configJson.serverUrl}`,
        );
      }
    }
    const cliEnv = {
      BB_DATA_DIR: serverDataDir,
      BB_HOST_DAEMON_PORT: String(firstDaemonPort),
      BB_SERVER_URL: serverUrl,
    };
    await smokeBuiltinPluginsRunning({ cliEnv, tarballPath });
    // Both daemons joined a server in a different process and data directory.
    // Ready workers on both prove host-plugin artifacts and calls fan out to
    // enrolled machines instead of assuming server-local paths.
    await Promise.all(
      daemons.map((daemon) =>
        waitForHostPluginWorker({
          pluginId: "keep-awake",
          processRef: daemon,
        }),
      ),
    );
  } finally {
    await Promise.all(daemons.map((daemon) => stopManagedProcess(daemon)));
    await stopManagedProcess(server);
  }
}

try {
  const tarballPath = await packTarball();
  await smokeHelpCommands(tarballPath);
  await smokeConfigCommand(tarballPath);
  const sdkDir = await smokeSdkPackage(tarballPath);
  const installedPackageDir = join(sdkDir, "node_modules", "bb-app");
  await smokeProviderBridgeBundles(installedPackageDir);
  await smokePluginHostWorkerBundle(installedPackageDir);
  await smokePiUserConfiguration(installedPackageDir);
  await smokeFullStack(tarballPath, sdkDir);
  await smokeDaemonJoin(tarballPath);
  process.stdout.write("bb-app tarball smoke passed\n");
} finally {
  await rm(tempRoot, { force: true, recursive: true });
}
