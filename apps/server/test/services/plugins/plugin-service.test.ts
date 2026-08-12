import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
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
    bb?: Record<string, unknown>;
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
      bb: {
        name: "Service fixture",
        description: "Plugin service fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
        ...options.bb,
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  return rootDir;
}

/**
 * A fixture shaped like a real published plugin: `"type": "module"` plus a
 * plain `.js` entry, which jiti hands to native `import()`. The TypeScript
 * fixture above never reaches that path because jiti always transpiles TS.
 */
async function writeEsmPlugin(rootDir: string, id: string): Promise<void> {
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: `bb-plugin-${id}`,
      version: "0.1.0",
      type: "module",
      bb: {
        name: `${id} fixture`,
        description: "ESM reload fixture.",
        branding: { icon: "Zap" },
        server: "./server.js",
      },
    }),
  );
}

/** Rewrite an ESM fixture's entry and its submodule with fresh markers. */
async function writeEsmSources(
  rootDir: string,
  globalName: string,
  entry: string,
  sub: string,
): Promise<void> {
  await writeFile(
    join(rootDir, "marker.js"),
    `export const MARKER = "${sub}";\n`,
  );
  await writeFile(
    join(rootDir, "server.js"),
    `import { MARKER } from "./marker.js";
     export default function plugin() {
       globalThis.${globalName} = "${entry}:" + MARKER;
     }\n`,
  );
}

describe("plugin service", () => {
  let db: DbConnection;
  let workDir: string;
  let service: PluginService;

  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-test-"));
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

  it("summarizes user-facing capabilities and drops the live ones when disabled", async () => {
    const rootDir = join(workDir, "bb-plugin-capabilities");
    // Two real skills plus a stray directory without a SKILL.md, so the
    // summary is proven to name the skills rather than their containing folder.
    await mkdir(join(rootDir, "skills", "review"), { recursive: true });
    await mkdir(join(rootDir, "skills", "triage"), { recursive: true });
    await mkdir(join(rootDir, "skills", "not-a-skill"), { recursive: true });
    await writeFile(join(rootDir, "skills", "review", "SKILL.md"), "# review");
    await writeFile(join(rootDir, "skills", "triage", "SKILL.md"), "# triage");
    await writeFile(join(rootDir, "midnight.css"), ":root { --canvas: #000; }");
    await writePlugin(workDir, {
      name: "bb-plugin-capabilities",
      bb: {
        themes: [
          {
            id: "midnight",
            name: "Midnight",
            description: "A dark palette",
            css: "./midnight.css",
          },
        ],
      },
      serverSource: `
        export default function plugin(bb: any) {
          bb.agents.registerTool({
            name: "capabilities_probe",
            description: "Probe capabilities",
            parameters: { type: "object" },
            execute: async () => ({ content: "ok" }),
          });
          bb.ui.registerMentionProvider({
            id: "issues",
            label: "Issues",
            triggers: ["#"],
            async search() { return []; },
            async resolve() { return { context: "" }; },
          });
        }
      `,
    });
    await service.installPath(rootDir);

    const enabled = service.list().find((entry) => entry.id === "capabilities");
    expect(enabled?.capabilities).toEqual([
      {
        kind: "skill",
        id: "review",
        label: "review",
        detail: "Skill this plugin adds to your agents",
      },
      {
        kind: "skill",
        id: "triage",
        label: "triage",
        detail: "Skill this plugin adds to your agents",
      },
      {
        kind: "theme",
        id: "midnight",
        label: "Midnight",
        detail: "A dark palette",
      },
      {
        kind: "agent-tool",
        id: "capabilities_probe",
        label: "capabilities_probe",
        detail: "Probe capabilities",
      },
      {
        kind: "thread-integration",
        id: "mention:issues",
        label: "Issues",
        detail: "Mentions with #",
      },
    ]);

    await service.setEnabled("capabilities", false);

    // A disabled plugin has no runtime, so only its manifest-declared
    // capabilities survive — the detail page says the rest need enabling.
    expect(
      service
        .list()
        .find((entry) => entry.id === "capabilities")
        ?.capabilities.map((capability) => capability.kind),
    ).toEqual(["skill", "skill", "theme"]);
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

  // The fixture above writes TypeScript, which jiti always transpiles, so it
  // never exercises the path real plugins take: every published plugin ships
  // `"type": "module"` with plain `.js`, which jiti hands to native import().
  // Node's ESM registry then keys the module by URL forever, so reload used to
  // re-run the first-evaluated factory. Submodules regressed separately from
  // the entry, so both are asserted.
  it("reload re-reads an ESM plugin's entry and its submodules", async () => {
    const rootDir = join(workDir, "bb-plugin-esm-reloader");
    await writeEsmPlugin(rootDir, "esm-reloader");
    const globals = globalThis as Record<string, unknown>;

    await writeEsmSources(rootDir, "esmReloader", "entry1", "sub1");
    await service.installPath(rootDir);
    expect(globals.esmReloader).toBe("entry1:sub1");

    await writeEsmSources(rootDir, "esmReloader", "entry2", "sub1");
    await service.reload("esm-reloader");
    expect(globals.esmReloader).toBe("entry2:sub1");

    await writeEsmSources(rootDir, "esmReloader", "entry2", "sub2");
    await service.reload("esm-reloader");
    expect(globals.esmReloader).toBe("entry2:sub2");
  });

  // The URL marker re-keys ESM modules only. Node caches a CommonJS child by
  // resolved filename and ignores the query, so both a static `.cjs` import
  // and a `createRequire()` call must be invalidated another way.
  it("reload re-reads a plugin's CommonJS children", async () => {
    const rootDir = join(workDir, "bb-plugin-cjs-child");
    await writeEsmPlugin(rootDir, "cjs-child");
    const writeSources = async (value: string): Promise<void> => {
      await writeFile(
        join(rootDir, "helper.cjs"),
        `module.exports = { H: "${value}" };\n`,
      );
      await writeFile(
        join(rootDir, "required.cjs"),
        `module.exports = { R: "${value}" };\n`,
      );
    };
    await writeFile(
      join(rootDir, "server.js"),
      `import { createRequire } from "node:module";
       import helper from "./helper.cjs";
       const require = createRequire(import.meta.url);
       export default function plugin() {
         globalThis.cjsChild = helper.H + ":" + require("./required.cjs").R;
       }\n`,
    );
    const globals = globalThis as Record<string, unknown>;

    await writeSources("cjs-before");
    await service.installPath(rootDir);
    expect(globals.cjsChild).toBe("cjs-before:cjs-before");

    await writeSources("cjs-after");
    await service.reload("cjs-child");
    expect(globals.cjsChild).toBe("cjs-after:cjs-after");
  });

  // The marker carries the root id as well as the epoch. Without the id, an
  // import that crosses into another plugin's tree would carry the importer's
  // epoch and pin the imported plugin to a stale module.
  it("reload of an imported plugin is visible to a plugin that imports it", async () => {
    const importerDir = join(workDir, "bb-plugin-importer");
    const importedDir = join(workDir, "bb-plugin-imported");
    await writeEsmPlugin(importerDir, "importer");
    await writeEsmPlugin(importedDir, "imported");
    await writeEsmSources(importedDir, "imported", "entry1", "sub1");
    await writeFile(
      join(importerDir, "server.js"),
      `export default function plugin() {
         globalThis.importerReadShared = async () =>
           (await import(${JSON.stringify(join(importedDir, "shared.js"))})).SHARED;
       }\n`,
    );
    await writeFile(
      join(importedDir, "shared.js"),
      `export const SHARED = "shared1";\n`,
    );
    await service.installPath(importedDir);
    await service.installPath(importerDir);
    const globals = globalThis as Record<string, unknown>;
    const readShared = globals.importerReadShared as () => Promise<string>;
    expect(await readShared()).toBe("shared1");

    // Reload only the imported plugin; the importer keeps running.
    await writeFile(
      join(importedDir, "shared.js"),
      `export const SHARED = "shared2";\n`,
    );
    await writeEsmSources(importedDir, "imported", "entry2", "sub2");
    await service.reload("imported");
    expect(globals.imported).toBe("entry2:sub2");
    // The importer's next cross-root import must see the reloaded plugin.
    expect(await readShared()).toBe("shared2");
  });

  // A candidate that never commits must stay private. Cross-root importers do
  // not inherit the retained plugin's epoch (they resolve against the imported
  // root), so without a rollback they would read the rejected files.
  it("hides a failed reload's sources from a plugin that imports it", async () => {
    const importerDir = join(workDir, "bb-plugin-fail-importer");
    const importedDir = join(workDir, "bb-plugin-fail-imported");
    await writeEsmPlugin(importerDir, "fail-importer");
    await writeEsmPlugin(importedDir, "fail-imported");
    await writeEsmSources(importedDir, "failImported", "entry1", "sub1");
    await writeFile(
      join(importerDir, "server.js"),
      `export default function plugin() {
         globalThis.failImporterRead = async () => {
           const shared = await import(
             ${JSON.stringify(join(importedDir, "shared.js"))}
           );
           const helper = (await import(
             ${JSON.stringify(join(importedDir, "helper.cjs"))}
           )).default;
           return shared.SHARED + ":" + helper.H;
         };
       }\n`,
    );
    await writeFile(
      join(importedDir, "shared.js"),
      `export const SHARED = "shared1";\n`,
    );
    await writeFile(
      join(importedDir, "helper.cjs"),
      `module.exports = { H: "cjs1" };\n`,
    );
    await service.installPath(importedDir);
    await service.installPath(importerDir);
    const globals = globalThis as Record<string, unknown>;
    const read = globals.failImporterRead as () => Promise<string>;
    expect(await read()).toBe("shared1:cjs1");

    // Edit every file, then break the entry so the reload cannot commit.
    await writeFile(
      join(importedDir, "shared.js"),
      `export const SHARED = "shared-rejected";\n`,
    );
    await writeFile(
      join(importedDir, "helper.cjs"),
      `module.exports = { H: "cjs-rejected" };\n`,
    );
    await writeFile(join(importedDir, "server.js"), `export default 42;\n`);
    await service.reload("fail-imported");
    expect(service.list().find((p) => p.id === "fail-imported")?.status).toBe(
      "running",
    );

    // The retained plugin's files must still be the committed ones.
    expect(await read()).toBe("shared1:cjs1");
  });

  // Node canonicalizes ESM files through symbolic links, so a root tracked as
  // the un-canonicalized install path never matches the module URL.
  it("reload re-reads an ESM plugin installed through a symbolic link", async () => {
    const realDir = join(workDir, "real-symlinked");
    const linkDir = join(workDir, "link-symlinked");
    await writeEsmPlugin(realDir, "symlinked");
    await symlink(realDir, linkDir);
    const globals = globalThis as Record<string, unknown>;

    await writeEsmSources(realDir, "symlinked", "entry1", "sub1");
    await service.installPath(linkDir);
    expect(globals.symlinked).toBe("entry1:sub1");

    await writeEsmSources(realDir, "symlinked", "entry2", "sub2");
    await service.reload("symlinked");
    expect(globals.symlinked).toBe("entry2:sub2");
  });

  // An outer plugin's root is a prefix of the nested plugin's root, so a
  // first-match lookup would stamp the outer generation onto the inner files
  // and reload the nested plugin to cached code.
  it("reload of a plugin nested inside another plugin's tree re-reads sources", async () => {
    const outerDir = join(workDir, "outer-host");
    const nestedDir = join(outerDir, "vendor", "nested-guest");
    await writeEsmPlugin(outerDir, "outer-host");
    await writeEsmPlugin(nestedDir, "nested-guest");
    const globals = globalThis as Record<string, unknown>;

    await writeEsmSources(outerDir, "outerHost", "entry1", "sub1");
    await writeEsmSources(nestedDir, "nestedGuest", "entry1", "sub1");
    await service.installPath(outerDir);
    await service.installPath(nestedDir);
    expect(globals.nestedGuest).toBe("entry1:sub1");

    await writeEsmSources(nestedDir, "nestedGuest", "entry2", "sub2");
    await service.reload("nested-guest");
    expect(globals.nestedGuest).toBe("entry2:sub2");
  });

  // A plugin's lazy imports must resolve against the generation it was loaded
  // under, not whatever generation the root has reached since. Otherwise a
  // surviving plugin mixes its own modules with those of a newer — or failed —
  // load.
  it("keeps a live plugin's lazy imports coherent after a failed reload", async () => {
    const rootDir = join(workDir, "bb-plugin-rollback");
    await writeEsmPlugin(rootDir, "rollbacker");
    await writeFile(join(rootDir, "lazy.js"), `export const LAZY = "lazy1";\n`);
    await writeFile(
      join(rootDir, "server.js"),
      `import { MARKER } from "./marker.js";
       export default function plugin() {
         globalThis.rollbacker = "entry1:" + MARKER;
         globalThis.rollbackerLoadLazy = async () =>
           (await import("./lazy.js")).LAZY;
       }\n`,
    );
    await writeFile(
      join(rootDir, "marker.js"),
      `export const MARKER = "sub1";\n`,
    );
    await service.installPath(rootDir);
    const globals = globalThis as Record<string, unknown>;
    const loadLazy = globals.rollbackerLoadLazy as () => Promise<string>;
    expect(await loadLazy()).toBe("lazy1");

    // Break the entry so the candidate load fails and the old plugin survives.
    await writeFile(join(rootDir, "server.js"), `export default 42;\n`);
    await writeFile(join(rootDir, "lazy.js"), `export const LAZY = "lazy2";\n`);
    await service.reload("rollbacker");
    expect(service.list().find((p) => p.id === "rollbacker")?.status).toBe(
      "running",
    );
    // The surviving plugin still sees its own generation, not the failed one.
    expect(await loadLazy()).toBe("lazy1");
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

  it("marks initial engine mismatches incompatible and preserves a live plugin when reload finds its directory missing", async () => {
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
    expect(entry?.status).toBe("running");
    expect(entry?.statusDetail).toContain("reload failed");
    expect(entry?.statusDetail).toContain("reinstall");
    expect(service.getApi("vanishing")).toBeDefined();
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

  it("enables a disabled path plugin when it is reinstalled", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "bb-plugin-reinstalled",
      serverSource: `export default function plugin() {}`,
    });
    await service.install(rootDir);
    expect(await service.setEnabled("reinstalled", false)).toMatchObject({
      enabled: false,
      status: "disabled",
    });

    const reinstalled = await service.install(rootDir);

    expect(reinstalled).toMatchObject({
      enabled: true,
      status: "running",
    });
    expect(service.getApi("reinstalled")).toBeDefined();
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
