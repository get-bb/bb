import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import { buildPluginHost, resolvePluginBuildToolchain } from "@bb/plugin-build";
import { ensurePluginProcessDataDir } from "@bb/process-utils";
import { createAgentRuntime } from "./runtime.js";
import {
  captureFirstPartyProviderDeclarations,
  firstPartyPluginRootDir,
} from "./test/first-party-provider-declarations.js";
import { withBridgeLaunch } from "./test/runtime-test-harness.js";
import type {
  AgentRuntimeBridgeLaunch,
  AgentRuntimeExecutionOptions,
} from "./types.js";

const FAKE_PI = join(
  firstPartyPluginRootDir("provider-pi"),
  "src/bridge/fake-pi-rpc.mjs",
);
const OPTIONS: AgentRuntimeExecutionOptions = {
  model: "fake-provider/fake-model",
  serviceTier: "default",
  reasoningLevel: "medium",
  providerOptions: {},
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
};
const COMPACT_MENTION = {
  start: 0,
  end: 8,
  resource: {
    kind: "command",
    trigger: "/",
    name: "compact",
    source: "command",
    origin: "builtin",
    label: "compact",
    argumentHint: null,
  },
} as const;

let launch: AgentRuntimeBridgeLaunch;

beforeAll(async () => {
  const toolchain = await resolvePluginBuildToolchain(
    join(tmpdir(), "bb-plugin-build-toolchain"),
  );
  const [declarations, build] = await Promise.all([
    captureFirstPartyProviderDeclarations("provider-pi"),
    buildPluginHost(
      firstPartyPluginRootDir("provider-pi"),
      "0.0.0-e2e",
      toolchain,
    ),
  ]);
  const declaration = declarations[0];
  if (declaration === undefined) {
    throw new Error("provider-pi declares no provider");
  }
  const dataDir = await ensurePluginProcessDataDir({
    daemonDataDir: mkdtempSync(join(tmpdir(), "bb-pi-e2e-daemon-")),
    pluginId: "provider-pi",
    kind: "bridge-data",
  });
  launch = {
    pluginId: "provider-pi",
    dataDir,
    source: {
      kind: "artifact",
      digest: build.artifactDigest,
      artifactPath: build.jsPath,
    },
    providerOptions: declaration.experimental_bridgeOptions ?? {},
    envPassthrough: [...(declaration.env?.passthrough ?? [])],
    capabilities: {
      providerInstallation: declaration.maintenance?.installation ?? false,
      supportsServiceTier: declaration.capabilities.supportsServiceTier,
      permissionModes: [...declaration.capabilities.permissionModes],
      supportsThreadArchive: declaration.capabilities.supportsThreadArchive,
      supportsThreadRename: declaration.capabilities.supportsThreadRename,
      fork: declaration.capabilities.fork,
    },
  };
}, 300_000);

let shutdown: (() => Promise<void>) | undefined;

afterEach(async () => {
  await shutdown?.();
  shutdown = undefined;
});

async function waitUntil(predicate: () => boolean, what: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function startPiThread(threadId: string) {
  const work = mkdtempSync(join(tmpdir(), "bb-pi-e2e-"));
  const releasePath = join(work, "release-compaction");
  const events: ThreadEvent[] = [];
  const runtime = withBridgeLaunch(
    createAgentRuntime({
      workspacePath: work,
      getProcessEnv: () => ({
        BB_PI_BRIDGE_COMMAND: process.execPath,
        BB_PI_BRIDGE_ARGS: JSON.stringify([FAKE_PI]),
        BB_PI_BRIDGE_SESSION_DIR: join(work, "sessions"),
        FAKE_PI_COMPACTION_RELEASE_FILE: releasePath,
        FAKE_PI_COMMAND_LOG: join(work, "commands.log"),
      }),
      onEvent: (event: ThreadEvent) => events.push(event),
      onToolCall: async () => ({ contentItems: [], success: true }),
    }),
    launch,
  );
  shutdown = () => runtime.shutdown();
  await runtime.startThread({
    environmentId: "env-1",
    threadId,
    projectId: "project-1",
    providerId: "pi",
    options: OPTIONS,
  });
  const ofThread = () => events.filter((e) => e.threadId === threadId);
  const completed = () =>
    ofThread().filter(
      (e): e is Extract<ThreadEvent, { type: "turn/completed" }> =>
        e.type === "turn/completed",
    );
  const compactionStartedTurnId = () => {
    const started = ofThread().find(
      (e) =>
        e.type === "item/started" &&
        e.item.type === "contextCompaction" &&
        e.scope.kind === "turn",
    );
    return started?.scope.kind === "turn" ? started.scope.turnId : null;
  };
  const replied = (text: string) =>
    JSON.stringify(ofThread()).includes(`Response to: ${text}`);
  let nextRequest = 0;
  const runTurn = (text: string) => {
    nextRequest += 1;
    return runtime.runTurn({
      threadId,
      clientRequestId: `creq_e2${"abcdefghjk"[nextRequest]}2345678`,
      input: [
        {
          type: "text",
          text,
          mentions: text === "/compact" ? [COMPACT_MENTION] : [],
        },
      ],
      options: OPTIONS,
    });
  };
  const steerTurn = (expectedTurnId: string, text: string) => {
    nextRequest += 1;
    return runtime.steerTurn({
      threadId,
      expectedTurnId,
      clientRequestId: `creq_e2${"abcdefghjk"[nextRequest]}2345678`,
      input: [{ type: "text", text, mentions: [] }],
      options: OPTIONS,
    });
  };
  return {
    runtime,
    events: ofThread,
    completed,
    compactionStartedTurnId,
    replied,
    runTurn,
    steerTurn,
    releaseCompaction: () => writeFileSync(releasePath, ""),
  };
}

describe("Pi compaction through the runtime", () => {
  it("the runtime answers busy while a Pi extension compacts, and the retried turn starts after compaction ends", async () => {
    const t = await startPiThread("thr_pie2eext");
    expect(await t.runTurn("/compact-on-settle")).toEqual({
      status: "started",
    });
    await waitUntil(() => t.compactionStartedTurnId() !== null, "compaction");
    const compactionTurnId = t.compactionStartedTurnId() ?? "";

    expect(await t.runTurn("sent during compaction")).toEqual({
      status: "busy",
      message: "The thread is not idle: the agent is compacting context.",
    });
    expect(await t.steerTurn(compactionTurnId, "steered")).toEqual({
      status: "busy",
      message: "The agent is compacting context.",
    });

    t.releaseCompaction();
    await waitUntil(() => t.completed().length >= 2, "compaction turn end");
    expect(t.completed().at(-1)?.scope).toMatchObject({
      turnId: compactionTurnId,
    });

    expect(await t.runTurn("sent during compaction")).toEqual({
      status: "started",
    });
    await waitUntil(
      () => t.completed().length >= 3 && t.replied("sent during compaction"),
      "the retried turn",
    );
    expect(t.completed().map((e) => e.status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
    expect(t.replied("steered")).toBe(false);
  });

  it("the runtime relays Pi's busy refusal for a prompt that races the compaction start, and the retry starts after it ends", async () => {
    const t = await startPiThread("thr_pie2elate");
    expect(await t.runTurn("/compact-on-settle-late")).toEqual({
      status: "started",
    });
    await waitUntil(() => t.completed().length >= 1, "the run to settle");

    expect(await t.runTurn("raced with compaction")).toEqual({
      status: "busy",
      message:
        "Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.",
    });

    t.releaseCompaction();
    await waitUntil(() => t.completed().length >= 2, "compaction turn end");
    expect(t.compactionStartedTurnId()).not.toBeNull();

    expect(await t.runTurn("raced with compaction")).toEqual({
      status: "started",
    });
    await waitUntil(
      () => t.completed().length >= 3 && t.replied("raced with compaction"),
      "the retried turn",
    );
    expect(t.completed().map((e) => e.status)).not.toContain("failed");
  });

  it("the runtime answers busy during bb's /compact and starts the next turn after it ends", async () => {
    const t = await startPiThread("thr_pie2ecmd");
    expect(await t.runTurn("first")).toEqual({ status: "started" });
    await waitUntil(() => t.completed().length >= 1, "the first turn");

    expect(await t.runTurn("/compact")).toEqual({ status: "started" });
    await waitUntil(() => t.compactionStartedTurnId() !== null, "compaction");
    const compactionTurnId = t.compactionStartedTurnId() ?? "";

    expect(await t.runTurn("next turn")).toMatchObject({ status: "busy" });
    expect(await t.steerTurn(compactionTurnId, "steered")).toMatchObject({
      status: "busy",
    });

    t.releaseCompaction();
    await waitUntil(() => t.completed().length >= 2, "compaction turn end");
    expect(await t.runTurn("next turn")).toEqual({ status: "started" });
    await waitUntil(
      () => t.completed().length >= 3 && t.replied("next turn"),
      "the next turn",
    );
    expect(t.completed().map((e) => e.status)).not.toContain("failed");
    expect(t.replied("steered")).toBe(false);
  });
});
