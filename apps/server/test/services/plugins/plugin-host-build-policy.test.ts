import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLUGIN_SDK_VERSION } from "@bb/domain";
import { createMigratedConnection } from "@bb/db/testing";
import { createAiServiceRegistry } from "../../../src/services/ai/ai-service-registry.js";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import { createNoopTelemetryService } from "../../../src/services/system/telemetry.js";
import { testLogger } from "../../helpers/test-app.js";

describe("mutable plugin host build policy", () => {
  let service: PluginService;
  let db: ReturnType<typeof createMigratedConnection>;
  let workDir: string;
  let rootDir: string;
  let artifactPath: string;
  let metaPath: string;

  function createService(appVersion: string): PluginService {
    return createPluginService({
      db,
      dataDir: join(workDir, "data"),
      appVersion,
      bundledPlugins: [],
      aiServices: createAiServiceRegistry(),
      telemetry: createNoopTelemetryService(),
      logger: testLogger,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginChanged: () => {},
        onWatchedTargets: () => () => {},
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
    });
  }

  beforeEach(async () => {
    db = createMigratedConnection();
    workDir = await mkdtemp(join(tmpdir(), "bb-host-build-policy-"));
    service = createService("0.9.0");
    rootDir = join(workDir, "bb-plugin-host-policy");
    artifactPath = join(rootDir, "dist", "host.js");
    metaPath = join(rootDir, "dist", "host.meta.json");
    await mkdir(rootDir, { recursive: true });
    await writeFile(
      join(rootDir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-host-policy",
        version: "0.1.0",
        bb: {
          name: "Host policy fixture",
          description: "Host build lifecycle fixture.",
          branding: { icon: "Zap" },
          server: "./server.ts",
          host: "./host.ts",
        },
      }),
    );
    await writeFile(
      join(rootDir, "server.ts"),
      "export default function plugin() {}",
    );
    const dependencyDir = join(workDir, "shared-dependency");
    await mkdir(dependencyDir, { recursive: true });
    await writeFile(
      join(dependencyDir, "package.json"),
      JSON.stringify({
        name: "shared-dependency",
        version: "1.0.0",
        type: "module",
        main: "./index.js",
      }),
    );
    await writeFile(
      join(dependencyDir, "index.js"),
      'export const marker = "dependency-initial";',
    );
    await mkdir(join(rootDir, "node_modules"), { recursive: true });
    await symlink(
      dependencyDir,
      join(rootDir, "node_modules", "shared-dependency"),
    );
    await writeFile(
      join(rootDir, "host.ts"),
      'import { marker } from "shared-dependency";\nexport default { experimental_apiVersion: 1, value: "initial", marker };',
    );
    const installed = await service.installPath(rootDir);
    expect(installed.status).toBe("running");
  });

  afterEach(async () => {
    await service.stop();
    db.$client.close();
    await rm(workDir, { recursive: true, force: true });
  });

  it.each(["reload", "restart"])(
    "reuses an unchanged host artifact on %s",
    async (operation) => {
      const before = await stat(artifactPath);
      const bytes = await readFile(artifactPath);
      if (operation === "restart") {
        await service.stop();
        await service.start();
      } else {
        expect((await service.reload("host-policy")).ok).toBe(true);
      }
      expect(
        service.list().find((entry) => entry.id === "host-policy")?.status,
      ).toBe("running");
      expect(await readFile(artifactPath)).toEqual(bytes);
      expect((await stat(artifactPath)).mtimeMs).toBe(before.mtimeMs);
    },
  );

  it.each(["source", "artifact", "metadata", "invalid metadata", "SDK"])(
    "rebuilds when the %s changes or disappears",
    async (target) => {
      if (target === "source") {
        await writeFile(
          join(rootDir, "host.ts"),
          'import { marker } from "shared-dependency";\nexport default { experimental_apiVersion: 1, value: "updated", marker };',
        );
      } else if (target === "artifact") {
        await rm(artifactPath);
      } else if (target === "metadata") {
        await rm(metaPath);
      } else {
        await writeFile(
          metaPath,
          target === "SDK"
            ? JSON.stringify({ sdkMajor: 0, sdkVersion: "0.0.0-stale" })
            : "not json",
        );
      }

      expect((await service.reload("host-policy")).ok).toBe(true);
      const metadata: unknown = JSON.parse(await readFile(metaPath, "utf8"));
      expect(metadata).toMatchObject({ sdkVersion: PLUGIN_SDK_VERSION });
      const artifact = await readFile(artifactPath, "utf8");
      expect(artifact).toContain(target === "source" ? "updated" : "initial");
    },
  );

  it("rebuilds when a bundled dependency outside the plugin root changes", async () => {
    await writeFile(
      join(workDir, "shared-dependency", "index.js"),
      'export const marker = "dependency-updated";',
    );

    await service.stop();
    await service.start();

    expect(await readFile(artifactPath, "utf8")).toContain(
      "dependency-updated",
    );
  });

  it("rebuilds when the artifact bytes no longer match the metadata", async () => {
    await appendFile(artifactPath, "\n");

    expect(await service.reload("host-policy")).toMatchObject({ ok: true });
    const metadata = JSON.parse(await readFile(metaPath, "utf8"));
    expect(metadata.artifactDigest).toBe(
      createHash("sha256")
        .update(await readFile(artifactPath))
        .digest("hex"),
    );
  });

  it("rebuilds after bb is upgraded", async () => {
    await service.stop();
    service = createService("0.9.1");
    await service.start();

    expect(JSON.parse(await readFile(metaPath, "utf8"))).toMatchObject({
      builtWith: { bbVersion: "0.9.1" },
    });
  });
});
