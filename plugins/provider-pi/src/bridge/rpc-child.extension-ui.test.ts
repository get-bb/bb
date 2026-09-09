import { expect, it, vi } from "vitest";
import { PiRpcChild } from "./rpc-child.js";

function childScript(script: string): { command: string; args: string[] } {
  return { command: process.execPath, args: ["-e", script] };
}

it("auto-cancels extension ui requests when no handler is installed", async () => {
  vi.stubEnv(
    "BB_PI_BRIDGE_COMMAND",
    process.execPath,
  );
  vi.stubEnv(
    "BB_PI_BRIDGE_ARGS",
    JSON.stringify([
      "-e",
      [
        "process.stdin.setEncoding('utf8');",
        "let input='';",
        "process.stdin.on('data', (chunk) => {",
        "  input += chunk;",
        "  const newline = input.indexOf('\\n');",
        "  if (newline < 0) return;",
        "  process.stdout.write(JSON.stringify({ type: 'probe_result', response: JSON.parse(input.slice(0, newline)) }) + '\\n');",
        "  process.exit();",
        "});",
        "process.stdout.write(JSON.stringify({ type: 'extension_ui_request', id: 'ui-1', method: 'select', title: 'Allow?', options: ['Allow'] }) + '\\n');",
      ].join("\n"),
    ]),
  );
  const events: Record<string, unknown>[] = [];
  const child = new PiRpcChild({
    cwd: process.cwd(),
    env: process.env,
    args: [],
    recordThreadId: null,
    onEvent: (event) => events.push(event),
    onChannelMessage: () => undefined,
    onExit: () => undefined,
  });
  await child.waitForExit();
  const probe = events.find((event) => event.type === "probe_result");
  expect(probe).toMatchObject({
    response: { type: "extension_ui_response", id: "ui-1", cancelled: true },
  });
  vi.unstubAllEnvs();
});

it("forwards extension ui requests to the installed handler", async () => {
  const forwarded: Record<string, unknown>[] = [];
  const script = [
    "process.stdout.write(JSON.stringify({ type: 'extension_ui_request', id: 'ui-2', method: 'confirm', title: 'Go?' }) + '\\n');",
    "setTimeout(() => process.exit(), 50);",
  ].join("\n");
  const { command, args } = childScript(script);
  vi.stubEnv("BB_PI_BRIDGE_COMMAND", command);
  vi.stubEnv("BB_PI_BRIDGE_ARGS", JSON.stringify(args));
  const child = new PiRpcChild({
    cwd: process.cwd(),
    env: process.env,
    args: [],
    recordThreadId: null,
    onEvent: () => undefined,
    onChannelMessage: () => undefined,
    onExit: () => undefined,
    onExtensionUiRequest: (request) => forwarded.push(request),
  });
  await child.waitForExit();
  expect(forwarded).toEqual([
    { type: "extension_ui_request", id: "ui-2", method: "confirm", title: "Go?" },
  ]);
  vi.unstubAllEnvs();
});

it("respondToExtensionUi writes the response line to pi stdin", async () => {
  vi.stubEnv("BB_PI_BRIDGE_COMMAND", process.execPath);
  vi.stubEnv(
    "BB_PI_BRIDGE_ARGS",
    JSON.stringify([
      "-e",
      [
        "process.stdin.setEncoding('utf8');",
        "let input='';",
        "process.stdin.on('data', (chunk) => {",
        "  input += chunk;",
        "  const newline = input.indexOf('\\n');",
        "  if (newline < 0) return;",
        "  process.stdout.write(JSON.stringify({ type: 'probe_result', response: JSON.parse(input.slice(0, newline)) }) + '\\n');",
        "  process.exit();",
        "});",
        "process.stdout.write(JSON.stringify({ type: 'extension_ui_request', id: 7, method: 'select', title: 'Allow?', options: ['Allow'] }) + '\\n');",
      ].join("\n"),
    ]),
  );
  const events: Record<string, unknown>[] = [];
  const child = new PiRpcChild({
    cwd: process.cwd(),
    env: process.env,
    args: [],
    recordThreadId: null,
    onEvent: (event) => events.push(event),
    onChannelMessage: () => undefined,
    onExit: () => undefined,
    onExtensionUiRequest: (request) => {
      child.respondToExtensionUi(request.id as string, { value: "Allow" });
    },
  });
  await child.waitForExit();
  const probe = events.find((event) => event.type === "probe_result");
  expect(probe).toMatchObject({
    response: { type: "extension_ui_response", id: 7, value: "Allow" },
  });
  vi.unstubAllEnvs();
});
