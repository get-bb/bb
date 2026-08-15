/**
 * Phase-5 bridge artifact delivery, server side: path-installing a provider
 * plugin builds and records its provider-bridge artifact, the internal route
 * serves hash-verified bytes to daemons, thread commands attach the
 * `bridgeLaunch` spec for plugin providers (and never for first-party ids),
 * and the bridge policy routes the plugin provider onto the canonical
 * protocol.
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeClientTurnRequestIdNumber } from "@bb/domain";
import type { PromptInput } from "@bb/domain";
import {
  buildThreadStartCommand,
  prepareTurnSubmitCommandPayload,
} from "../../../src/services/threads/thread-commands.js";
import { internalAuthHeaders } from "../../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../../helpers/seed.js";
import { withTestHarness } from "../../helpers/test-app.js";

const PROVIDER_ID = "echo-fixture-agent";

const SERVER_SOURCE = `
  export default function plugin(bb: any) {
    bb.agents.experimental_registerProvider({
      id: ${JSON.stringify(PROVIDER_ID)},
      displayName: "Echo Fixture Agent",
      kind: "agent",
      bridge: { entry: "provider-bridge" },
      capabilities: {
        supportsServiceTier: false,
        supportsHostAiServices: false,
        supportsNativeUserQuestion: false,
        supportsNativeFork: false,
        supportsNativeSessionRewind: false,
        supportsManualCompaction: false,
        permissionModes: ["full"],
        reasoningLevels: ["medium"],
      },
      composerActions: [],
    });
  }
`;

const BRIDGE_SOURCE = `
  export function handleLine(line: string): void {
    process.stdout.write(line);
  }
`;

async function writeProviderPlugin(dir: string, name: string): Promise<string> {
  const rootDir = join(dir, name);
  await mkdir(join(rootDir, "src"), { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name,
      version: "0.1.0",
      bb: {
        name: "Bridge fixture",
        description: "Provider bridge artifact fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
        providerBridge: "./src/provider-bridge.ts",
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), SERVER_SOURCE);
  await writeFile(join(rootDir, "src", "provider-bridge.ts"), BRIDGE_SOURCE);
  return rootDir;
}

function textInput(text: string): PromptInput[] {
  return [{ type: "text", text, mentions: [] }];
}

describe("provider bridge artifact delivery (server)", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "bb-provider-bridge-e2e-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("path-install builds, records, and serves the artifact; thread commands attach bridgeLaunch", async () => {
    await withTestHarness(async (harness) => {
      const rootDir = await writeProviderPlugin(
        workDir,
        "bb-plugin-echo-fixture",
      );
      const entry = await harness.pluginService.installPath(rootDir);
      expect(entry.status).toBe("running");

      // Declaration registered.
      expect(harness.deps.providerRegistry.get(PROVIDER_ID)).toMatchObject({
        source: { kind: "plugin", pluginId: entry.id },
        declaration: { bridge: { entry: "provider-bridge" } },
      });

      // Artifact recorded with the hash of the exact built bytes.
      const artifact = harness.deps.providerBridgeArtifacts.getForPlugin(
        entry.id,
      );
      if (artifact === undefined) {
        throw new Error("expected a recorded provider-bridge artifact");
      }
      const builtBytes = await readFile(
        join(rootDir, "dist", "provider-bridge.mjs"),
      );
      expect(artifact).toEqual({
        sha256: createHash("sha256").update(builtBytes).digest("hex"),
        byteLength: builtBytes.byteLength,
        path: join(rootDir, "dist", "provider-bridge.mjs"),
      });

      // The internal route serves bytes that hash to the requested sha.
      const { host } = seedHostSession(harness.deps, {
        id: "host-provider-bridge",
      });
      const headers = internalAuthHeaders(harness, { hostId: host.id });
      const response = await harness.app.request(
        `/internal/provider-bridges/${artifact.sha256}`,
        { headers },
      );
      expect(response.status).toBe(200);
      const servedBytes = Buffer.from(await response.arrayBuffer());
      expect(createHash("sha256").update(servedBytes).digest("hex")).toBe(
        artifact.sha256,
      );
      expect(servedBytes.byteLength).toBe(artifact.byteLength);

      // Unknown or malformed hashes 404; missing daemon auth is 401.
      expect(
        (
          await harness.app.request(
            `/internal/provider-bridges/${"0".repeat(64)}`,
            { headers },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await harness.app.request("/internal/provider-bridges/not-a-hash", {
            headers,
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await harness.app.request(
            `/internal/provider-bridges/${artifact.sha256}`,
          )
        ).status,
      ).toBe(401);

      // Thread commands attach bridgeLaunch for the plugin provider…
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/echo-fixture",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: PROVIDER_ID,
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-echo-fixture",
        threadId: thread.id,
      });
      const execution = {
        model: "echo-default",
        permissionMode: "full",
        reasoningLevel: "medium",
        serviceTier: "default",
        source: "client/turn/requested",
      } as const;
      const expectedBridgeLaunch = {
        source: {
          kind: "artifact",
          sha256: artifact.sha256,
          byteLength: artifact.byteLength,
        },
        // The declaration's validated execution capabilities ride the launch
        // so the daemon's adapter accepts what the server already offered.
        capabilities: {
          supportsServiceTier: false,
          supportedPermissionModes: ["full"],
        },
      };

      const startCommand = await buildThreadStartCommand(harness.deps, {
        environment,
        execution,
        fork: null,
        permissionEscalation: "ask",
        input: textInput("hello"),
        projectId: project.id,
        providerId: PROVIDER_ID,
        requestId: encodeClientTurnRequestIdNumber({ value: 301 }),
        syncGeneratedTitle: false,
        thread,
      });
      expect(startCommand.bridgeLaunch).toEqual(expectedBridgeLaunch);

      const submitCommand = await prepareTurnSubmitCommandPayload(
        harness.deps,
        {
          environment,
          execution,
          permissionEscalation: "ask",
          input: textInput("continue"),
          target: { mode: "start" },
          thread,
        },
      );
      expect(submitCommand.bridgeLaunch).toEqual(expectedBridgeLaunch);
      expect(submitCommand.resumeContext.bridgeLaunch).toEqual(
        expectedBridgeLaunch,
      );

      // …and disabling the plugin withdraws artifact, bytes, and policy.
      await harness.pluginService.setEnabled(entry.id, false);
      expect(
        harness.deps.providerBridgeArtifacts.getForPlugin(entry.id),
      ).toBeUndefined();
      expect(
        (
          await harness.app.request(
            `/internal/provider-bridges/${artifact.sha256}`,
            { headers },
          )
        ).status,
      ).toBe(404);
    });
  }, 120_000);

  it("first-party takeover registrations never attach bridgeLaunch", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-first-party-no-bridge",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/first-party",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-codex",
        threadId: thread.id,
      });

      const startCommand = await buildThreadStartCommand(harness.deps, {
        environment,
        execution: {
          model: "gpt-5",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
          source: "client/turn/requested",
        },
        fork: null,
        permissionEscalation: "ask",
        input: textInput("hello"),
        projectId: project.id,
        providerId: "codex",
        requestId: encodeClientTurnRequestIdNumber({ value: 302 }),
        syncGeneratedTitle: false,
        thread,
      });
      // Wire-identical to version 122: no artifact recorded for the takeover
      // registration, so the field is absent and daemon-local (bundled)
      // bridge resolution applies.
      expect(startCommand).not.toHaveProperty("bridgeLaunch");
    });
  });
});
