import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { BbPluginApi } from "../../backend-contract.js";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "../index.js";

describe("storage", () => {
  it("kv round-trips JSON, lists by prefix sorted, and enforces the 256KB cap", async () => {
    const { bb } = createFakePluginHost();
    await bb.storage.kv.set("slack:b", { channel: "C1" });
    await bb.storage.kv.set("slack:a", 42);
    await bb.storage.kv.set("other", "x");
    expect(await bb.storage.kv.get("slack:b")).toEqual({ channel: "C1" });
    expect(await bb.storage.kv.list("slack:")).toEqual(["slack:a", "slack:b"]);
    expect(await bb.storage.kv.list()).toEqual(["other", "slack:a", "slack:b"]);
    await bb.storage.kv.delete("slack:a");
    expect(await bb.storage.kv.get("slack:a")).toBeUndefined();

    await expect(
      bb.storage.kv.set("big", "x".repeat(256 * 1024)),
    ).rejects.toThrow(/limit is 262144 \(256KB\)/);
  });

  it("sqlite() returns one shared database and migrate() is append-only by index", () => {
    const { bb } = createFakePluginHost();
    const db = bb.storage.sqlite();
    bb.storage.migrate(db, [
      "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)",
    ]);
    db.prepare("INSERT INTO notes (body) VALUES (?)").run("hello");

    // A later load appends a statement; the first must not re-run.
    const again = bb.storage.sqlite();
    expect(again).toBe(db);
    bb.storage.migrate(again, [
      "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)",
      "ALTER TABLE notes ADD COLUMN starred INTEGER NOT NULL DEFAULT 0",
    ]);
    const rows = again.prepare("SELECT body, starred FROM notes").all();
    expect(rows).toEqual([{ body: "hello", starred: 0 }]);
  });
});

describe("settings", () => {
  function defineSettings(bb: BbPluginApi) {
    return bb.settings.define({
      token: { type: "string", label: "Token", secret: true },
      mode: {
        type: "select",
        label: "Mode",
        options: ["fast", "slow"],
        default: "fast",
      },
      enabled: { type: "boolean", label: "Enabled", default: true },
    });
  }

  it("resolves pre-seeded values, defaults, and type mismatches like the host", async () => {
    const { bb } = createFakePluginHost({
      settings: { token: "xoxb-1", enabled: false },
    });
    const handle = defineSettings(bb);
    expect(await handle.get()).toEqual({
      token: "xoxb-1",
      mode: "fast",
      enabled: false,
    });
  });

  it("setSettings validates, fires onChange with next/prev, and skips no-op updates", async () => {
    const { bb, harness } = createFakePluginHost();
    const handle = defineSettings(bb);
    const changes: Array<{ next: unknown; prev: unknown }> = [];
    handle.onChange((next, prev) => changes.push({ next, prev }));

    await expect(harness.setSettings({ nope: "x" })).rejects.toThrow(
      'unknown setting "nope"',
    );
    await expect(harness.setSettings({ mode: "warp" })).rejects.toThrow(
      'must be one of: fast, slow',
    );

    await harness.setSettings({ token: "xoxb-2", mode: "slow" });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      next: { token: "xoxb-2", mode: "slow", enabled: true },
      prev: { token: undefined, mode: "fast", enabled: true },
    });

    // Same effective values → no listener call.
    await harness.setSettings({ mode: "slow" });
    expect(changes).toHaveLength(1);

    // null unsets → back to the default.
    await harness.setSettings({ mode: null });
    expect(changes).toHaveLength(2);
    expect(await handle.get()).toMatchObject({ mode: "fast" });
  });

  it("rejects duplicate and invalid descriptors at define time", () => {
    const { bb } = createFakePluginHost();
    defineSettings(bb);
    expect(() =>
      bb.settings.define({ token: { type: "string", label: "Again" } }),
    ).toThrow('setting "token" is already defined');
    expect(() =>
      bb.settings.define({
        broken: { type: "select", label: "B", options: ["a"], default: "z" },
      }),
    ).toThrow('default for setting "broken" must be one of its options');
  });
});

describe("rpc", () => {
  it("callRpc JSON-round-trips input and output and rejects unknown methods", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "notes" });
    bb.rpc.register({
      echo: (input: { when: Date }) => ({ got: input, extra: undefined }),
    });
    // Dates become strings on the wire; undefined fields are stripped.
    const result = await harness.callRpc("echo", { when: new Date(0) });
    expect(result).toEqual({ got: { when: "1970-01-01T00:00:00.000Z" } });

    await expect(harness.callRpc("missing")).rejects.toThrow(
      'plugin "notes" has no rpc method "missing"',
    );
  });

  it("rejects invalid and duplicate registrations", () => {
    const { bb } = createFakePluginHost();
    bb.rpc.register({ list: () => [] });
    expect(() => bb.rpc.register({ list: () => [] })).toThrow(
      'rpc method "list" is already registered',
    );
    expect(() => bb.rpc.register({ "bad name": () => [] })).toThrow(
      'invalid rpc method name "bad name"',
    );
  });
});

describe("http", () => {
  it("dispatches to the exact-match route with a real Hono context", async () => {
    const { bb, harness } = createFakePluginHost();
    bb.http.route(
      "POST",
      "/events",
      async (context) => {
        const body = await context.req.json<{ n: number }>();
        return context.json({ doubled: body.n * 2 });
      },
      { auth: "none" },
    );
    const response = await harness.fetchHttp("POST", "/events", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ n: 21 }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ doubled: 42 });

    await expect(harness.fetchHttp("GET", "/events")).rejects.toThrow(
      "no http route GET /events is registered",
    );
  });

  it("maps a throwing handler to the host's 500 shape", async () => {
    const { bb, harness } = createFakePluginHost();
    bb.http.route("GET", "/boom", () => {
      throw new Error("nope");
    });
    const response = await harness.fetchHttp("GET", "/boom");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: "plugin route failed: nope",
    });
  });
});

describe("cli", () => {
  it("normalizes results and maps throws like the host", async () => {
    const { bb, harness } = createFakePluginHost();
    bb.cli.register({
      name: "docs",
      summary: "Docs tools",
      run(argv) {
        if (argv[0] === "crash") throw new Error("bad flag");
        return { exitCode: 0, stdout: `ran ${argv.join(" ")}` };
      },
    });
    expect(await harness.runCli(["search", "x"])).toEqual({
      exitCode: 0,
      stdout: "ran search x",
      stderr: "",
    });
    expect(await harness.runCli(["crash"])).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "bb docs failed: bad flag",
    });
  });

  it("rejects reserved names", () => {
    const { bb } = createFakePluginHost();
    expect(() =>
      bb.cli.register({
        name: "thread",
        summary: "nope",
        run: () => ({ exitCode: 0 }),
      }),
    ).toThrow('cli command name "thread" is reserved by the bb CLI');
  });
});

describe("background", () => {
  it("runService starts once, exposes the AbortController, and resolves on abort", async () => {
    const { bb, harness } = createFakePluginHost();
    let sawAbort = false;
    bb.background.service("watcher", {
      start(signal) {
        return new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            sawAbort = true;
            resolve();
          });
        });
      },
    });
    const { controller, done } = harness.runService("watcher");
    controller.abort();
    await done;
    expect(sawAbort).toBe(true);
  });

  it("treats NeedsConfigurationError (by name) as needs-configuration, not a crash", async () => {
    const { bb, harness } = createFakePluginHost();
    bb.background.service("socket", {
      start() {
        throw Object.assign(new Error("set the token first"), {
          name: "NeedsConfigurationError",
        });
      },
    });
    await harness.runService("socket").done;
    expect(harness.needsConfigurationMessages).toEqual(["set the token first"]);
  });

  it("validates cron expressions at registration and runs schedules on demand", async () => {
    const { bb, harness } = createFakePluginHost();
    expect(() =>
      bb.background.schedule("sync", "not-cron", () => {}),
    ).toThrow('invalid cron "not-cron" for schedule "sync"');

    let runs = 0;
    bb.background.schedule("sync", "*/5 * * * *", () => {
      runs += 1;
    });
    await harness.runSchedule("sync");
    expect(runs).toBe(1);
  });
});

describe("thread events", () => {
  it("emitThreadEvent delivers typed payloads and captures handler errors", async () => {
    const { bb, harness } = createFakePluginHost();
    const seen: Array<string | null> = [];
    bb.on("thread.idle", ({ thread, lastAssistantText }) => {
      seen.push(`${thread.id}:${lastAssistantText}`);
    });
    bb.on("thread.idle", () => {
      throw new Error("handler exploded");
    });
    const { errors } = await harness.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: "th_9" }),
      lastAssistantText: "done",
    });
    expect(seen).toEqual(["th_9:done"]);
    expect(errors).toHaveLength(1);
    expect(harness.logEntries).toContainEqual({
      level: "warn",
      message: "thread.idle handler failed: handler exploded",
    });
  });

  it("rejects unknown events at registration", () => {
    const { bb } = createFakePluginHost();
    expect(() =>
      bb.on("thread.unknown" as "thread.idle", () => {}),
    ).toThrow('unknown event "thread.unknown"');
  });
});

describe("sdk", () => {
  it("records calls with plugin spawn attribution and runs stubs", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "slack-bot",
      sdk: {
        threads: { spawn: async () => ({ id: "th_1" }) },
      },
    });
    const thread = await bb.sdk.threads.spawn({
      projectId: "p1",
      prompt: "hi",
      environment: { type: "project-default" },
    });
    expect(thread).toEqual({ id: "th_1" });
    expect(harness.sdk.callsTo("threads.spawn")).toEqual([
      [
        {
          projectId: "p1",
          prompt: "hi",
          environment: { type: "project-default" },
          origin: "plugin",
          originPluginId: "slack-bot",
        },
      ],
    ]);
  });

  it("throws a stub-naming error for unstubbed methods and accepts late stubs", async () => {
    const { bb, harness } = createFakePluginHost();
    expect(() => bb.sdk.projects.list({})).toThrow(
      'bb.sdk.projects.list is not stubbed',
    );
    harness.sdk.stub("projects.list", async () => []);
    await expect(bb.sdk.projects.list({})).resolves.toEqual([]);
    // Both calls were recorded, including the unstubbed one.
    expect(harness.sdk.callsTo("projects.list")).toHaveLength(2);
  });
});

describe("agent tools", () => {
  it("validates zod parameters per call and executes with a default context", async () => {
    const { bb, harness } = createFakePluginHost();
    bb.agents.registerTool({
      name: "lookup_doc",
      description: "Look up a doc",
      parameters: z.object({ query: z.string().min(1) }),
      execute: ({ query }, ctx) => `${query} for ${ctx.threadId}`,
    });
    expect(harness.registrations.agentTools[0]?.inputSchema).toMatchObject({
      type: "object",
      properties: { query: { type: "string" } },
    });
    await expect(
      harness.callAgentTool("lookup_doc", { query: "hi" }),
    ).resolves.toBe("hi for thread-test");
    await expect(
      harness.callAgentTool("lookup_doc", { query: 3 }),
    ).rejects.toThrow('tool "lookup_doc" arguments are invalid');
  });
});

describe("dispose", () => {
  it("aborts services, runs hooks LIFO, closes sqlite, and poisons the handle", async () => {
    const { bb, harness } = createFakePluginHost();
    const order: string[] = [];
    bb.onDispose(() => {
      order.push("first");
    });
    bb.onDispose(() => {
      order.push("second");
      throw new Error("hook exploded");
    });
    bb.background.service("svc", {
      start(signal) {
        return new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            order.push("aborted");
            resolve();
          });
        });
      },
    });
    const db = bb.storage.sqlite();
    const { done } = harness.runService("svc");

    await harness.dispose();
    await done;
    expect(order).toEqual(["aborted", "second", "first"]);
    expect(db.open).toBe(false);
    await expect(bb.storage.kv.get("x")).rejects.toThrow(
      'used a stale API handle',
    );
    expect(() => bb.sdk).toThrow("stale");
    // A second dispose is a no-op.
    await harness.dispose();
  });
});

describe("realtime and status", () => {
  it("normalizes published payloads and records needs-configuration", () => {
    const { bb, harness } = createFakePluginHost();
    bb.realtime.publish("notes-changed", undefined);
    bb.realtime.publish("notes-changed", { at: new Date(0) });
    expect(harness.realtimeSignals).toEqual([
      { channel: "notes-changed", payload: null },
      {
        channel: "notes-changed",
        payload: { at: "1970-01-01T00:00:00.000Z" },
      },
    ]);
    expect(() => bb.realtime.publish("bad", { boom: 1n })).toThrow(
      "not JSON-serializable",
    );

    bb.status.needsConfiguration("");
    bb.status.needsConfiguration("set a token");
    expect(harness.needsConfigurationMessages).toEqual([
      "needs configuration",
      "set a token",
    ]);
  });
});
