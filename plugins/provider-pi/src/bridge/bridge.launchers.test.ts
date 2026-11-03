import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleLine } from "./bridge.js";
import {
  piManagedCmdLauncher,
  piManagedLauncherJs,
} from "./pi-managed-install.test-support.js";
import {
  PI_BRIDGE_ARGS_ENV,
  PI_BRIDGE_COMMAND_ENV,
  resolvePiLaunch,
} from "./rpc-child.js";
import {
  FULL_PERMISSION_OPTIONS,
  type FakePiBridgeHarness,
  fakePiPath,
  startFakePiBridge,
} from "./test-support.js";

let harness: FakePiBridgeHarness;
let nextId = 3000;
let nextTurn = 0;

beforeEach(async () => {
  harness = await startFakePiBridge({
    prefix: "bb-pi-launchers-",
    initialize: true,
  });
});

afterEach(async () => {
  await harness.teardown();
});

function clientRequestId(): string {
  nextTurn += 1;
  const digits = String(nextTurn).padStart(10, "0");
  return `creq_${[...digits].map((digit) => "23456789ab"[Number(digit)]).join("")}`;
}

async function startProbeThread(threadId: string): Promise<string> {
  const started = await harness.startThread(threadId, {
    dynamicTools: [
      {
        name: "bb_probe",
        description: "A bb tool.",
        inputSchema: {
          type: "object",
          properties: { value: { type: "string" } },
        },
      },
    ],
  });
  expect(started.error, JSON.stringify(started)).toBeUndefined();
  return String(
    (started.result as { providerThreadId?: unknown }).providerThreadId,
  );
}

function startTurn(
  threadId: string,
  providerThreadId: string,
  text: string,
): void {
  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: (nextId += 1),
      method: "turn/start",
      params: {
        threadId,
        providerThreadId,
        clientRequestId: clientRequestId(),
        input: [{ type: "text", text, mentions: [] }],
        options: FULL_PERMISSION_OPTIONS,
      },
    }),
  );
}

async function expectToolRoundTrip(
  threadId: string,
  providerThreadId: string,
  value: string,
): Promise<void> {
  const since = harness.deltasOf(threadId).length;
  const seen = harness.messages.length;
  startTurn(
    threadId,
    providerThreadId,
    `/tool bb_probe ${JSON.stringify({ value })}`,
  );
  await harness.waitFor(
    () =>
      harness.messages
        .slice(seen)
        .some((message) => message.method === "item/tool/call"),
    "the dynamic tool call",
  );
  const toolCall = harness.messages
    .slice(seen)
    .find((message) => message.method === "item/tool/call");
  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: toolCall?.id,
      result: {
        contentItems: [{ type: "inputText", text: `result-${value}` }],
        success: true,
      },
    }),
  );
  await harness.waitForDelta(
    threadId,
    (delta) =>
      delta.kind === "item.textDelta" &&
      String(delta.text).includes(`Tool said: result-${value}`),
    since,
  );
  await harness.waitForTurnBoundary(threadId, since);
}

async function writeFakePiPackage(packageDirectory: string): Promise<string> {
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(
    join(packageDirectory, "package.json"),
    JSON.stringify({ bin: { pi: "cli.mjs" } }),
  );
  const cli = join(packageDirectory, "cli.mjs");
  await writeFile(
    cli,
    `import ${JSON.stringify(pathToFileURL(fakePiPath).href)};`,
  );
  return cli;
}

it("reads the configured Pi command and validates its arguments", () => {
  expect(resolvePiLaunch({})).toEqual({ command: "pi", args: [] });
  expect(
    resolvePiLaunch({
      [PI_BRIDGE_COMMAND_ENV]: "custom-pi",
      [PI_BRIDGE_ARGS_ENV]: '["--flag","value with spaces"]',
    }),
  ).toEqual({ command: "custom-pi", args: ["--flag", "value with spaces"] });
  expect(() =>
    resolvePiLaunch({
      [PI_BRIDGE_COMMAND_ENV]: "pi",
      [PI_BRIDGE_ARGS_ENV]: "[1]",
    }),
  ).toThrow("must be a JSON array of strings");
});

it("carries the extension channel through a launcher that starts pi as a child", async () => {
  const launcher = join(harness.workspaceDir, "launcher.mjs");
  await writeFile(
    launcher,
    [
      'import { spawn } from "node:child_process";',
      'const child = spawn(process.execPath, process.argv.slice(2), { stdio: "inherit" });',
      'child.on("exit", (code) => process.exit(code ?? 1));',
    ].join("\n"),
  );
  vi.stubEnv(PI_BRIDGE_COMMAND_ENV, process.execPath);
  vi.stubEnv(PI_BRIDGE_ARGS_ENV, JSON.stringify([launcher, fakePiPath]));
  const threadId = "thr_launcher_child";
  const providerThreadId = await startProbeThread(threadId);
  await expectToolRoundTrip(threadId, providerThreadId, "wrapped");
}, 60_000);

it("keeps the extension channel when pi reloads the extension", async () => {
  const threadId = "thr_extension_reload";
  const providerThreadId = await startProbeThread(threadId);
  const since = harness.deltasOf(threadId).length;
  startTurn(threadId, providerThreadId, "/reload");
  await harness.waitForTurnBoundary(threadId, since);
  await expectToolRoundTrip(threadId, providerThreadId, "reloaded");
}, 60_000);

it.skipIf(process.platform !== "win32")(
  "carries the extension channel through a pnpm pi.cmd shim",
  async () => {
    const bin = join(harness.workspaceDir, "pnpm home");
    const cli = await writeFakePiPackage(
      join(bin, "global", "node_modules", "@earendil-works", "pi-coding-agent"),
    );
    const shim = join(bin, "pi.cmd");
    await writeFile(
      shim,
      [
        "@SETLOCAL",
        '@IF EXIST "%~dp0\\node.exe" (',
        `  "%~dp0\\node.exe"  "${cli}" %*`,
        ") ELSE (",
        "  @SET PATHEXT=%PATHEXT:;.JS;=;%",
        `  node  "${cli}" %*`,
        ")",
        "",
      ].join("\r\n"),
    );
    vi.stubEnv(PI_BRIDGE_COMMAND_ENV, shim);
    vi.stubEnv(PI_BRIDGE_ARGS_ENV, undefined);
    const threadId = "thr_pnpm_shim";
    const providerThreadId = await startProbeThread(threadId);
    await expectToolRoundTrip(threadId, providerThreadId, "pnpm");
  },
  60_000,
);

it.skipIf(process.platform !== "win32")(
  "carries the extension channel through the Pi installer's managed launcher",
  async () => {
    const agent = join(harness.workspaceDir, "pi managed", "agent");
    const bin = join(agent, "bin");
    const installRoot = join(agent, "install");
    await writeFakePiPackage(
      join(
        installRoot,
        "releases",
        "1.4.0",
        "node_modules",
        "@earendil-works",
        "pi-coding-agent",
      ),
    );
    await mkdir(bin, { recursive: true });
    await writeFile(join(installRoot, "current-version"), "1.4.0\r\n");
    await writeFile(join(bin, "pi-launcher.js"), piManagedLauncherJs);
    const shim = join(bin, "pi.cmd");
    await writeFile(shim, piManagedCmdLauncher());
    vi.stubEnv(PI_BRIDGE_COMMAND_ENV, shim);
    vi.stubEnv(PI_BRIDGE_ARGS_ENV, undefined);
    const threadId = "thr_managed_launcher";
    const providerThreadId = await startProbeThread(threadId);
    await expectToolRoundTrip(threadId, providerThreadId, "managed");
  },
  60_000,
);
