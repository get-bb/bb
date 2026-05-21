import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFakeAdapter } from "@bb/agent-runtime/test";
import {
  statusStateBroadcastMessageSchema,
  type StatusStateBroadcastMessage,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { WebSocket, type RawData } from "ws";
import { createHostThread, sendTextMessage } from "../../helpers/api.js";
import { waitForThreadStatus } from "../../helpers/assertions.js";
import { withHarness } from "../../helpers/harness.js";
import { removePathWithRetry } from "../../helpers/remove-path.js";
import {
  createProjectFixture,
  DEFAULT_TIMEOUT_MS,
  TURN_TIMEOUT_MS,
} from "./shared.js";

interface DelayArgs {
  ms: number;
}

interface WaitForSocketOpenArgs {
  socket: WebSocket;
}

interface WaitForStatusDataBroadcastArgs {
  socket: WebSocket;
  timeoutMs: number;
}

interface WriteProviderScriptArgs {
  scriptPath: string;
}

const STATUS_DATA_PROVIDER_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const rl = readline.createInterface({ input: process.stdin });
const threads = new Map();
let nextProviderThreadId = 1;
let nextTurnId = 1;

const modelList = {
  models: [
    {
      id: "fake-model",
      model: "fake-model",
      displayName: "Fake Model",
      description: "Fake model for integration and runtime tests",
      supportedReasoningEfforts: [
        {
          reasoningEffort: "medium",
          description: "Medium",
        },
      ],
      defaultReasoningEffort: "medium",
      isDefault: true,
    },
  ],
  selectedOnlyModels: [],
};

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function paramsFor(message) {
  return isRecord(message.params) ? message.params : {};
}

function stringValue(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function inputText(input) {
  if (!Array.isArray(input)) {
    return "";
  }
  return input
    .filter((item) => isRecord(item))
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join(" ");
}

function threadStoragePath(params) {
  const options = isRecord(params.options) ? params.options : {};
  const envVars = isRecord(options.envVars) ? options.envVars : {};
  return typeof envVars.BB_THREAD_STORAGE === "string"
    ? envVars.BB_THREAD_STORAGE
    : null;
}

function writeStatusData(params, fallbackStoragePath) {
  if (!inputText(params.input).includes("write_status_data")) {
    return;
  }
  const storagePath = threadStoragePath(params) ?? fallbackStoragePath;
  if (!storagePath) {
    throw new Error("Missing BB_THREAD_STORAGE in provider command options");
  }
  const dir = path.join(storagePath, "STATUS-data");
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, ".worker." + process.pid + "." + Date.now() + ".tmp");
  fs.writeFileSync(tmpPath, JSON.stringify({ v: 1 }) + "\n", "utf8");
  fs.renameSync(tmpPath, path.join(dir, "worker.json"));
}

function beginTurn(params) {
  const threadId = stringValue(params.threadId, "unknown");
  const thread = threads.get(threadId);
  const providerThreadId = thread
    ? thread.providerThreadId
    : stringValue(params.providerThreadId, "provider-thread");
  const storedThreadStoragePath = thread ? thread.threadStoragePath : null;
  const turnId = "turn-" + nextTurnId;
  nextTurnId += 1;

  send({
    jsonrpc: "2.0",
    method: "turn/started",
    params: { threadId, turnId, providerThreadId },
  });
  writeStatusData(params, storedThreadStoragePath);
  send({
    jsonrpc: "2.0",
    method: "item/completed",
    params: {
      threadId,
      turnId,
      providerThreadId,
      item: {
        type: "agentMessage",
        id: "msg-" + turnId,
        text: "Response to: " + inputText(params.input),
      },
    },
  });
  send({
    jsonrpc: "2.0",
    method: "turn/completed",
    params: { threadId, turnId, providerThreadId, status: "completed" },
  });
}

rl.on("line", (line) => {
  const message = JSON.parse(line);
  const params = paramsFor(message);
  const id = message.id ?? 0;

  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id, result: { ok: true } });
    return;
  }
  if (message.method === "model/list") {
    send({ jsonrpc: "2.0", id, result: modelList });
    return;
  }
  if (message.method === "thread/start") {
    const threadId = stringValue(params.threadId, "unknown");
    const providerThreadId = "prov-" + nextProviderThreadId;
    nextProviderThreadId += 1;
    threads.set(threadId, {
      providerThreadId,
      threadStoragePath: threadStoragePath(params),
    });
    send({ jsonrpc: "2.0", id, result: { providerThreadId } });
    send({
      jsonrpc: "2.0",
      method: "thread/identity",
      params: { threadId, providerThreadId },
    });
    if (Array.isArray(params.input) && params.input.length > 0) {
      beginTurn({ ...params, providerThreadId });
    }
    return;
  }
  if (message.method === "turn/start") {
    send({ jsonrpc: "2.0", id, result: { ok: true } });
    beginTurn(params);
    return;
  }

  send({ jsonrpc: "2.0", id, result: { ok: true } });
});
`;

function delay(args: DelayArgs): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, args.ms);
  });
}

function waitForSocketOpen(args: WaitForSocketOpenArgs): Promise<void> {
  return new Promise((resolve, reject) => {
    args.socket.once("open", () => resolve());
    args.socket.once("error", reject);
  });
}

function waitForStatusDataBroadcast(
  args: WaitForStatusDataBroadcastArgs,
): Promise<StatusStateBroadcastMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for status-data broadcast"));
    }, args.timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      args.socket.off("message", onMessage);
      args.socket.off("error", onError);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onMessage = (data: RawData) => {
      try {
        const message = statusStateBroadcastMessageSchema.parse(
          JSON.parse(data.toString("utf8")),
        );
        cleanup();
        resolve(message);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    args.socket.on("message", onMessage);
    args.socket.on("error", onError);
  });
}

async function writeProviderScript(
  args: WriteProviderScriptArgs,
): Promise<void> {
  await fs.writeFile(args.scriptPath, STATUS_DATA_PROVIDER_SCRIPT, "utf8");
}

describe.sequential("fake provider STATUS-data watcher integration", () => {
  it("broadcasts STATUS-data writes from a daemon provider process", async () => {
    const scriptRoot = await fs.mkdtemp(
      path.join(tmpdir(), "bb-status-provider-"),
    );
    const scriptPath = path.join(scriptRoot, "status-provider.cjs");
    await writeProviderScript({ scriptPath });

    try {
      await withHarness(
        {
          adapterFactory: (providerId) =>
            createFakeAdapter({
              displayName: providerId,
              id: providerId,
              scriptPath,
            }),
        },
        async (harness) => {
          const project = await createProjectFixture(
            harness,
            "STATUS Data Watch",
          );
          const thread = await createHostThread(harness.api, {
            execution: { permissionMode: "workspace-write" },
            hostId: harness.hostId,
            projectId: project.id,
            workspace: {
              type: "unmanaged",
              path: harness.repoDir,
            },
          });
          const readyThread = await waitForThreadStatus(
            harness.api,
            thread.id,
            "idle",
            DEFAULT_TIMEOUT_MS,
          );
          const socket = new WebSocket(
            `${harness.serverUrl.replace("http", "ws")}/ws`,
          );

          try {
            await waitForSocketOpen({ socket });
            socket.send(
              JSON.stringify({
                type: "subscribe",
                entity: "thread",
                id: `${readyThread.id}:status-data`,
              }),
            );
            await delay({ ms: 25 });

            const broadcast = waitForStatusDataBroadcast({
              socket,
              timeoutMs: DEFAULT_TIMEOUT_MS,
            });
            await sendTextMessage(harness.api, readyThread.id, {
              text: "write_status_data",
            });
            const message = await broadcast;

            expect(message).toMatchObject({
              type: "status-data.changed",
              threadId: readyThread.id,
              key: "worker",
              value: { v: 1 },
              deleted: false,
              previousValue: null,
              previousValuePresent: false,
              writerClientId: null,
              operationId: null,
            });
            expect(typeof message.version).toBe("string");
            await expect(
              fs.readFile(
                path.join(
                  harness.threadStorageRootPath,
                  readyThread.id,
                  "STATUS-data",
                  "worker.json",
                ),
                "utf8",
              ),
            ).resolves.toBe('{"v":1}\n');
            await waitForThreadStatus(
              harness.api,
              readyThread.id,
              "idle",
              TURN_TIMEOUT_MS,
            );
          } finally {
            socket.close();
          }
        },
      );
    } finally {
      await removePathWithRetry(scriptRoot);
    }
  });
});
