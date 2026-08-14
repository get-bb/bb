import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSystemProviderInfos } from "../../../src/services/system/execution-options.js";
import { withTestHarness } from "../../helpers/test-app.js";

async function writePlugin(
  dir: string,
  options: { name: string; serverSource: string },
): Promise<string> {
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
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  return rootDir;
}

const REGISTER_PROVIDER_SOURCE = (id: string): string => `
  export default function plugin(bb: any) {
    bb.agents.experimental_registerProvider({
      id: ${JSON.stringify(id)},
      displayName: "My Remote Agent",
      icon: { asset: "icons/agent.svg" },
      kind: "agent",
      bridge: { entry: "dist/bridge.js" },
      capabilities: {
        supportsServiceTier: true,
        supportsHostAiServices: false,
        supportsNativeUserQuestion: true,
        supportsNativeFork: true,
        supportsNativeSessionRewind: false,
        supportsManualCompaction: true,
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
      const rootDir = await writePlugin(workDir, {
        name: "bb-plugin-remote-agent",
        serverSource: REGISTER_PROVIDER_SOURCE("my-remote-agent"),
      });
      const entry = await harness.pluginService.installPath(rootDir);
      expect(entry.status).toBe("running");

      const registration =
        harness.deps.providerRegistry.get("my-remote-agent");
      expect(registration).toMatchObject({
        source: { kind: "plugin", pluginId: entry.id },
        info: {
          id: "my-remote-agent",
          displayName: "My Remote Agent",
          available: true,
          logoUrl: `/api/v1/plugins/${entry.id}/assets/icons/agent.svg`,
          capabilities: {
            supportsArchive: false,
            supportsRename: false,
            supportsServiceTier: true,
            supportsUserQuestion: true,
            supportsFork: true,
            supportedPermissionModes: ["accept-edits", "full"],
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
          supportsSessionRestore: false,
          backsHostDaemonAiServices: false,
          reasoningLevels: ["low", "medium", "high"],
        },
      });
      // Fields without a registry consumer yet ride the full declaration.
      expect(registration?.declaration).toMatchObject({
        kind: "agent",
        bridge: { entry: "dist/bridge.js" },
        capabilities: {
          supportsNativeSessionRewind: false,
          supportsManualCompaction: true,
        },
      });

      // The composed provider listing (GET /system/providers path) includes
      // the plugin provider next to the core catalog.
      const providers = await listSystemProviderInfos(harness.deps, {});
      expect(providers.map((provider) => provider.id)).toContain(
        "my-remote-agent",
      );

      // Disabling the plugin runs its dispose hooks and removes the provider.
      await harness.pluginService.setEnabled(entry.id, false);
      expect(harness.deps.providerRegistry.get("my-remote-agent")).toBeNull();
      const afterDisable = await listSystemProviderInfos(harness.deps, {});
      expect(afterDisable.map((provider) => provider.id)).not.toContain(
        "my-remote-agent",
      );
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
      expect(
        harness.deps.providerRegistry.get("reload-agent"),
      ).not.toBeNull();

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

  it("rejects a collision with a core provider id as a plugin load failure", async () => {
    await withTestHarness(async (harness) => {
      const rootDir = await writePlugin(workDir, {
        name: "bb-plugin-shadow-codex",
        serverSource: REGISTER_PROVIDER_SOURCE("codex"),
      });
      const entry = await harness.pluginService.installPath(rootDir);
      expect(entry.status).toBe("error");
      expect(entry.statusDetail).toContain(
        'Provider "codex" is already registered',
      );
      // The core registration is untouched and the failed plugin
      // contributed nothing.
      expect(harness.deps.providerRegistry.get("codex")?.source).toEqual({
        kind: "core",
      });
      const providers = await listSystemProviderInfos(harness.deps, {});
      expect(
        providers.filter((provider) => provider.id === "codex"),
      ).toHaveLength(1);
    });
  });
});
