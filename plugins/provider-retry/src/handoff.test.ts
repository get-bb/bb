import { afterEach, describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makeQueueEntry,
  makeThreadResponse,
  makeTurnFailedEvent,
} from "@get-bb/plugin-sdk/testing";
import type { PluginTurnFailedEvent } from "@get-bb/plugin-sdk";
import plugin from "../server.js";
import { readRetryDiagnostic } from "./diagnostics.js";
import {
  buildHandoffPrompt,
  handoffTag,
  type HandoffOffer,
} from "./handoff.js";

const THREAD_ID = "thr_limited";
const REQUEST_ID = "creq_limited";
const NEW_THREAD_ID = "thr_continued";
const RESET_AT_MS = Date.now() + 60 * 60 * 1_000;

interface Scenario {
  status?: "error" | "idle";
  latestRequestId?: string;
  originPluginId?: string | null;
  deleteFails?: boolean;
  spawnFails?: boolean;
  fallbackProviderId?: string | null;
  fallbackAvailable?: boolean;
  queued?: boolean;
}

function rateLimitFailure(): PluginTurnFailedEvent {
  return makeTurnFailedEvent({
    threadId: THREAD_ID,
    requestId: REQUEST_ID,
    errorInfo: {
      category: "rate-limit",
      providerCode: "usage_limit_reached",
      httpStatusCode: 429,
    },
    rateLimits: {
      providerId: "claude-code",
      status: "blocked",
      kind: "subscription-window",
      windows: [
        {
          providerKey: "five_hour",
          label: "Current session",
          status: "blocked",
          resetsAtMs: RESET_AT_MS,
        },
      ],
      reachedReason: "rate_limit_reached",
      overageStatus: null,
      overageReason: null,
    },
  });
}

function overloadFailure(): PluginTurnFailedEvent {
  return makeTurnFailedEvent({
    threadId: THREAD_ID,
    requestId: REQUEST_ID,
    errorInfo: {
      category: "overloaded",
      providerCode: "serverOverloaded",
      httpStatusCode: 529,
    },
    rateLimits: null,
  });
}

function createHost(scenario: Scenario = {}) {
  const queue = [
    makeQueueEntry({
      id: "queued_retry",
      threadId: THREAD_ID,
      sendAt: RESET_AT_MS,
      waitingOn: { kind: "time" },
      payload: {
        kind: "retry",
        retryOfTurnRequestId: REQUEST_ID,
        attempt: 2,
        reason: "Rate limited",
      },
    }),
  ];
  const deleted: string[] = [];
  const host = createFakePluginHost({
    pluginId: "provider-retry",
    sdk: {
      plugins: { experimental_discoverRpc: async () => [] },
      system: {
        config: async () =>
          ({
            generalSettings: {
              fallbackProviderId:
                scenario.fallbackProviderId === undefined
                  ? "codex"
                  : scenario.fallbackProviderId,
            },
          }) as never,
      },
      providers: {
        list: async () =>
          [
            { id: "claude-code", displayName: "Claude Code", available: true },
            {
              id: "codex",
              displayName: "Codex",
              available: scenario.fallbackAvailable ?? true,
            },
          ] as never,
      },
      threads: {
        get: async () =>
          makeThreadResponse({
            id: THREAD_ID,
            projectId: "proj_1",
            environmentId: "env_1",
            providerId: "claude-code",
            title: "Fix the parser",
            status: scenario.status ?? "error",
            originPluginId: scenario.originPluginId ?? null,
          }),
        events: {
          list: async () => [
            {
              data: { requestId: scenario.latestRequestId ?? REQUEST_ID },
            },
          ],
        },
        retry: async () =>
          ({
            ok: true,
            delivery: "queued",
            turnRequestId: REQUEST_ID,
            attempt: 2,
            queuedMessageId: "queued_retry",
            waitingOn: { kind: "time" },
            sendAt: RESET_AT_MS,
          }) as never,
        queue: {
          list: async () =>
            scenario.queued === false
              ? []
              : queue.filter((entry) => !deleted.includes(entry.id)),
        },
        queuedMessages: {
          delete: async (args: { queuedMessageId: string }) => {
            if (scenario.deleteFails) throw new Error("HTTP 404");
            deleted.push(args.queuedMessageId);
            return { ok: true } as never;
          },
        },
        conversationOutline: async () => ({
          maxSeq: 9,
          items: [
            {
              id: "1",
              role: "user" as const,
              preview: "Fix the parser\nfor nested lists",
              attachmentSummary: null,
            },
            {
              id: "2",
              role: "assistant" as const,
              preview: "I changed parse.ts.",
              attachmentSummary: null,
            },
          ],
        }),
        output: async () => ({ output: "Half of the tests pass." }),
        spawn: async () => {
          if (scenario.spawnFails) throw new Error("spawn failed");
          return makeThreadResponse({ id: NEW_THREAD_ID });
        },
      },
    },
  });
  return { ...host, deleted };
}

type Host = ReturnType<typeof createHost>;
const hosts: Host[] = [];

async function started(scenario: Scenario = {}, event = rateLimitFailure()) {
  const host = createHost(scenario);
  hosts.push(host);
  await plugin(host.bb);
  await host.harness.behavior.emitThreadEvent("turn.failed", event);
  return host;
}

function offer(host: Host) {
  return host.harness.callRpc("handoff.get", { threadId: THREAD_ID });
}

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.dispose();
});

describe("usage limit handoff", () => {
  it("offers the fallback provider while a rate-limited thread waits", async () => {
    const host = await started();
    await expect(offer(host)).resolves.toEqual({
      threadId: THREAD_ID,
      continuedIn: null,
      from: { id: "claude-code", name: "Claude Code" },
      to: { id: "codex", name: "Codex" },
      retryAt: RESET_AT_MS,
    });
    expect(
      host.harness.inspection.experimental_rpcInvalidations,
    ).toContainEqual([handoffTag(THREAD_ID)]);
  });

  it("offers no handoff when the thread cannot use one", async () => {
    for (const scenario of [
      { status: "idle" },
      { fallbackProviderId: null },
      { fallbackProviderId: "claude-code" },
      { fallbackAvailable: false },
      { latestRequestId: "creq_newer" },
      { originPluginId: "workflows" },
    ] satisfies Scenario[]) {
      await expect(offer(await started(scenario))).resolves.toBeNull();
    }
    await expect(
      offer(await started({}, overloadFailure())),
    ).resolves.toBeNull();
  });

  it("offers a handoff after a declined rate-limit retry, without a retry time", async () => {
    const host = await started({ queued: false });
    await expect(offer(host)).resolves.toMatchObject({ retryAt: null });
  });

  it("starts one thread on the fallback in the same environment and cancels the retry", async () => {
    const host = await started();
    const [first, second] = await Promise.all([
      host.harness.callRpc("handoff.start", { threadId: THREAD_ID }),
      host.harness.callRpc("handoff.start", { threadId: THREAD_ID }),
    ]);
    expect(first).toEqual({ threadId: NEW_THREAD_ID });
    expect(second).toEqual({ threadId: NEW_THREAD_ID });

    const spawns = host.harness.sdk.callsTo("threads.spawn");
    expect(spawns).toHaveLength(1);
    expect(spawns[0]?.[0]).toMatchObject({
      projectId: "proj_1",
      providerId: "codex",
      title: "Fix the parser",
      environment: { type: "reuse", environmentId: "env_1" },
      origin: "plugin",
      originPluginId: "provider-retry",
    });
    expect(host.deleted).toEqual(["queued_retry"]);
    await expect(offer(host)).resolves.toMatchObject({
      continuedIn: NEW_THREAD_ID,
      retryAt: null,
    });
    await expect(
      host.harness.callRpc("handoff.start", { threadId: THREAD_ID }),
    ).resolves.toEqual({ threadId: NEW_THREAD_ID });
    expect(host.harness.sdk.callsTo("threads.spawn")).toHaveLength(1);
  });

  it("offers a new handoff after a later rate-limit failure", async () => {
    const scenario: Scenario = {};
    const host = await started(scenario);
    await host.harness.callRpc("handoff.start", { threadId: THREAD_ID });
    scenario.latestRequestId = "creq_later";
    await expect(offer(host)).resolves.toBeNull();
    await host.harness.behavior.emitThreadEvent(
      "turn.failed",
      makeTurnFailedEvent({ ...rateLimitFailure(), requestId: "creq_later" }),
    );
    await expect(offer(host)).resolves.toMatchObject({ continuedIn: null });
  });

  it("continues from the CLI and explains when no handoff is possible", async () => {
    const host = await started();
    const result = await host.harness.runCli(["continue", THREAD_ID, "--json"]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout ?? "")).toEqual({
      ok: true,
      threadId: THREAD_ID,
      continuedIn: NEW_THREAD_ID,
      providerId: "codex",
    });

    const idle = await started({ status: "idle" });
    const refused = await idle.harness.runCli([
      "continue",
      THREAD_ID,
      "--json",
    ]);
    expect(refused.exitCode).toBe(1);
    expect(JSON.parse(refused.stdout)).toMatchObject({
      ok: false,
      error: { code: "no_handoff" },
    });
    expect(idle.harness.sdk.callsTo("threads.spawn")).toHaveLength(0);
  });

  it("reads decisions recorded before the rate-limit flag as not rate limited", async () => {
    const host = createHost();
    hosts.push(host);
    await host.bb.storage.kv.set(`decision:${THREAD_ID}`, {
      requestId: REQUEST_ID,
      observedAt: 1,
      availability: { kind: "not-routed" },
      decision: { kind: "decline", reason: "beyond-maximum-wait" },
    });
    await expect(
      readRetryDiagnostic(host.bb, THREAD_ID),
    ).resolves.toMatchObject({ rateLimited: false });
  });
});

describe("usage limit handoff failures", () => {
  it("stops when the retry already started, and starts no thread", async () => {
    const host = await started({ deleteFails: true });
    await expect(
      host.harness.callRpc("handoff.start", { threadId: THREAD_ID }),
    ).rejects.toThrow("already started");
    expect(host.harness.sdk.callsTo("threads.spawn")).toHaveLength(0);
  });

  it("queues the retry again when the new thread fails to start", async () => {
    const host = await started({ spawnFails: true });
    const retriesBefore = host.harness.sdk.callsTo("threads.retry").length;
    await expect(
      host.harness.callRpc("handoff.start", { threadId: THREAD_ID }),
    ).rejects.toThrow("spawn failed");
    expect(host.deleted).toEqual(["queued_retry"]);
    const retries = host.harness.sdk.callsTo("threads.retry");
    expect(retries).toHaveLength(retriesBefore + 1);
    expect(retries.at(-1)?.[0]).toMatchObject({
      threadId: THREAD_ID,
      turnRequestId: REQUEST_ID,
      sendAt: RESET_AT_MS,
    });
  });

  it("returns the new thread when the handoff record cannot be written", async () => {
    const host = await started();
    const set = host.bb.storage.kv.set.bind(host.bb.storage.kv);
    host.bb.storage.kv.set = async (key, value) => {
      if (key.startsWith("handoff:")) throw new Error("disk full");
      return set(key, value);
    };
    await expect(
      host.harness.callRpc("handoff.start", { threadId: THREAD_ID }),
    ).resolves.toEqual({ threadId: NEW_THREAD_ID });
    expect(host.deleted).toEqual(["queued_retry"]);
  });

  it("refreshes the offer when the thread starts a new turn", async () => {
    const host = await started();
    const before = host.harness.inspection.experimental_rpcInvalidations.length;
    await host.harness.behavior.emitThreadEvent("thread.active", {
      thread: makeThreadResponse({ id: THREAD_ID, status: "active" }),
    });
    expect(
      host.harness.inspection.experimental_rpcInvalidations.slice(before),
    ).toContainEqual([handoffTag(THREAD_ID)]);
  });
});

describe("handoff prompt", () => {
  const base: HandoffOffer = {
    threadId: THREAD_ID,
    continuedIn: null,
    from: { id: "claude-code", name: "Claude Code" },
    to: { id: "codex", name: "Codex" },
    retryAt: null,
  };

  it("names the source thread and keeps only the last messages and output", () => {
    const prompt = buildHandoffPrompt({
      offer: base,
      messages: Array.from({ length: 25 }, (_, index) => ({
        role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
        preview: `message ${index}`,
      })),
      output: "x".repeat(5_000),
    });
    expect(prompt).toContain(`Continue the work of thread ${THREAD_ID}.`);
    expect(prompt).toContain("Claude Code, which reached its usage limit");
    expect(prompt).toContain(`bb thread log ${THREAD_ID}`);
    expect(prompt).not.toContain("message 4\n");
    expect(prompt).toContain("User: message 24");
    expect(prompt).toContain("The last 20 messages");
    expect(prompt).toContain(`${"x".repeat(3_997)}...`);
    expect(prompt).not.toContain("x".repeat(3_998));
  });

  it("leaves out the output when the last message already shows it", () => {
    const prompt = buildHandoffPrompt({
      offer: base,
      messages: [
        { role: "user", preview: "Add a script" },
        { role: "assistant", preview: "You've hit your limit" },
      ],
      output: "You've hit your limit\n",
    });
    expect(prompt).not.toContain("The last agent output");
    expect(prompt.match(/You've hit your limit/g)).toHaveLength(1);
  });
});
