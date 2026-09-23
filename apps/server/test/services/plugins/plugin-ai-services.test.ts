import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSystemProviderInfos } from "../../../src/services/system/execution-options.js";
import { withTestHarness } from "../../helpers/test-app.js";

const HOST_SOURCE = `
  export default {
    experimental_apiVersion: 1,
    contract: {},
    handlers: {},
  };
`;

const REGISTER_AI_SERVICE_SOURCE = (id: string): string => `
  export default function plugin(bb: any) {
    bb.experimental_aiServices.register({
      id: ${JSON.stringify(id)},
      displayName: "Acme AI",
      complete: async (prompt) => prompt.toUpperCase(),
      transcribe: async (audio) => "heard " + audio.name,
      status: async () => ({ ready: false, message: "Add an API key" }),
    });
  }
`;

const REGISTER_AI_SERVICE_AND_PROVIDER_SOURCE = (
  id: string,
  order: "service-first" | "provider-first",
): string => {
  const service = `
    bb.experimental_aiServices.register({
      id: ${JSON.stringify(id)},
      displayName: "Acme AI",
      complete: async () => "reply",
    });`;
  const provider = `
    bb.providers.register({
      id: ${JSON.stringify(id)},
      displayName: "Acme Agent",
      icon: "./icons/agent.svg",
      maintenance: { health: true, usage: true, installation: false },
      capabilities: {
        supportsServiceTier: false,
        supportsNativeUserQuestion: false,
        fork: "tip",
        supportsManualCompaction: false,
        supportsThreadArchive: false,
        supportsThreadRename: false,
        permissionModes: ["accept-edits", "full"],
        reasoningLevels: ["low", "medium", "high"],
      },
      composerActions: ["plan"],
    });`;
  return `
  export default function plugin(bb: any) {
    ${order === "service-first" ? service + provider : provider + service}
  }
`;
};

async function writePlugin(
  dir: string,
  options: { name: string; serverSource: string; withHost?: boolean },
): Promise<string> {
  const withHost = options.withHost ?? true;
  const rootDir = join(dir, options.name);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: options.name,
      version: "0.1.0",
      bb: {
        name: "AI service fixture",
        description: "AI service registration fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
        ...(withHost ? { host: "./host.ts" } : {}),
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  if (withHost) {
    await writeFile(join(rootDir, "host.ts"), HOST_SOURCE);
  }
  return rootDir;
}

describe("bb.experimental_aiServices.register (server)", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-ai-service-test-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("lands the service when the load commits and removes it when the plugin is disabled", async () => {
    await withTestHarness(async (harness) => {
      const rootDir = await writePlugin(workDir, {
        name: "bb-plugin-acme-ai",
        serverSource: REGISTER_AI_SERVICE_SOURCE("acme-ai"),
        withHost: false,
      });
      const entry = await harness.pluginService.installPath(rootDir);
      expect(entry.status).toBe("running");
      const service = harness.deps.aiServices.get("acme-ai");
      expect(service).toMatchObject({
        id: "acme-ai",
        displayName: "Acme AI",
        pluginId: "acme-ai",
        builtin: false,
      });
      const signal = new AbortController().signal;
      await expect(service?.complete?.("hi", { signal })).resolves.toBe("HI");
      await expect(
        service?.transcribe?.(new File(["a"], "clip.webm"), {
          signal,
          hint: null,
        }),
      ).resolves.toBe("heard clip.webm");
      await expect(harness.deps.aiServices.status("acme-ai")).resolves.toEqual({
        ready: false,
        message: "Add an API key",
      });
      await harness.pluginService.setEnabled("acme-ai", false);
      expect(harness.deps.aiServices.get("acme-ai")).toBeNull();
    });
  });

  it("fails the load of a plugin whose service answers nothing", async () => {
    await withTestHarness(async (harness) => {
      const rootDir = await writePlugin(workDir, {
        name: "bb-plugin-empty-ai",
        serverSource: `
          export default function plugin(bb: any) {
            bb.experimental_aiServices.register({ id: "empty-ai", displayName: "Empty" });
          }
        `,
        withHost: false,
      });
      const entry = await harness.pluginService.installPath(rootDir);
      expect(entry.status).toBe("error");
      expect(entry.statusDetail).toContain(
        'AI service "empty-ai" must declare complete, transcribe, or both',
      );
      expect(harness.deps.aiServices.get("empty-ai")).toBeNull();
    });
  });

  it("fails the load on the host build error when a first install's bb.host entry does not build", async () => {
    await withTestHarness(async (harness) => {
      const rootDir = await writePlugin(workDir, {
        name: "bb-plugin-broken-host-ai",
        serverSource: REGISTER_AI_SERVICE_SOURCE("broken-host-ai"),
      });
      await writeFile(
        join(rootDir, "host.ts"),
        'import "missing-host-runtime";\n',
      );
      const entry = await harness.pluginService.installPath(rootDir);
      expect(entry.status).toBe("error");
      expect(entry.statusDetail).toContain("Could not resolve");
      expect(entry.statusDetail).not.toContain("needs a bb.host entry");
      expect(harness.deps.aiServices.get("broken-host-ai")).toBeNull();
      expect(harness.deps.aiServices.list()).toEqual([]);
    });
  });

  it.each(["service-first", "provider-first"] as const)(
    "keeps the provider listed as unavailable when the host entry of a plugin that also registers an AI service fails to build (%s)",
    async (order) => {
      await withTestHarness(async (harness) => {
        const id = `dual-${order}`;
        const rootDir = await writePlugin(workDir, {
          name: `bb-plugin-${id}`,
          serverSource: REGISTER_AI_SERVICE_AND_PROVIDER_SOURCE(id, order),
        });
        await writeFile(
          join(rootDir, "host.ts"),
          'import "missing-host-runtime";\n',
        );
        const entry = await harness.pluginService.installPath(rootDir);
        expect(entry.status).toBe("error");
        expect(entry.statusDetail).toContain("Could not resolve");
        expect(harness.deps.providerRegistry.get(id)?.info).toEqual(
          expect.objectContaining({
            id,
            displayName: "Acme Agent",
            available: false,
          }),
        );
        expect(
          (await listSystemProviderInfos(harness.deps, {})).find(
            (provider) => provider.id === id,
          ),
        ).toEqual(expect.objectContaining({ available: false }));
        expect(harness.deps.aiServices.get(id)).toBeNull();
        expect(harness.deps.aiServices.list()).toEqual([]);

        await writeFile(join(rootDir, "host.ts"), HOST_SOURCE);
        await harness.pluginService.reload(entry.id);
        expect(
          harness.pluginService.list().find((plugin) => plugin.id === entry.id)
            ?.status,
        ).toBe("running");
        expect(harness.deps.providerRegistry.get(id)?.info.available).toBe(
          true,
        );
        expect(
          harness.deps.providerRegistry
            .list()
            .filter((provider) => provider.info.id === id),
        ).toHaveLength(1);
        expect(harness.deps.aiServices.get(id)?.pluginId).toBe(entry.id);

        await harness.pluginService.setEnabled(entry.id, false);
        expect(harness.deps.providerRegistry.get(id)).toBeNull();
        expect(harness.deps.aiServices.get(id)).toBeNull();
      });
    },
  );

  it("fails a later plugin's load at the register call when another plugin holds the id", async () => {
    await withTestHarness(async (harness) => {
      const first = await harness.pluginService.installPath(
        await writePlugin(workDir, {
          name: "bb-plugin-first-ai",
          serverSource: REGISTER_AI_SERVICE_SOURCE("shared-ai"),
        }),
      );
      expect(first.status).toBe("running");
      const second = await harness.pluginService.installPath(
        await writePlugin(workDir, {
          name: "bb-plugin-second-ai",
          serverSource: REGISTER_AI_SERVICE_SOURCE("shared-ai"),
        }),
      );
      expect(second.status).toBe("error");
      expect(second.statusDetail).toContain(
        'AI service "shared-ai" is already registered; a plugin cannot shadow an existing service.',
      );
      expect(harness.deps.aiServices.get("shared-ai")?.pluginId).toBe(
        "first-ai",
      );
    });
  });
});
