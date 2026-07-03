import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConnection, migrate, type DbConnection } from "@bb/db";
import type { SystemChangeKind } from "@bb/domain";
import type { Logger } from "@bb/logger";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import { testLogger } from "../../helpers/test-app.js";

const logger = testLogger as unknown as Logger;

async function writePlugin(
  dir: string,
  options: {
    name: string;
    version?: string;
    engines?: string;
    serverSource: string;
  },
): Promise<string> {
  const rootDir = join(dir, options.name);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: options.name,
      version: options.version ?? "0.1.0",
      ...(options.engines ? { engines: { bb: options.engines } } : {}),
      bb: { server: "./server.ts" },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  return rootDir;
}

describe("plugin service", () => {
  let db: DbConnection;
  let workDir: string;
  let experimentOn: boolean;
  let service: PluginService;

  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-test-"));
    experimentOn = true;
    service = createPluginService({
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger,
      dataDir: join(workDir, "data"),
      appVersion: "0.9.0",
      isEnabled: () => experimentOn,
      loadTimeoutMs: 2000,
    });
  });

  afterEach(async () => {
    await service.stop();
    await rm(workDir, { recursive: true, force: true });
  });

  it("installs a path plugin, runs its factory, and reports running", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-greeter",
      serverSource: `
        import type { BbPluginApi } from "@bb/plugin-sdk";
        export default function plugin(bb: any) {
          (globalThis as any).__greeterLoads = ((globalThis as any).__greeterLoads ?? 0) + 1;
          bb.log.info("hello from greeter");
        }
      `,
    });
    const entry = await service.installPath(rootDir);
    expect(entry.id).toBe("greeter");
    expect(entry.status).toBe("running");
    expect(service.getApi("greeter")).toBeDefined();
  });

  it("marks a throwing factory as error without affecting others", async () => {
    const bad = await writePlugin(workDir, {
      name: "bb-plugin-bad",
      serverSource: `export default function plugin() { throw new Error("boom at load"); }`,
    });
    const good = await writePlugin(workDir, {
      name: "bb-plugin-good",
      serverSource: `export default function plugin() {}`,
    });
    await service.installPath(bad);
    await service.installPath(good);
    const entries = service.list();
    expect(entries.find((p) => p.id === "bad")?.status).toBe("error");
    expect(entries.find((p) => p.id === "bad")?.statusDetail).toContain(
      "boom at load",
    );
    expect(entries.find((p) => p.id === "good")?.status).toBe("running");
  });

  it("reload re-runs the factory against current sources and runs dispose hooks LIFO", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-cycler",
      serverSource: `
        export default function plugin(bb: any) {
          const g = globalThis as any;
          g.__cyclerVersion = "v1";
          g.__cyclerDisposals = g.__cyclerDisposals ?? [];
          bb.onDispose(() => g.__cyclerDisposals.push("first"));
          bb.onDispose(() => g.__cyclerDisposals.push("second"));
        }
      `,
    });
    await service.installPath(rootDir);
    await writeFile(
      join(rootDir, "server.ts"),
      `export default function plugin() { (globalThis as any).__cyclerVersion = "v2"; }`,
    );
    await service.reload("cycler");
    const globals = globalThis as Record<string, unknown>;
    expect(globals.__cyclerVersion).toBe("v2");
    // LIFO: the second-registered hook runs first.
    expect(globals.__cyclerDisposals).toEqual(["second", "first"]);
    expect(service.list().find((p) => p.id === "cycler")?.status).toBe(
      "running",
    );
  });

  it("stale API handles throw after reload", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-staler",
      serverSource: `
        export default function plugin(bb: any) {
          (globalThis as any).__stalerApi = bb;
        }
      `,
    });
    await service.installPath(rootDir);
    const captured = (globalThis as Record<string, unknown>).__stalerApi as {
      onDispose(hook: () => void): void;
    };
    await service.reload("staler");
    expect(() => captured.onDispose(() => {})).toThrowError(/stale API handle/);
  });

  it("marks engine mismatches incompatible and missing dirs missing", async () => {
    const tooNew = await writePlugin(workDir, {
      name: "bb-plugin-too-new",
      engines: ">=99.0.0",
      serverSource: `export default function plugin() {}`,
    });
    await service.installPath(tooNew);
    expect(service.list().find((p) => p.id === "too-new")?.status).toBe(
      "incompatible",
    );

    const vanishing = await writePlugin(workDir, {
      name: "bb-plugin-vanishing",
      serverSource: `export default function plugin() {}`,
    });
    await service.installPath(vanishing);
    await rm(vanishing, { recursive: true, force: true });
    await service.reload("vanishing");
    const entry = service.list().find((p) => p.id === "vanishing");
    expect(entry?.status).toBe("missing");
    expect(entry?.statusDetail).toContain("reinstall");
  });

  it("skips the engines gate on 0.0.0 dev builds instead of marking everything incompatible", async () => {
    const devService = createPluginService({
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger,
      dataDir: join(workDir, "data"),
      appVersion: "0.0.0",
      isEnabled: () => true,
      loadTimeoutMs: 2000,
    });
    const gated = await writePlugin(workDir, {
      name: "bb-plugin-dev-gated",
      engines: ">=0.9",
      serverSource: `export default function plugin() {}`,
    });
    const entry = await devService.installPath(gated);
    expect(entry.status).toBe("running");
    await devService.stop();
  });

  it("times out a hung factory and reports error", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-hang",
      serverSource: `export default function plugin() { return new Promise(() => {}); }`,
    });
    await service.installPath(rootDir);
    const entry = service.list().find((p) => p.id === "hang");
    expect(entry?.status).toBe("error");
    expect(entry?.statusDetail).toContain("timed out");
  });

  it("experiment off: nothing loads at start; live toggle loads and disposes", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-gated",
      serverSource: `
        export default function plugin(bb: any) {
          const g = globalThis as any;
          g.__gatedLoads = (g.__gatedLoads ?? 0) + 1;
          bb.onDispose(() => { g.__gatedDisposed = true; });
        }
      `,
    });
    experimentOn = true;
    await service.installPath(rootDir);
    const globals = globalThis as Record<string, unknown>;
    const loadsAfterInstall = globals.__gatedLoads as number;

    await service.onExperimentChanged(false);
    expect(globals.__gatedDisposed).toBe(true);
    expect(service.getApi("gated")).toBeUndefined();

    await service.onExperimentChanged(true);
    expect(globals.__gatedLoads).toBe(loadsAfterInstall + 1);
    expect(service.list().find((p) => p.id === "gated")?.status).toBe(
      "running",
    );
  });

  it("disable unloads and disposes; enable loads again", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-switchable",
      serverSource: `export default function plugin(bb: any) {
        bb.onDispose(() => { (globalThis as any).__switchableDisposed = true; });
      }`,
    });
    await service.installPath(rootDir);
    const disabled = await service.setEnabled("switchable", false);
    expect(disabled?.status).toBe("disabled");
    expect((globalThis as Record<string, unknown>).__switchableDisposed).toBe(
      true,
    );
    const enabled = await service.setEnabled("switchable", true);
    expect(enabled?.status).toBe("running");
  });
});

describe("plugins-changed broadcast", () => {
  let db: DbConnection;
  let workDir: string;
  let notifySystem: ReturnType<
    typeof vi.fn<(changes: SystemChangeKind[]) => void>
  >;
  let service: PluginService;

  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-notify-test-"));
    notifySystem = vi.fn<(changes: SystemChangeKind[]) => void>();
    service = createPluginService({
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginSignal: () => 0,
        notifySystem,
      },
      logger,
      dataDir: join(workDir, "data"),
      appVersion: "0.9.0",
      isEnabled: () => true,
      loadTimeoutMs: 2000,
    });
  });

  afterEach(async () => {
    await service.stop();
    await rm(workDir, { recursive: true, force: true });
  });

  it("broadcasts plugins-changed on install, reload, and enable/disable", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-notifier",
      serverSource: `export default function plugin() {}`,
    });
    await service.installPath(rootDir);
    expect(notifySystem).toHaveBeenCalledWith(["plugins-changed"]);

    notifySystem.mockClear();
    await service.reload("notifier");
    expect(notifySystem).toHaveBeenCalledWith(["plugins-changed"]);

    notifySystem.mockClear();
    await service.setEnabled("notifier", false);
    expect(notifySystem).toHaveBeenCalledWith(["plugins-changed"]);

    notifySystem.mockClear();
    await service.setEnabled("notifier", true);
    expect(notifySystem).toHaveBeenCalledWith(["plugins-changed"]);
  });
});
