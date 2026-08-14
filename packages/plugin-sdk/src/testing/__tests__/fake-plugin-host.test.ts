import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  PLUGIN_CLI_OUTPUT_MAX_BYTES,
  type BbPluginApi,
  type PluginAgentConfigurationContext,
} from "../../backend-contract.js";
import { defineRpcContract } from "../../rpc-contract.js";
import { createFakePluginHost, makeThreadResponse } from "../index.js";

describe("ui.requestInput", () => {
  it("settles a blocking request through the harness", async () => {
    const { bb, harness } = createFakePluginHost();
    const pending = bb.ui.requestInput({
      threadId: "thread-test",
      rendererId: "secret-request",
      title: "Add secrets",
      payload: { fields: ["API_KEY"] },
    });

    expect(harness.pendingInteractions).toHaveLength(1);
    harness.submitInteraction(harness.pendingInteractions[0]!.id, {
      values: { API_KEY: "sentinel" },
    });

    await expect(pending).resolves.toEqual({
      outcome: "submitted",
      value: { values: { API_KEY: "sentinel" } },
    });
    expect(harness.pendingInteractions).toEqual([]);
  });

  it("settles requests on abort and plugin disposal", async () => {
    const first = createFakePluginHost();
    const controller = new AbortController();
    const aborted = first.bb.ui.requestInput(
      {
        threadId: "thread-test",
        rendererId: "form",
        title: "Form",
        payload: null,
      },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(aborted).resolves.toEqual({
      outcome: "cancelled",
      reason: "request-aborted",
    });

    const second = createFakePluginHost();
    const disposed = second.bb.ui.requestInput({
      threadId: "thread-test",
      rendererId: "form",
      title: "Form",
      payload: null,
    });
    await second.harness.dispose();
    await expect(disposed).resolves.toEqual({
      outcome: "cancelled",
      reason: "plugin-disposed",
    });
  });

  it("uses the production validation and error names", () => {
    const { bb } = createFakePluginHost();
    expect(() =>
      bb.ui.requestInput({
        threadId: "",
        rendererId: "form",
        title: "Form",
        payload: null,
      }),
    ).toThrow("ui.requestInput threadId must be a non-empty string");
  });
});

describe("host control plane", () => {
  it("uses validated current-state replacements and read-only tunnel identity", async () => {
    const { bb, harness } = createFakePluginHost({
      sharedPortTunnelIdentities: {
        "host-1": { label: "sawyer-air", baseDomain: "getbb.app" },
      },
    });

    await expect(bb.hosts.ensureSharedPortTunnel("host-1")).resolves.toEqual({
      label: "sawyer-air",
      baseDomain: "getbb.app",
    });
    bb.hosts.declareSharedPorts("host-1", [8080, 3000, 8080]);
    bb.hosts.declareSharedPorts("host-2", [4173]);
    bb.hosts.declareSharedPorts("host-1", [3000]);

    expect(harness.sharedPortDeclarations).toEqual([
      { hostId: "host-1", ports: [3000] },
      { hostId: "host-2", ports: [4173] },
    ]);
    expect(() => bb.hosts.declareSharedPorts("host-3", [0])).toThrow(
      /between 1 and 65535/,
    );

    await harness.dispose();
    expect(harness.sharedPortDeclarations).toEqual([]);
  });
});

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

  it("database() returns one shared database and migrate() is append-only by index", () => {
    const { bb } = createFakePluginHost();
    const db = bb.storage.database();
    bb.storage.migrate(db, [
      "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)",
    ]);
    db.prepare("INSERT INTO notes (body) VALUES (?)").run("hello");

    // A later load appends a statement; the first must not re-run.
    const again = bb.storage.database();
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
      "must be one of: fast, slow",
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
  it("callRpc validates and JSON-normalizes input and output", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "notes" });
    const contract = defineRpcContract({
      echo: {
        input: z.object({ when: z.string() }),
        output: z.object({ got: z.object({ when: z.string() }) }),
      },
    });
    bb.rpc.register(contract, {
      echo: (input) => ({ got: input }),
    });
    const result = await harness.callRpc("echo", {
      when: "1970-01-01T00:00:00.000Z",
    });
    expect(result).toEqual({ got: { when: "1970-01-01T00:00:00.000Z" } });

    await expect(harness.callRpc("missing")).rejects.toThrow(
      'plugin "notes" has no rpc method "missing"',
    );
    await expect(harness.callRpc("missing")).rejects.toMatchObject({
      code: "unknown_method",
    });
  });

  it("matches production validation, handler, and serialization failures", async () => {
    const { bb, harness } = createFakePluginHost();
    let calls = 0;
    const contract = defineRpcContract({
      checked: {
        input: z.object({ value: z.string().min(1) }),
        output: z.object({ value: z.string() }),
      },
      badOutput: {
        input: z.null(),
        output: z.custom<unknown>((value) => typeof value === "string"),
      },
      throws: { input: z.null(), output: z.null() },
      cyclic: { input: z.null(), output: z.any() },
      nonFinite: { input: z.null(), output: z.any() },
    });
    bb.rpc.register(contract, {
      checked(input) {
        calls += 1;
        return input;
      },
      badOutput: () => 1,
      throws: () => {
        throw new Error("boom");
      },
      cyclic: () => {
        const value: { self?: unknown } = {};
        value.self = value;
        return value;
      },
      nonFinite: () => ({ value: Number.POSITIVE_INFINITY }),
    });

    await expect(
      harness.callRpc("checked", { value: "" }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      issues: expect.any(Array),
    });
    expect(calls).toBe(0);
    await expect(harness.callRpc("badOutput")).rejects.toMatchObject({
      code: "invalid_output",
    });
    await expect(harness.callRpc("throws")).rejects.toMatchObject({
      code: "handler_error",
      message: "boom",
    });
    await expect(harness.callRpc("cyclic")).rejects.toMatchObject({
      code: "non_json_result",
    });
    await expect(harness.callRpc("nonFinite")).rejects.toMatchObject({
      code: "non_json_result",
    });
  });

  it("rejects invalid and duplicate registrations", () => {
    const { bb } = createFakePluginHost();
    const listContract = defineRpcContract({
      list: { input: z.null(), output: z.array(z.string()) },
    });
    bb.rpc.register(listContract, { list: () => [] });
    expect(() => bb.rpc.register(listContract, { list: () => [] })).toThrow(
      'rpc method "list" is already registered',
    );
    const badContract = defineRpcContract({
      "bad name": { input: z.null(), output: z.array(z.string()) },
    });
    expect(() =>
      bb.rpc.register(badContract, { "bad name": () => [] }),
    ).toThrow('invalid rpc method name "bad name"');
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

  it("mirrors production output-limit errors without truncating", async () => {
    const { bb, harness } = createFakePluginHost();
    bb.cli.register({
      name: "exporter",
      summary: "Export data",
      run: () => ({
        exitCode: 0,
        stdout: "x".repeat(PLUGIN_CLI_OUTPUT_MAX_BYTES + 1),
      }),
    });

    const human = await harness.runCli([]);
    expect(human).toMatchObject({
      exitCode: 1,
      stdout: "",
      error: {
        code: "plugin_cli_output_too_large",
        maxBytes: PLUGIN_CLI_OUTPUT_MAX_BYTES,
      },
    });
    expect(human.stderr).toContain("use a file/streaming command");

    const machine = await harness.runCli(["--json"]);
    expect(machine.exitCode).toBe(1);
    expect(machine.stderr).toBe("");
    expect(JSON.parse(machine.stdout)).toEqual({ error: machine.error });
  });

  it("uses the production host's reserved CLI names", () => {
    const reservedHost = createFakePluginHost();
    expect(() =>
      reservedHost.bb.cli.register({
        name: "skill",
        summary: "nope",
        run: () => ({ exitCode: 0 }),
      }),
    ).toThrow('cli command name "skill" is reserved by the bb CLI');

    const availableHost = createFakePluginHost();
    expect(() =>
      availableHost.bb.cli.register({
        name: "ui",
        summary: "UI tools",
        run: () => ({ exitCode: 0 }),
      }),
    ).not.toThrow();
  });

  it("rejects a duplicate registration like the production host", () => {
    const { bb } = createFakePluginHost();
    const registration = {
      name: "docs",
      summary: "Docs tools",
      run: () => ({ exitCode: 0 }),
    };
    bb.cli.register(registration);
    expect(() => bb.cli.register(registration)).toThrow(
      "cli command is already registered",
    );
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
    expect(() => bb.background.schedule("sync", "not-cron", () => {})).toThrow(
      'invalid cron "not-cron" for schedule "sync"',
    );

    let runs = 0;
    bb.background.schedule("sync", "*/5 * * * *", () => {
      runs += 1;
    });
    await harness.runSchedule("sync");
    expect(runs).toBe(1);
  });
});

describe("thread events", () => {
  it("emits a typed thread.active payload", async () => {
    const { bb, harness } = createFakePluginHost();
    const seen: string[] = [];
    bb.events.on("thread.active", ({ thread }) => {
      seen.push(`${thread.id}:${thread.status}`);
    });

    const { errors } = await harness.emitThreadEvent("thread.active", {
      thread: makeThreadResponse({ id: "th_active", status: "active" }),
    });

    expect(seen).toEqual(["th_active:active"]);
    expect(errors).toEqual([]);
  });

  it("emitThreadEvent delivers typed payloads and captures handler errors", async () => {
    const { bb, harness } = createFakePluginHost();
    const seen: Array<string | null> = [];
    bb.events.on("thread.idle", ({ thread, lastAssistantText }) => {
      seen.push(`${thread.id}:${lastAssistantText}`);
    });
    bb.events.on("thread.idle", () => {
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
      bb.events.on("thread.unknown" as "thread.idle", () => {}),
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

  it("keeps nested plugin administration available through the backend SDK", async () => {
    const catalog = { pluginCount: 1 };
    const { bb, harness } = createFakePluginHost({
      sdk: {
        plugins: {
          catalog: {
            status: async () => catalog,
          },
        },
      },
    });

    await expect(bb.sdk.plugins.catalog.status()).resolves.toEqual(catalog);
    expect(harness.sdk.callsTo("plugins.catalog.status")).toEqual([[]]);
  });

  it("throws a stub-naming error for unstubbed methods and accepts late stubs", async () => {
    const { bb, harness } = createFakePluginHost();
    expect(() => bb.sdk.projects.list({})).toThrow(
      "bb.sdk.projects.list is not stubbed",
    );
    harness.sdk.stub("projects.list", async () => []);
    await expect(bb.sdk.projects.list({})).resolves.toEqual([]);
    // Both calls were recorded, including the unstubbed one.
    expect(harness.sdk.callsTo("projects.list")).toHaveLength(2);
  });
});

describe("agent tools", () => {
  const configurationContext = {
    thread: {
      id: "thread-test",
      title: null,
      parentThreadId: null,
      sourceThreadId: null,
    },
    project: {
      id: "project-test",
      kind: "standard",
      name: "Test",
      gitRemoteUrl: null,
    },
    environment: {
      id: "environment-test",
      name: null,
      path: "/tmp/test",
      workspaceProvisionType: "unmanaged",
      branchName: null,
    },
    host: { id: "host-test", name: "Test host" },
    provider: { id: "codex", model: "gpt-5" },
    origin: { kind: null, pluginId: null },
  } satisfies PluginAgentConfigurationContext;

  it("validates zod parameters per call and executes with a default context", async () => {
    const { bb, harness } = createFakePluginHost();
    bb.agents.registerTool({
      name: "lookup_doc",
      description: "Look up a doc",
      experimental_statusLabels: {
        pending: "Looking up a doc",
        completed: "Looked up a doc",
      },
      parameters: z.object({ query: z.string().min(1) }),
      execute: ({ query }, ctx) => `${query} for ${ctx.threadId}`,
    });
    expect(harness.registrations.agentTools[0]?.inputSchema).toMatchObject({
      type: "object",
      properties: { query: { type: "string" } },
    });
    expect(
      harness.registrations.agentTools[0]?.experimentalStatusLabels,
    ).toEqual({
      pending: "Looking up a doc",
      completed: "Looked up a doc",
    });
    await expect(
      harness.callAgentTool("lookup_doc", { query: "hi" }),
    ).resolves.toBe("hi for thread-test");
    await expect(
      harness.callAgentTool("lookup_doc", { query: 3 }),
    ).rejects.toThrow('tool "lookup_doc" arguments are invalid');
  });

  it("rejects duplicate keyed registrations like the production host", () => {
    const { bb } = createFakePluginHost();
    const tool = {
      name: "lookup_doc",
      description: "Look up a doc",
      parameters: { type: "object" },
      execute: () => "ok",
    };
    bb.agents.registerTool(tool);
    expect(() => bb.agents.registerTool(tool)).toThrow(
      'tool "lookup_doc" is already registered',
    );
    bb.agents.contributeInstructions(() => "first");
    expect(() => bb.agents.contributeInstructions(() => "second")).toThrow(
      "agent instructions are already registered",
    );
    bb.agents.configure(() => ({ tools: [], skills: [] }));
    expect(() =>
      bb.agents.configure(() => ({ tools: [], skills: [] })),
    ).toThrow("agent configuration is already registered");
  });

  it("resolves conditional tools, skills, context, and capped instructions without rebuilding registrations", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "conditional",
      agentSkillIds: ["alpha-skill", "beta-skill"],
    });
    for (const name of ["alpha_tool", "beta_tool"]) {
      bb.agents.registerTool({
        name,
        description: name,
        parameters: { type: "object" },
        execute: () => name,
      });
    }
    const contexts: PluginAgentConfigurationContext[] = [];
    bb.agents.configure((context) => {
      contexts.push(context);
      const alpha = context.host.id === "host-test";
      return {
        tools: [alpha ? "alpha_tool" : "beta_tool"],
        skills: [alpha ? "alpha-skill" : "beta-skill"],
        instructions:
          `${context.provider.id}:${context.provider.model}:`.padEnd(5000, "x"),
      };
    });

    const alpha = await harness.resolveAgentConfiguration(configurationContext);
    const betaContext: PluginAgentConfigurationContext = {
      ...configurationContext,
      thread: { ...configurationContext.thread, id: "thread-beta" },
      host: { id: "host-beta", name: "Beta host" },
      provider: { id: "claude-code", model: "claude-opus" },
    };
    const beta = await harness.resolveAgentConfiguration(betaContext);

    expect(alpha.tools.map((tool) => tool.name)).toEqual(["alpha_tool"]);
    expect(alpha.skills).toEqual(["alpha-skill"]);
    expect(alpha.instructions).toHaveLength(4096);
    expect(beta.tools.map((tool) => tool.name)).toEqual(["beta_tool"]);
    expect(beta.skills).toEqual(["beta-skill"]);
    expect(contexts).toEqual([configurationContext, betaContext]);
    expect(harness.registrations.agentTools.map((tool) => tool.name)).toEqual([
      "alpha_tool",
      "beta_tool",
    ]);
  });

  it("fails closed for unknown and duplicate configure ids", async () => {
    const unknown = createFakePluginHost({ agentSkillIds: ["known-skill"] });
    unknown.bb.agents.configure(() => ({
      tools: ["missing-tool"],
      skills: ["known-skill"],
    }));
    await expect(
      unknown.harness.resolveAgentConfiguration(configurationContext),
    ).resolves.toEqual({ tools: [], skills: [], instructions: null });
    expect(unknown.harness.logEntries.at(-1)?.message).toContain(
      'unknown tool id "missing-tool"',
    );

    const duplicate = createFakePluginHost({ agentSkillIds: ["known-skill"] });
    duplicate.bb.agents.configure(() => ({
      tools: [],
      skills: ["known-skill", "known-skill"],
    }));
    await duplicate.harness.resolveAgentConfiguration(configurationContext);
    expect(duplicate.harness.logEntries.at(-1)?.message).toContain(
      'duplicate id "known-skill"',
    );
  });
});

describe("dispose", () => {
  it("reloads atomically while preserving storage and the direct harness API", async () => {
    const host = createFakePluginHost({ pluginId: "reloadable" });
    const oldContract = defineRpcContract({
      version: { input: z.null(), output: z.literal("old") },
    });
    host.bb.rpc.register(oldContract, { version: () => "old" as const });
    await host.bb.storage.kv.set("cursor", { page: 2 });
    const oldDatabase = host.bb.storage.database();
    oldDatabase.exec("CREATE TABLE state (value TEXT NOT NULL)");
    oldDatabase.prepare("INSERT INTO state (value) VALUES (?)").run("kept");

    expect(host.harness.behavior.callRpc).toBe(host.harness.callRpc);
    expect(host.harness.inspection.registrations).toBe(
      host.harness.registrations,
    );
    expect(host.harness.lifecycle.dispose).toBe(host.harness.dispose);

    await expect(
      host.harness.lifecycle.reload((bb) => {
        bb.rpc.register(oldContract, { version: () => "old" as const });
        bb.rpc.register(oldContract, { version: () => "old" as const });
      }),
    ).rejects.toThrow('rpc method "version" is already registered');

    // Failed replacement registrations never poison or partially replace the
    // current load.
    await expect(host.harness.callRpc("version")).resolves.toBe("old");
    await expect(host.bb.storage.kv.get("cursor")).resolves.toEqual({
      page: 2,
    });

    const nextContract = defineRpcContract({
      version: { input: z.null(), output: z.literal("new") },
    });
    const replacement = await host.harness.lifecycle.reload(async (bb) => {
      await expect(bb.storage.kv.get("cursor")).resolves.toEqual({ page: 2 });
      expect(
        bb.storage.database().prepare("SELECT value FROM state").get(),
      ).toEqual({ value: "kept" });
      bb.rpc.register(nextContract, { version: () => "new" as const });
    });

    await expect(replacement.harness.callRpc("version")).resolves.toBe("new");
    await expect(host.bb.storage.kv.get("cursor")).rejects.toThrow(
      "used a stale API handle",
    );
    expect(oldDatabase.open).toBe(false);
    await replacement.harness.dispose();
  });

  it("aborts services, runs hooks LIFO, closes the database, and poisons the handle", async () => {
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
    const db = bb.storage.database();
    const { done } = harness.runService("svc");

    await harness.dispose();
    await done;
    expect(order).toEqual(["aborted", "second", "first"]);
    expect(db.open).toBe(false);
    await expect(bb.storage.kv.get("x")).rejects.toThrow(
      "used a stale API handle",
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
