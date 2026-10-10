import { createHash } from "node:crypto";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { createPlugin } from "./server.js";
import { bill, stepper } from "./examples.js";
import { uuidv7 } from "./library.js";
import { PACKAGE_FORMAT } from "./app-package.js";

type ThreadState = "live" | "deleted" | "error";
type Host = ReturnType<typeof createFakePluginHost>;

function setup(threads: Record<string, ThreadState> = {}) {
  const state: Record<string, ThreadState> = {
    thr_a: "live",
    thr_b: "live",
    ...threads,
  };
  const forks: Record<string, string> = {};
  const host = createFakePluginHost({
    pluginId: "playgrounds",
    sdk: {
      threads: {
        get: (async ({ threadId }: { threadId: string }) => {
          const s = state[threadId];
          if (s === "error")
            throw Object.assign(new Error("network down"), { status: 503 });
          if (!s || s === "deleted")
            throw Object.assign(new Error("not found"), { status: 404 });
          return makeThreadResponse({
            id: threadId,
            sourceThreadId: forks[threadId] ?? null,
          });
        }) as never,
      },
    },
  });
  createPlugin()(host.bb);
  return { host, state, forks };
}
const hosts: Host[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
});
function tracked(value: ReturnType<typeof setup>) {
  hosts.push(value.host);
  return value;
}
async function publish(
  host: Host,
  threadId: string,
  kind: "html" | "document" = "html",
) {
  const out = await host.harness.behavior.runCli([
    "publish",
    "--thread",
    threadId,
    kind === "html" ? "--playground" : "--document",
    JSON.stringify(kind === "html" ? stepper : bill),
  ]);
  return /id="([^"]+)"/.exec(out.stdout!)![1]!;
}
const cliJson = async (host: Host, argv: string[], threadId?: string) => {
  const out = await host.harness.behavior.runCli(
    argv,
    threadId ? { threadId } : {},
  );
  if (out.exitCode !== 0) throw new Error(out.stderr || out.stdout);
  return JSON.parse(out.stdout!) as Record<string, unknown>;
};
const documented = (html = stepper.html) =>
  JSON.stringify({
    format: PACKAGE_FORMAT,
    version: "1.0.0",
    title: "Stepper",
    summary: "Three steps",
    content: { kind: "html", playground: { ...stepper, html } },
    actions: {
      mode: "documented",
      purpose: "Walk through the steps.",
      actions: [
        {
          name: "next",
          description: "Go forward",
          args: [{ type: "integer", minimum: 1, maximum: 3 }],
          required: 0,
        },
        {
          name: "note",
          description: "Play notes",
          args: [
            {
              type: "object",
              properties: {
                notes: { type: "array", items: { type: "string" } },
              },
              required: ["notes"],
              additionalProperties: false,
            },
          ],
        },
      ],
    },
    requires: { renderer: 1 },
  });

it("saves a playground as an app that survives deleting its source thread and plugin reloads, without widening ownership", async () => {
  const { host } = tracked(setup());
  const { callRpc, emitThreadEvent } = host.harness.behavior;
  const id = await publish(host, "thr_a");
  await callRpc("setState", {
    id,
    threadId: "thr_a",
    clientId: "client-one-123",
    state: { step: 2, take: [1, 2] },
  });
  await expect(
    callRpc("appsSave", { answerId: id, threadId: "thr_b", name: "Stolen" }),
  ).rejects.toThrow("unavailable");
  const saved = (await callRpc("appsSave", {
    answerId: id,
    threadId: "thr_a",
    name: "Repotting",
    description: "Steps",
  })) as { appId: string; requestId: string };
  await emitThreadEvent("thread.archived", {
    thread: makeThreadResponse({ id: "thr_a" }),
  });
  await emitThreadEvent("thread.deleted", {
    thread: makeThreadResponse({ id: "thr_a" }),
  });
  const reloaded = await host.harness.lifecycle.reload(createPlugin());
  hosts.splice(hosts.indexOf(host), 1, reloaded);
  const list = (await reloaded.harness.behavior.callRpc("appsList", {
    query: "repot",
  })) as { id: string; name: string }[];
  expect(list.map((a) => a.name)).toEqual(["Repotting"]);
  const exported = (await reloaded.harness.behavior.callRpc("appsExport", {
    appId: saved.appId,
  })) as { text: string };
  expect(exported.text).toContain("Repot a houseplant");
  expect(exported.text).not.toMatch(/thr_a|take|client-one/);
  await expect(
    reloaded.harness.behavior.callRpc("get", { id, threadId: "thr_a" }),
  ).rejects.toThrow("unavailable");
});

it("resumes a thread's own latest run across version changes, starts fresh on request, and gives forks their own run", async () => {
  const { host, forks } = tracked(setup({ thr_fork: "live" }));
  const { callRpc, emitThreadEvent } = host.harness.behavior;
  const id = await publish(host, "thr_a");
  const { appId } = (await callRpc("appsSave", {
    answerId: id,
    threadId: "thr_a",
  })) as { appId: string };
  const first = (await callRpc("appsOpen", {
    appId,
    threadId: "thr_b",
    fresh: false,
  })) as { runId: string; resumed: boolean; versionLabel: string };
  expect(first).toMatchObject({ resumed: false, versionLabel: "1" });
  await callRpc("setState", {
    id: first.runId,
    threadId: "thr_b",
    clientId: "client-one-123",
    state: { step: 3 },
  });
  const again = (await callRpc("appsOpen", {
    appId,
    threadId: "thr_b",
    fresh: false,
  })) as { runId: string; resumed: boolean };
  expect(again).toMatchObject({ runId: first.runId, resumed: true });

  const detail = (await callRpc("appsDescribe", { appId })) as {
    revision: number;
  };
  const v2 = (await callRpc("appsCreateVersion", {
    appId,
    expectedRevision: detail.revision,
    packageText: documented(),
  })) as { versionLabel: string };
  expect(v2.versionLabel).toBe("1.0.0");
  await expect(
    callRpc("appsCreateVersion", {
      appId,
      expectedRevision: detail.revision,
      packageText: documented("<p>x</p>"),
    }),
  ).rejects.toThrow("changed since");
  const resumed = (await callRpc("appsOpen", {
    appId,
    threadId: "thr_b",
    fresh: false,
  })) as { runId: string; versionLabel: string; selectedVersionLabel: string };
  expect(resumed).toMatchObject({
    runId: first.runId,
    versionLabel: "1",
    selectedVersionLabel: "1.0.0",
  });
  expect(
    await callRpc("getState", { id: first.runId, threadId: "thr_b" }),
  ).toMatchObject({ state: { step: 3 } });
  const fresh = (await callRpc("appsOpen", {
    appId,
    threadId: "thr_b",
    fresh: true,
  })) as { runId: string; versionLabel: string };
  expect(fresh.runId).not.toBe(first.runId);
  expect(fresh.versionLabel).toBe("1.0.0");
  expect(
    await callRpc("getState", { id: fresh.runId, threadId: "thr_b" }),
  ).toMatchObject({ state: null });

  forks.thr_fork = "thr_b";
  await emitThreadEvent("thread.created", {
    thread: makeThreadResponse({ id: "thr_fork", sourceThreadId: "thr_b" }),
  });
  expect(
    await callRpc("getState", { id: first.runId, threadId: "thr_fork" }),
  ).toMatchObject({ state: { step: 3 } });
  expect(
    await callRpc("appsRunInfo", { runId: first.runId, threadId: "thr_fork" }),
  ).toMatchObject({ inherited: true });
  const forkRun = (await callRpc("appsOpen", {
    appId,
    threadId: "thr_fork",
    fresh: false,
  })) as { runId: string; resumed: boolean };
  expect(forkRun.resumed).toBe(false);
  expect([first.runId, fresh.runId]).not.toContain(forkRun.runId);
});

it("keeps runs and remixes working after an app is trashed and purged", async () => {
  const { host } = tracked(setup());
  const { callRpc } = host.harness.behavior;
  const { appId } = (await callRpc("appsImport", { text: documented() })) as {
    appId: string;
  };
  const run = (await callRpc("appsOpen", {
    appId,
    threadId: "thr_a",
    fresh: false,
  })) as { runId: string };
  const remix = (await callRpc("appsRemix", { appId, name: "My stepper" })) as {
    appId: string;
  };
  await expect(callRpc("appsPurge", { appId, confirm: true })).rejects.toThrow(
    "Trash",
  );
  await callRpc("appsTrash", { appId });
  expect(await callRpc("appsList", {})).toHaveLength(1);
  await expect(
    callRpc("appsOpen", { appId, threadId: "thr_b", fresh: false }),
  ).rejects.toThrow("Trash");
  await callRpc("appsRestore", { appId });
  await callRpc("appsTrash", { appId });
  expect(await callRpc("appsPurge", { appId, confirm: true })).toMatchObject({
    purgedVersions: 1,
  });
  expect(
    await callRpc("get", { id: run.runId, threadId: "thr_a" }),
  ).toMatchObject({ kind: "html" });
  expect(
    await callRpc("appsRunInfo", { runId: run.runId, threadId: "thr_a" }),
  ).toMatchObject({
    appAvailable: false,
    agentActions: "documented",
    versionLabel: "1.0.0",
  });
  const remixed = (await callRpc("appsDescribe", { appId: remix.appId })) as {
    version: { origin: { kind: string; appId: string } };
  };
  expect(remixed.version.origin).toMatchObject({ kind: "remix", appId });
});

it("lets agents open apps only in their own thread and reports readiness", async () => {
  const { host } = tracked(setup());
  const { appId } = (await host.harness.behavior.callRpc("appsImport", {
    text: documented(),
  })) as { appId: string };
  const refused = await host.harness.behavior.runCli(
    ["apps", "open", appId, "--thread", "thr_b"],
    { threadId: "thr_a" },
  );
  expect(refused.exitCode).toBe(1);
  expect(refused.stderr).toContain("own thread");
  expect(await host.harness.behavior.callRpc("appsList", {})).toHaveLength(1);
  const opened = await cliJson(host, ["apps", "open", appId], "thr_a");
  expect(opened).toMatchObject({ threadId: "thr_a", readiness: "not-mounted" });
  expect(String(opened.directive)).toBe(
    `::playground{id="${String(opened.runId)}"}`,
  );
});

it("invokes documented actions on an explicit or most recent client, never resending after dispatch", async () => {
  const { host } = tracked(setup());
  const { callRpc } = host.harness.behavior;
  const { appId } = (await callRpc("appsImport", { text: documented() })) as {
    appId: string;
  };
  const { runId } = (await callRpc("appsOpen", {
    appId,
    threadId: "thr_a",
    fresh: false,
  })) as { runId: string };
  const presence = (clientId: string, active: boolean, surface?: "panel") =>
    callRpc("presence", {
      id: runId,
      threadId: "thr_a",
      clientId,
      actions: ["next", "note"],
      active,
      ...(surface ? { surface } : {}),
    });
  const invoke = (input: Record<string, unknown>) =>
    callRpc("appsInvoke", {
      runId,
      threadId: "thr_a",
      action: "next",
      args: [2],
      requestId: uuidv7(),
      ...input,
    });
  await expect(invoke({})).rejects.toThrow("not open anywhere");
  await presence("client-card-1", false);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await presence("client-panel-1", true, "panel");
  expect(
    await callRpc("appsClients", { runId, threadId: "thr_a" }),
  ).toMatchObject({
    clients: [
      { clientId: "client-panel-1", surface: "App panel" },
      { clientId: "client-card-1", surface: "Playground card" },
    ],
  });
  const signals = () =>
    host.harness.inspection.realtimeSignals.filter(
      (s) => s.channel === "command",
    ).length;
  await expect(invoke({ args: [9] })).rejects.toThrow("at most 3");
  await expect(invoke({ action: "jump" })).rejects.toThrow("Unknown action");
  await expect(invoke({ clientId: "client-gone-1" })).rejects.toThrow(
    "no longer showing",
  );
  await expect(
    invoke({ requestId: uuidv7(Date.now() - 31 * 24 * 3600 * 1000) }),
  ).rejects.toThrow("expired");
  await expect(
    invoke({ requestId: uuidv7(Date.now() + 10 * 60 * 1000) }),
  ).rejects.toThrow("future");
  await expect(
    invoke({ requestId: "e85d6718-895b-48e5-8bc4-2a9bd3477895" }),
  ).rejects.toThrow("UUIDv7");
  expect(signals()).toBe(0);

  const requestId = uuidv7();
  const pending = invoke({ requestId, clientId: "client-card-1" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const command = host.harness.inspection.realtimeSignals.at(-1)!;
  expect(command.payload).toMatchObject({
    clientId: "client-card-1",
    action: "next",
  });
  await callRpc("result", {
    cmdId: (command.payload as { cmdId: string }).cmdId,
    clientId: "client-card-1",
    ok: true,
    value: { step: 2, audible: false },
  });
  const done = (await pending) as Record<string, unknown>;
  expect(done).toMatchObject({
    status: "succeeded",
    clientId: "client-card-1",
    surface: "card",
    value: { step: 2 },
    untrusted: true,
    replayed: false,
  });
  expect(String(done.notice)).toContain("Audio activation required");
  expect(await invoke({ requestId, clientId: "client-card-1" })).toMatchObject({
    status: "succeeded",
    replayed: true,
  });
  await expect(
    invoke({ requestId, args: [3], clientId: "client-card-1" }),
  ).rejects.toThrow("different request");
  expect(signals()).toBe(1);

  const defaulted = invoke({ action: "note", args: [{ notes: ["C4"] }] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = host.harness.inspection.realtimeSignals.at(-1)!;
  expect(second.payload).toMatchObject({
    clientId: "client-panel-1",
    action: "note",
  });
  await callRpc("result", {
    cmdId: (second.payload as { cmdId: string }).cmdId,
    clientId: "client-panel-1",
    ok: false,
    error: "no audio",
  });
  expect(await defaulted).toMatchObject({
    status: "failed",
    error: "no audio",
  });

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const lost = uuidv7();
  const waiting = invoke({ requestId: lost });
  await vi.advanceTimersByTimeAsync(10_001);
  expect(await waiting).toMatchObject({ status: "unknown" });
  vi.useRealTimers();
  const before = signals();
  const retried = (await invoke({ requestId: lost })) as Record<
    string,
    unknown
  >;
  expect(retried).toMatchObject({ status: "unknown", replayed: true });
  expect(signals()).toBe(before);
});

it("marks an invocation interrupted by a restart as unknown and never redelivers it", async () => {
  const { host } = tracked(setup());
  const { callRpc } = host.harness.behavior;
  const { appId } = (await callRpc("appsImport", { text: documented() })) as {
    appId: string;
  };
  const { runId } = (await callRpc("appsOpen", {
    appId,
    threadId: "thr_a",
    fresh: false,
  })) as { runId: string };
  await callRpc("presence", {
    id: runId,
    threadId: "thr_a",
    clientId: "client-card-1",
    actions: ["next"],
    active: true,
  });
  const requestId = uuidv7();
  void callRpc("appsInvoke", {
    runId,
    threadId: "thr_a",
    action: "next",
    args: [],
    requestId,
  }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  const reloaded = await host.harness.lifecycle.reload(createPlugin());
  hosts.splice(hosts.indexOf(host), 1, reloaded);
  await reloaded.harness.behavior.callRpc("presence", {
    id: runId,
    threadId: "thr_a",
    clientId: "client-card-1",
    actions: ["next"],
    active: true,
  });
  const commands = () =>
    reloaded.harness.inspection.realtimeSignals.filter(
      (s) => s.channel === "command",
    ).length;
  const before = commands();
  const result = await reloaded.harness.behavior.callRpc("appsInvoke", {
    runId,
    threadId: "thr_a",
    action: "next",
    args: [],
    requestId,
  });
  expect(result).toMatchObject({ status: "unknown", replayed: true });
  expect(commands()).toBe(before);
});

it("cleans up runs in deleted threads through the recheck, the delete event, and startup reconciliation, keeping data on transient failures", async () => {
  const { host, state } = tracked(setup({ thr_c: "live", thr_d: "live" }));
  const { callRpc, emitThreadEvent } = host.harness.behavior;
  const { appId } = (await callRpc("appsImport", { text: documented() })) as {
    appId: string;
  };

  state.thr_c = "error";
  const requestId = uuidv7();
  await expect(
    callRpc("appsOpen", { appId, threadId: "thr_c", fresh: false, requestId }),
  ).rejects.toThrow("Could not confirm");
  state.thr_c = "deleted";
  await expect(
    callRpc("appsOpen", { appId, threadId: "thr_c", fresh: false, requestId }),
  ).rejects.toThrow("deleted");

  const open = (await callRpc("appsOpen", {
    appId,
    threadId: "thr_d",
    fresh: false,
    requestId: uuidv7(),
  })) as { runId: string; requestId: string };
  state.thr_d = "error";
  await expect(
    callRpc("appsOpen", {
      appId,
      threadId: "thr_d",
      fresh: false,
      requestId: open.requestId,
    }),
  ).rejects.toThrow("Could not confirm");
  expect(
    await callRpc("get", { id: open.runId, threadId: "thr_d" }),
  ).toMatchObject({ kind: "html" });
  state.thr_d = "live";
  await emitThreadEvent("thread.deleted", {
    thread: makeThreadResponse({ id: "thr_d" }),
  });
  state.thr_d = "deleted";
  await expect(
    callRpc("appsOpen", {
      appId,
      threadId: "thr_d",
      fresh: false,
      requestId: open.requestId,
    }),
  ).rejects.toThrow("deleted");
  await expect(
    callRpc("get", { id: open.runId, threadId: "thr_d" }),
  ).rejects.toThrow("unavailable");

  const offline = (await callRpc("appsOpen", {
    appId,
    threadId: "thr_b",
    fresh: false,
  })) as { runId: string };
  const kept = (await callRpc("appsOpen", {
    appId,
    threadId: "thr_a",
    fresh: false,
  })) as { runId: string };
  state.thr_b = "deleted";
  state.thr_a = "error";
  const reloaded = await host.harness.lifecycle.reload(createPlugin());
  hosts.splice(hosts.indexOf(host), 1, reloaded);
  const service = reloaded.harness.behavior.runService("library-reconcile");
  await vi.waitFor(async () => {
    await expect(
      reloaded.harness.behavior.callRpc("get", {
        id: offline.runId,
        threadId: "thr_b",
      }),
    ).rejects.toThrow("unavailable");
  });
  expect(
    await reloaded.harness.behavior.callRpc("get", {
      id: kept.runId,
      threadId: "thr_a",
    }),
  ).toMatchObject({ kind: "html" });
  service.controller.abort();
  await service.done;
});

it("bounds packages, exports stored bytes verbatim, and rejects unsupported packages before writing", async () => {
  const { host } = tracked(setup());
  const { callRpc } = host.harness.behavior;
  const html = 'é"<\u0001'.repeat(100_000);
  const id = /id="([^"]+)"/.exec(
    (
      await host.harness.behavior.runCli([
        "publish",
        "--thread",
        "thr_a",
        "--playground",
        JSON.stringify({ title: "Big", html }),
      ])
    ).stdout!,
  )![1]!;
  const { appId } = (await callRpc("appsSave", {
    answerId: id,
    threadId: "thr_a",
  })) as { appId: string };
  const { runId } = (await callRpc("appsOpen", {
    appId,
    threadId: "thr_a",
    fresh: false,
  })) as { runId: string };
  await callRpc("setState", {
    id: runId,
    threadId: "thr_a",
    clientId: "client-one-123",
    state: { take: [1] },
  });
  const one = (await callRpc("appsExport", { appId })) as {
    text: string;
    digest: string;
    bytes: number;
  };
  const two = (await callRpc("appsExport", { appId })) as {
    text: string;
    digest: string;
  };
  expect(two.text).toBe(one.text);
  expect(createHash("sha256").update(one.text, "utf8").digest("hex")).toBe(
    one.digest,
  );
  expect(one.bytes).toBeLessThanOrEqual(4 * 1024 * 1024);
  expect(one.text).not.toContain("take");
  const big = await host.harness.behavior.runCli(["apps", "export", appId]);
  expect(big.stderr).toContain("--chunk 0");
  const chunks: string[] = [];
  for (let i = 0; ; i++) {
    const part = await host.harness.behavior.runCli([
      "apps",
      "export",
      appId,
      "--chunk",
      String(i),
    ]);
    if (part.exitCode !== 0) break;
    chunks.push(part.stdout!);
  }
  expect(chunks.join("")).toBe(one.text);
  const imported = (await callRpc("appsImport", { text: one.text })) as {
    appId: string;
  };
  expect(
    (
      (await callRpc("appsExport", { appId: imported.appId })) as {
        digest: string;
      }
    ).digest,
  ).toBe(one.digest);

  const pkg = JSON.parse(documented()) as Record<string, unknown>;
  for (const bad of [
    { ...pkg, requires: { renderer: 2 } },
    { ...pkg, format: "bb.playground-app/9" },
    { ...pkg, requires: { renderer: 1, network: true } },
    {
      ...pkg,
      actions: {
        mode: "documented",
        purpose: "x",
        actions: [
          {
            name: "go",
            description: "x",
            args: [{ $ref: "https://example.com/s.json" }],
          },
        ],
      },
    },
  ])
    await expect(
      callRpc("appsImport", { text: JSON.stringify(bad) }),
    ).rejects.toThrow();
  await expect(
    callRpc("appsImport", { text: " ".repeat(4 * 1024 * 1024 + 1) }),
  ).rejects.toThrow("limited");
  expect(await callRpc("appsList", {})).toHaveLength(2);
  const native = await publish(host, "thr_a", "document");
  const nativeApp = (await callRpc("appsSave", {
    answerId: native,
    threadId: "thr_a",
  })) as { appId: string };
  expect(
    await callRpc("appsDescribe", { appId: nativeApp.appId }),
  ).toMatchObject({
    agentActions: "documented",
    version: { actions: { actions: [{ name: "set" }, { name: "reset" }] } },
  });
});
