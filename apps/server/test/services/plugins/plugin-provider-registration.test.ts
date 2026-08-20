import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listSystemProviderInfos } from "../../../src/services/system/execution-options.js";
import {
  resolveCreateThreadExecutionDefaults,
  resolveWorkflowsEnabledPolicy,
} from "../../../src/services/threads/thread-default-policy.js";
import { withTestHarness } from "../../helpers/test-app.js";

/**
 * A provider fixture ships a bridge by default — as a `bb.host` artifact
 * export, like every provider plugin — because a declaration without an
 * implementation is refused: `withBridge: false` is how a test asks for that
 * refusal.
 */
async function writePlugin(
  dir: string,
  options: {
    bridgeSource?: string;
    name: string;
    serverSource: string;
    withBridge?: boolean;
  },
): Promise<string> {
  const withBridge = options.withBridge ?? true;
  const rootDir = join(dir, options.name);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: options.name,
      version: "0.1.0",
      bb: {
        name: "Provider fixture",
        description: "Provider registration plugin fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
        ...(withBridge ? { host: "./bridge.ts" } : {}),
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  if (withBridge) {
    await writeFile(
      join(rootDir, "bridge.ts"),
      // Shaped like a bridge export without importing the SDK: the fixture
      // lives outside the workspace, and what matters here is that the
      // manifest declares a buildable bb.host artifact.
      options.bridgeSource ??
        "export const experimental_providerBridge = { experimental_apiVersion: 1, handleLine: () => undefined };\n",
    );
  }
  return rootDir;
}

const REGISTER_PROVIDER_SOURCE = (id: string): string => `
  export default function plugin(bb: any) {
    bb.agents.experimental_registerProvider({
      id: ${JSON.stringify(id)},
      displayName: "My Remote Agent",
      icon: "./icons/agent.svg",
      capabilities: {
        experimental_providerHealth: true,
        experimental_providerUsage: true,
        supportsServiceTier: true,
        supportsNativeUserQuestion: true,
        fork: "tip",
        supportsManualCompaction: true,
        supportsThreadArchive: false,
        supportsThreadRename: false,
        supportsWorkflows: false,
        permissionModes: ["accept-edits", "full"],
        reasoningLevels: ["low", "medium", "high"],
      },
      composerActions: ["plan"],
    });
  }
`;

describe("bb.agents.experimental_registerProvider (server)", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-provider-test-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("adds the provider to the composed listing and removes it when the plugin is disabled", async () => {
    await withTestHarness(async (harness) => {
      const notifySystem = vi.spyOn(harness.deps.hub, "notifySystem");
      const rootDir = await writePlugin(workDir, {
        name: "bb-plugin-remote-agent",
        serverSource: REGISTER_PROVIDER_SOURCE("my-remote-agent"),
      });
      const entry = await harness.pluginService.installPath(rootDir);
      expect(entry.status).toBe("running");
      expect(notifySystem).toHaveBeenCalledWith([
        "plugins-changed",
        "provider-registrations-changed",
      ]);

      const registration = harness.deps.providerRegistry.get("my-remote-agent");
      expect(registration).toMatchObject({
        source: { kind: "plugin", pluginId: entry.id },
        info: {
          id: "my-remote-agent",
          displayName: "My Remote Agent",
          available: true,
          logoUrl: "/api/v1/system/providers/my-remote-agent/logo",
          experimental_providerHealth: true,
          experimental_providerUsage: true,
          capabilities: {
            supportsThreadArchive: false,
            supportsThreadRename: false,
            supportsServiceTier: true,
            supportsNativeUserQuestion: true,
            supportsFork: true,
            permissionModes: ["accept-edits", "full"],
          },
          composerActions: [
            { kind: "skills", trigger: "/" },
            {
              kind: "plan",
              command: { trigger: "/", name: "plan", trailingText: " " },
            },
          ],
        },
        serverCapabilities: {
          supportsWorkflows: false,
          reasoningLevels: ["low", "medium", "high"],
        },
      });
      // Backend-only declared facts land on serverCapabilities.
      expect(registration?.serverCapabilities.supportsManualCompaction).toBe(
        true,
      );

      // The composed provider listing (GET /system/providers path) includes
      // the plugin provider next to the core catalog.
      const providers = await listSystemProviderInfos(harness.deps, {});
      expect(providers.map((provider) => provider.id)).toContain(
        "my-remote-agent",
      );

      // Disabling the plugin runs its dispose hooks and removes the provider.
      notifySystem.mockClear();
      await harness.pluginService.setEnabled(entry.id, false);
      expect(notifySystem).toHaveBeenCalledWith([
        "plugins-changed",
        "provider-registrations-changed",
      ]);
      expect(harness.deps.providerRegistry.get("my-remote-agent")).toBeNull();
      const afterDisable = await listSystemProviderInfos(harness.deps, {});
      expect(afterDisable.map((provider) => provider.id)).not.toContain(
        "my-remote-agent",
      );
      notifySystem.mockRestore();
    });
  });

  it("keeps a failed provider in the listing as unavailable", async () => {
    await withTestHarness(async (harness) => {
      const rootDir = await writePlugin(workDir, {
        name: "bb-plugin-failed-agent",
        serverSource: REGISTER_PROVIDER_SOURCE("failed-agent"),
        bridgeSource: 'import "missing-provider-runtime";\n',
      });
      const entry = await harness.pluginService.installPath(rootDir);

      expect(entry.status).toBe("error");
      expect(entry.statusDetail).toContain("Could not resolve");
      expect(harness.deps.providerRegistry.get("failed-agent")?.info).toEqual(
        expect.objectContaining({
          id: "failed-agent",
          displayName: "My Remote Agent",
          available: false,
        }),
      );
      expect(
        (await listSystemProviderInfos(harness.deps, {})).find(
          (provider) => provider.id === "failed-agent",
        ),
      ).toEqual(expect.objectContaining({ available: false }));

      await writeFile(
        join(rootDir, "bridge.ts"),
        "export const experimental_providerBridge = { experimental_apiVersion: 1, handleLine: () => undefined };\n",
      );
      await harness.pluginService.reload(entry.id);
      expect(
        harness.pluginService.list().find((plugin) => plugin.id === entry.id)
          ?.status,
      ).toBe("running");
      expect(
        harness.deps.providerRegistry.get("failed-agent")?.info.available,
      ).toBe(true);
      expect(
        harness.deps.providerRegistry
          .list()
          .filter((provider) => provider.info.id === "failed-agent"),
      ).toHaveLength(1);

      await harness.pluginService.setEnabled(entry.id, false);
      expect(harness.deps.providerRegistry.get("failed-agent")).toBeNull();
    });
  });

  it("makes the registered provider usable by thread policy end to end", async () => {
    await withTestHarness(async (harness) => {
      const rootDir = await writePlugin(workDir, {
        name: "bb-plugin-policy-agent",
        serverSource: REGISTER_PROVIDER_SOURCE("policy-agent"),
      });
      const entry = await harness.pluginService.installPath(rootDir);
      expect(entry.status).toBe("running");
      const registry = harness.deps.providerRegistry;

      // The policy layer answers from the plugin declaration: create-thread
      // default resolution accepts the plugin provider id, the permission
      // modes come from the declaration, and the workflows policy reads the
      // mapped server capabilities (always false for plugin providers today).
      const resolved = resolveCreateThreadExecutionDefaults(registry, {
        requestedProviderId: "policy-agent",
        storedDefaults: null,
      });
      expect(resolved.providerId).toBe("policy-agent");
      expect(
        registry.getSupportedPermissionModes("policy-agent"),
      ).not.toBeNull();
      expect(resolveWorkflowsEnabledPolicy(registry, "policy-agent")).toBe(
        false,
      );
      // A fuller proof (POST /threads through the route) needs a faked
      // daemon host session; these policy calls are the slice that gated
      // plugin providers before the repoint.
    });
  });

  it("re-registers wholesale on reload instead of colliding with itself", async () => {
    await withTestHarness(async (harness) => {
      const rootDir = await writePlugin(workDir, {
        name: "bb-plugin-reload-agent",
        serverSource: REGISTER_PROVIDER_SOURCE("reload-agent"),
      });
      const entry = await harness.pluginService.installPath(rootDir);
      expect(entry.status).toBe("running");
      expect(harness.deps.providerRegistry.get("reload-agent")).not.toBeNull();

      await harness.pluginService.reload(entry.id);

      const reloaded = harness.deps.providerRegistry.get("reload-agent");
      expect(reloaded).toMatchObject({
        source: { kind: "plugin", pluginId: entry.id },
      });
      const listed = harness.deps.providerRegistry
        .list()
        .filter((candidate) => candidate.info.id === "reload-agent");
      expect(listed).toHaveLength(1);
    });
  });

  // A declaration is metadata; without a bridge artifact behind it the picker
  // would offer a provider whose every turn dies on the host.
  it("refuses a declaration with no bridge to run on", async () => {
    await withTestHarness(async (harness) => {
      const rootDir = await writePlugin(workDir, {
        name: "bb-plugin-bridgeless-agent",
        serverSource: REGISTER_PROVIDER_SOURCE("bridgeless-agent"),
        withBridge: false,
      });
      const entry = await harness.pluginService.installPath(rootDir);

      expect(entry.status).toBe("error");
      expect(entry.statusDetail).toContain(
        'provider "bridgeless-agent" has no bridge to run on',
      );
      expect(harness.deps.providerRegistry.get("bridgeless-agent")).toBeNull();
      const providers = await listSystemProviderInfos(harness.deps, {});
      expect(providers.map((provider) => provider.id)).not.toContain(
        "bridgeless-agent",
      );
    });
  });

  // Reservation, not just collision: the id belongs to provider-codex even
  // when nothing has registered it (the plugin is disabled, or failed), and
  // for a daemon-bundled id like pi the host would otherwise run bb's own
  // bridge under the impostor's metadata.
  it("rejects a first-party id claimed by another plugin as a load failure", async () => {
    await withTestHarness(async (harness) => {
      const rootDir = await writePlugin(workDir, {
        name: "bb-plugin-shadow-codex",
        serverSource: REGISTER_PROVIDER_SOURCE("codex"),
      });
      const entry = await harness.pluginService.installPath(rootDir);
      expect(entry.status).toBe("error");
      expect(entry.statusDetail).toContain(
        'Provider "codex" is reserved for the "provider-codex" plugin',
      );
      // The incumbent registration is untouched and the failed plugin
      // contributed nothing.
      expect(harness.deps.providerRegistry.get("codex")?.source).toEqual({
        kind: "plugin",
        pluginId: "provider-codex",
      });
      const providers = await listSystemProviderInfos(harness.deps, {});
      expect(
        providers.filter((provider) => provider.id === "codex"),
      ).toHaveLength(1);
    });
  });
});
