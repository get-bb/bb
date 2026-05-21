import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonValueSchema, type JsonValue } from "@bb/domain";
import { statusStateBroadcastMessageSchema } from "@bb/server-contract";
import {
  StatusDataFileEventState,
  canonicalizeStatusJson,
} from "../../../src/services/threads/status-data-files.js";
import { startStatusStateFileWatcher } from "../../../src/services/threads/status-state-watcher.js";
import type { ServerLogger } from "../../../src/types.js";
import { NotificationHub } from "../../../src/ws/hub.js";

interface MockSocket {
  messages: string[];
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

interface TestWatcherContext {
  events: StatusDataFileEventState;
  logger: ServerLogger;
  rootPath: string;
  socket: MockSocket;
  watcher: Awaited<ReturnType<typeof startStatusStateFileWatcher>>;
}

interface AtomicWriteArgs {
  content: string;
  key: string;
  rootPath: string;
  threadId: string;
}

interface AtomicJsonWriteArgs {
  key: string;
  rootPath: string;
  threadId: string;
  value: JsonValue;
}

interface WaitForBroadcastArgs {
  socket: MockSocket;
  timeoutMs?: number;
}

const contexts: TestWatcherContext[] = [];

function createMockSocket(): MockSocket {
  const messages: string[] = [];
  return {
    messages,
    close() {},
    send(data: string) {
      messages.push(data);
    },
  };
}

function createLogger(): ServerLogger {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function sha256Text(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function createContext(): Promise<TestWatcherContext> {
  const rootPath = await fs.mkdtemp(path.join(tmpdir(), "bb-status-watch-"));
  await fs.mkdir(path.join(rootPath, "thr_watch", "STATUS-data"), {
    recursive: true,
  });
  const hub = new NotificationHub();
  const socket = createMockSocket();
  const logger = createLogger();
  const events = new StatusDataFileEventState();
  hub.subscribe(socket, "thread", "thr_watch:status-data");
  const watcher = await startStatusStateFileWatcher({
    events,
    hub,
    logger,
    rootPath,
  });
  const context = {
    events,
    logger,
    rootPath,
    socket,
    watcher,
  };
  contexts.push(context);
  return context;
}

async function writeStatusFile(args: AtomicWriteArgs): Promise<string> {
  const statusDataRootPath = path.join(
    args.rootPath,
    args.threadId,
    "STATUS-data",
  );
  await fs.mkdir(statusDataRootPath, { recursive: true });
  const tempPath = path.join(
    statusDataRootPath,
    `.${args.key}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  const filePath = path.join(statusDataRootPath, `${args.key}.json`);
  await fs.writeFile(tempPath, args.content);
  await fs.rename(tempPath, filePath);
  return filePath;
}

async function writeStatusJson(args: AtomicJsonWriteArgs): Promise<string> {
  return writeStatusFile({
    content: canonicalizeStatusJson(args.value),
    key: args.key,
    rootPath: args.rootPath,
    threadId: args.threadId,
  });
}

async function waitForBroadcast(args: WaitForBroadcastArgs) {
  const timeoutMs = args.timeoutMs ?? 500;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const message = args.socket.messages.at(-1);
    if (message) {
      return statusStateBroadcastMessageSchema.parse(JSON.parse(message));
    }
    await delay(10);
  }
  throw new Error("Timed out waiting for status-data broadcast");
}

afterEach(async () => {
  const pending = contexts.splice(0);
  await Promise.all(
    pending.map(async (context) => {
      await context.watcher.close();
      context.events.dispose();
      await fs.rm(context.rootPath, { recursive: true, force: true });
    }),
  );
});

describe("status state file watcher", () => {
  it("broadcasts direct filesystem writes on the thread status-data channel", async () => {
    const context = await createContext();
    const content = canonicalizeStatusJson({ done: false });
    await writeStatusFile({
      content,
      key: "tasks",
      rootPath: context.rootPath,
      threadId: "thr_watch",
    });

    await expect(waitForBroadcast({ socket: context.socket })).resolves.toEqual(
      {
        type: "status-data.changed",
        threadId: "thr_watch",
        key: "tasks",
        value: { done: false },
        deleted: false,
        previousValue: null,
        previousValuePresent: false,
        version: sha256Text(content),
        writerClientId: null,
        operationId: null,
      },
    );
  });

  it("logs malformed JSON and does not broadcast it", async () => {
    const context = await createContext();
    await writeStatusFile({
      content: "{bad json\n",
      key: "tasks",
      rootPath: context.rootPath,
      threadId: "thr_watch",
    });

    await vi.waitFor(() => {
      expect(context.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "tasks",
          threadId: "thr_watch",
        }),
        "Ignoring malformed STATUS-data JSON",
      );
    });
    expect(context.socket.messages).toHaveLength(0);
  });

  it("logs invalid key filenames and does not broadcast them", async () => {
    const context = await createContext();
    await writeStatusFile({
      content: "true\n",
      key: "bad:key",
      rootPath: context.rootPath,
      threadId: "thr_watch",
    });

    await vi.waitFor(() => {
      expect(context.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "bad:key",
          threadId: "thr_watch",
        }),
        "Ignoring STATUS-data file with invalid key",
      );
    });
    expect(context.socket.messages).toHaveLength(0);
  });

  it("suppresses filesystem echoes for recently published browser writes", async () => {
    const context = await createContext();
    const key = "browser";
    const content = canonicalizeStatusJson({ source: "browser" });
    const filePath = path.join(
      context.rootPath,
      "thr_watch",
      "STATUS-data",
      `${key}.json`,
    );
    context.events.recordSuppressedFileEvent({
      filePath,
      version: sha256Text(content),
    });

    await writeStatusFile({
      content,
      key,
      rootPath: context.rootPath,
      threadId: "thr_watch",
    });
    await delay(150);

    expect(context.socket.messages).toHaveLength(0);
  });

  it("broadcasts the final file value when writers race on the same key", async () => {
    const context = await createContext();
    await Promise.all([
      writeStatusJson({
        key: "race",
        rootPath: context.rootPath,
        threadId: "thr_watch",
        value: { writer: "a" },
      }),
      writeStatusJson({
        key: "race",
        rootPath: context.rootPath,
        threadId: "thr_watch",
        value: { writer: "b" },
      }),
    ]);
    const filePath = path.join(
      context.rootPath,
      "thr_watch",
      "STATUS-data",
      "race.json",
    );
    const finalContent = await fs.readFile(filePath, "utf8");
    const finalValue = jsonValueSchema.parse(JSON.parse(finalContent));

    await vi.waitFor(async () => {
      const messages = context.socket.messages.map((message) =>
        statusStateBroadcastMessageSchema.parse(JSON.parse(message)),
      );
      expect(messages).toContainEqual(
        expect.objectContaining({
          key: "race",
          value: finalValue,
          version: sha256Text(finalContent),
        }),
      );
    });
  });

  it("broadcasts direct filesystem deletes", async () => {
    const context = await createContext();
    const filePath = await writeStatusJson({
      key: "gone",
      rootPath: context.rootPath,
      threadId: "thr_watch",
      value: ["seed"],
    });
    await waitForBroadcast({ socket: context.socket });
    context.socket.messages.length = 0;

    await fs.rm(filePath);

    await expect(waitForBroadcast({ socket: context.socket })).resolves.toEqual(
      {
        type: "status-data.changed",
        threadId: "thr_watch",
        key: "gone",
        value: null,
        deleted: true,
        previousValue: ["seed"],
        previousValuePresent: true,
        version: null,
        writerClientId: null,
        operationId: null,
      },
    );
  });
});
