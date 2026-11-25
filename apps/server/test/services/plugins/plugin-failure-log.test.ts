import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../src/errors.js";
import { getProviderStates } from "../../../src/services/system/provider-states.js";
import { threadScope } from "@bb/domain";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import { internalAuthHeaders } from "../../helpers/commands.js";
import { registerHostRpcResponder } from "../../helpers/host-rpc.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../../helpers/seed.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const BASE = "http://127.0.0.1:3334";

const PROVIDER_DECLARATION = `{
  id: "failqa",
  displayName: "Fail QA",
  capabilities: {
    supportsServiceTier: false,
    supportsNativeUserQuestion: false,
    fork: "none",
    supportsManualCompaction: false,
    supportsThreadArchive: false,
    supportsThreadRename: false,
    permissionModes: ["full"],
    reasoningLevels: ["none"],
  },
  composerActions: [],
  deriveProviderOptions() {
    throw new Error("options exploded");
  },
}`;

const HOST_SOURCE = `
  const schema = { "~standard": { version: 1, vendor: "test", validate(value) { return { value }; } } };
  export default {
    experimental_apiVersion: 1,
    contract: { ping: { input: schema, output: schema } },
    handlers: { ping: (input) => input },
  };
`;

const BRIDGE_PROVIDER_SOURCE = `export default function plugin(bb: any) {
  bb.providers.register({
    id: "bridgefail",
    displayName: "Bridge Fail",
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      fork: "none",
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      permissionModes: ["full"],
      reasoningLevels: ["none"],
    },
    maintenance: { health: true },
    composerActions: [],
  });
}`;

const BRIDGE_PROVIDER_MANIFEST = {
  experimental_providers: [
    { kind: "agent", id: "bridgefail", displayName: "Bridge Fail" },
  ],
};

const BRIDGE_EXIT_MESSAGE =
  'Provider "bridgefail" exited unexpectedly (code 1)\nstderr: its host artifact exports no "experimental_providerBridge"';

interface PluginLogLine {
  level: string;
  message: string;
  stack?: string;
}

interface FailureCase {
  name: string;
  serverSource: string;
  hostSource?: string;
  manifest?: Record<string, unknown>;
  trigger(harness: TestAppHarness, pluginId: string): Promise<void>;
  expected: { level: string; message: string; stack?: string };
}

async function writePlugin(
  dir: string,
  name: string,
  failure: Pick<FailureCase, "serverSource" | "hostSource" | "manifest">,
): Promise<string> {
  const { serverSource, hostSource } = failure;
  const rootDir = join(dir, name);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: `bb-plugin-${name}`,
      version: "0.1.0",
      bb: {
        name: "Failure fixture",
        description: "Fails in one plugin callback.",
        branding: { icon: "Zap" },
        server: "./server.ts",
        ...(hostSource === undefined ? {} : { host: "./host.ts" }),
        ...failure.manifest,
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), serverSource);
  if (hostSource !== undefined) {
    await writeFile(join(rootDir, "host.ts"), hostSource);
  }
  return rootDir;
}

function hostGeneration(harness: TestAppHarness, pluginId: string): string {
  const generation = harness.pluginService
    .listHostArtifactGenerations()
    .find((entry) => entry.pluginId === pluginId)?.generation;
  if (generation === undefined) throw new Error("missing host generation");
  return generation;
}

const FAILURES: FailureCase[] = [
  {
    name: "factory-throw",
    serverSource: `export default function plugin() { throw new Error("factory exploded"); }`,
    trigger: async () => {},
    expected: {
      level: "warn",
      message: "failed to load: factory exploded",
      stack: "Error: factory exploded",
    },
  },
  {
    name: "install-throw",
    serverSource: `export default function plugin(bb: any) {
      bb.onInstall(() => { throw new Error("install exploded"); });
    }`,
    trigger: async () => {},
    expected: {
      level: "warn",
      message: "install handler failed: install exploded",
      stack: "Error: install exploded",
    },
  },
  {
    name: "service-crash",
    serverSource: `export default function plugin(bb: any) {
      bb.background.service("sync", {
        async start() { throw new Error("service exploded"); },
      });
    }`,
    trigger: async (harness, pluginId) => {
      await vi.waitFor(() =>
        expect(
          harness.pluginService
            .list()
            .find((plugin) => plugin.id === pluginId)
            ?.services.some((service) => service.state === "backoff"),
        ).toBe(true),
      );
    },
    expected: {
      level: "warn",
      message: expect.stringMatching(
        /^service sync crashed: service exploded — restarting in \d+ms$/u,
      ),
    },
  },
  {
    name: "rpc-throw",
    serverSource: `export default function plugin(bb: any) {
      const schema = { "~standard": { version: 1, vendor: "test", validate(value: unknown) { return { value }; } } };
      bb.rpc.register(
        { boom: { input: schema, output: schema } },
        { boom() { throw new Error("rpc exploded"); } },
      );
    }`,
    trigger: async (harness, pluginId) => {
      await harness.app.request(`${BASE}/api/v1/plugins/${pluginId}/rpc/boom`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "null",
      });
    },
    expected: {
      level: "warn",
      message: "rpc boom failed: rpc exploded",
      stack: "Error: rpc exploded",
    },
  },
  {
    name: "cli-throw",
    serverSource: `export default function plugin(bb: any) {
      bb.cli.register({
        name: "failcli",
        summary: "Fails",
        run() { throw new Error("cli exploded"); },
      });
    }`,
    trigger: async (harness, pluginId) => {
      await harness.app.request(`${BASE}/api/v1/plugins/${pluginId}/cli`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ argv: ["--json"] }),
      });
    },
    expected: {
      level: "warn",
      message: "cli failcli failed: cli exploded",
      stack: "Error: cli exploded",
    },
  },
  {
    name: "instructions-throw",
    serverSource: `export default function plugin(bb: any) {
      bb.agents.contributeInstructions(() => { throw new Error("instructions exploded"); });
    }`,
    trigger: async (harness, pluginId) => {
      const contribution = harness.pluginService
        .listInstructionContributions()
        .find((entry) => entry.pluginId === pluginId);
      expect(
        contribution?.provider({ threadId: "thr_one", projectId: "proj_one" }),
      ).toBeNull();
    },
    expected: {
      level: "warn",
      message:
        "contributeInstructions provider failed for thread thr_one; contributing nothing: instructions exploded",
      stack: "Error: instructions exploded",
    },
  },
  {
    name: "provider-options-throw",
    serverSource: `export default function plugin(bb: any) {
      bb.providers.register(${PROVIDER_DECLARATION});
    }`,
    hostSource: HOST_SOURCE,
    manifest: {
      experimental_providers: [
        { kind: "agent", id: "failqa", displayName: "Fail QA" },
      ],
    },
    trigger: async (harness, pluginId) => {
      const registration = harness.deps.providerRegistry.get("failqa");
      let thrown: unknown;
      try {
        registration?.deriveProviderOptions({
          threadId: "thr_one",
          projectId: "proj_one",
          model: "default",
          permissionMode: "full",
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ApiError);
      expect(thrown).toMatchObject({
        status: 502,
        body: {
          code: "provider_options_failed",
          message: `The "${pluginId}" plugin's deriveProviderOptions for provider "failqa" failed: options exploded`,
          details: { pluginId, providerId: "failqa" },
        },
      });
    },
    expected: {
      level: "warn",
      message:
        'provider "failqa" deriveProviderOptions failed for thread thr_one: options exploded',
      stack: "Error: options exploded",
    },
  },
  {
    name: "bridge-exit-health",
    serverSource: BRIDGE_PROVIDER_SOURCE,
    hostSource: HOST_SOURCE,
    manifest: BRIDGE_PROVIDER_MANIFEST,
    trigger: async (harness, pluginId) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host_bridge",
      });
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          if (request.command.type !== "provider.health") {
            throw new Error(`unexpected ${request.command.type}`);
          }
          throw Object.assign(new Error(BRIDGE_EXIT_MESSAGE), {
            code: "provider_process_exited",
          });
        },
      });
      const { providers } = await getProviderStates(harness.deps, {
        hostId: host.id,
      });
      expect(
        providers.find((provider) => provider.providerId === "bridgefail"),
      ).toMatchObject({
        status: "unknown",
        statusMessage:
          'Provider readiness could not be checked: Provider "bridgefail" exited unexpectedly (code 1)',
      });
      expect(
        harness.pluginService.list().find((plugin) => plugin.id === pluginId),
      ).toMatchObject({
        status: "running",
        statusDetail:
          'provider "bridgefail" provider.health failed: Provider "bridgefail" exited unexpectedly (code 1)',
      });
    },
    expected: {
      level: "warn",
      message: `provider "bridgefail" provider.health failed on host host_bridge: ${BRIDGE_EXIT_MESSAGE}`,
    },
  },
  {
    name: "bridge-exit-session",
    serverSource: BRIDGE_PROVIDER_SOURCE,
    hostSource: HOST_SOURCE,
    manifest: BRIDGE_PROVIDER_MANIFEST,
    trigger: async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host_bridge",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "bridgefail",
        status: "active",
      });
      const response = await harness.app.request("/internal/session/events", {
        method: "POST",
        headers: internalAuthHeaders(harness),
        body: JSON.stringify({
          sessionId: session.id,
          eventGroups: groupHostDaemonEvents([
            {
              threadId: thread.id,
              event: {
                type: "system/error",
                threadId: thread.id,
                scope: threadScope(),
                code: "provider_process_exited",
                message:
                  'Provider "bridgefail" exited unexpectedly with code 1',
                detail: "stderr:\nTypeError: bridge exploded",
              },
            },
          ]),
        }),
      });
      expect(response.status).toBe(200);
    },
    expected: {
      level: "warn",
      message: expect.stringMatching(
        /^provider "bridgefail" session for thread \S+ failed on host host_bridge: Provider "bridgefail" exited unexpectedly with code 1\nstderr:\nTypeError: bridge exploded$/u,
      ),
    },
  },
  {
    name: "host-stderr",
    serverSource: `export default function plugin() {}`,
    hostSource: HOST_SOURCE,
    trigger: async (harness, pluginId) => {
      harness.pluginService.handleHostWorkerOutput({
        authenticatedHostId: "host_one",
        pluginId,
        generation: hostGeneration(harness, pluginId),
        stream: "stderr",
        line: "TypeError: host exploded",
      });
    },
    expected: {
      level: "warn",
      message: "host host_one stderr: TypeError: host exploded",
    },
  },
  {
    name: "host-stdout",
    serverSource: `export default function plugin() {}`,
    hostSource: HOST_SOURCE,
    trigger: async (harness, pluginId) => {
      harness.pluginService.handleHostWorkerOutput({
        authenticatedHostId: "host_one",
        pluginId,
        generation: hostGeneration(harness, pluginId),
        stream: "stdout",
        line: "debug output",
      });
    },
    expected: { level: "info", message: "host host_one stdout: debug output" },
  },
  {
    name: "host-exit",
    serverSource: `export default function plugin() {}`,
    hostSource: HOST_SOURCE,
    trigger: async (harness, pluginId) => {
      harness.pluginService.handleHostWorkerExit({
        authenticatedHostId: "host_one",
        pluginId,
        generation: hostGeneration(harness, pluginId),
        reason: "host plugin worker exited (1)",
      });
    },
    expected: {
      level: "warn",
      message:
        "host worker on host_one stopped unexpectedly: host plugin worker exited (1)",
    },
  },
];

describe("plugin failures reach the plugin's own log", () => {
  let harness: TestAppHarness;

  beforeEach(async () => {
    harness = await createTestAppHarness();
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  it.each(FAILURES)("$name is written to bb plugin logs", async (failure) => {
    const { name, trigger, expected } = failure;
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      name,
      failure,
    );
    await harness.pluginService.installPath(rootDir).catch(() => undefined);
    await trigger(harness, name);
    const lines = ((await harness.pluginService.readLogTail(name, 100)) ?? [])
      .map((line) => JSON.parse(line) as PluginLogLine)
      .map(({ level, message, stack }) => ({
        level,
        message,
        ...(stack === undefined ? {} : { stack: stack.split("\n")[0] }),
      }));
    expect(lines).toContainEqual(expected);
  });
});
