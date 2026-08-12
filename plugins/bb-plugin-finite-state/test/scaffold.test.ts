import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pluginPackageJsonSchema } from "@bb/domain";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import {
  installTestPluginRuntime,
  loadPluginApp,
} from "@bb/plugin-sdk/testing/app";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../lib/context.js";
import { MIGRATIONS } from "../lib/store/schema.js";

const backendLaneMocks = vi.hoisted(() => ({
  remote: vi.fn(),
  sync: vi.fn(),
  findings: vi.fn(),
  productSecurity: vi.fn(),
  bom: vi.fn(),
  firmware: vi.fn(),
  bench: vi.fn(),
  documents: vi.fn(),
  agentic: vi.fn(),
}));

const frontendLaneMocks = vi.hoisted(() => ({
  remote: vi.fn(),
  sync: vi.fn(),
  findings: vi.fn(),
  productSecurity: vi.fn(),
  bom: vi.fn(),
  firmware: vi.fn(),
  bench: vi.fn(),
  documents: vi.fn(),
  agentic: vi.fn(),
}));

vi.mock("../lanes/remote/register.js", () => ({
  registerRemoteServices: backendLaneMocks.remote,
}));
vi.mock("../lanes/sync/register.js", () => ({
  registerSync: backendLaneMocks.sync,
}));
vi.mock("../lanes/findings/register.js", () => ({
  registerFindings: backendLaneMocks.findings,
}));
vi.mock("../lanes/product-security/register.js", () => ({
  registerProductSecurity: backendLaneMocks.productSecurity,
}));
vi.mock("../lanes/bom/register.js", () => ({
  registerBom: backendLaneMocks.bom,
}));
vi.mock("../lanes/firmware/register.js", () => ({
  registerFirmware: backendLaneMocks.firmware,
}));
vi.mock("../lanes/bench/register.js", () => ({
  registerBench: backendLaneMocks.bench,
}));
vi.mock("../lanes/documents/register.js", () => ({
  registerDocuments: backendLaneMocks.documents,
}));
vi.mock("../lanes/agentic/register.js", () => ({
  registerAgentic: backendLaneMocks.agentic,
}));

vi.mock("../lanes/remote/register.app.js", () => ({
  registerRemoteServicesApp: frontendLaneMocks.remote,
}));
vi.mock("../lanes/sync/register.app.js", () => ({
  registerSyncApp: frontendLaneMocks.sync,
}));
vi.mock("../lanes/findings/register.app.js", () => ({
  registerFindingsApp: frontendLaneMocks.findings,
}));
vi.mock("../lanes/product-security/register.app.js", () => ({
  registerProductSecurityApp: frontendLaneMocks.productSecurity,
}));
vi.mock("../lanes/bom/register.app.js", () => ({
  registerBomApp: frontendLaneMocks.bom,
}));
vi.mock("../lanes/firmware/register.app.js", () => ({
  registerFirmwareApp: frontendLaneMocks.firmware,
}));
vi.mock("../lanes/bench/register.app.js", () => ({
  registerBenchApp: frontendLaneMocks.bench,
}));
vi.mock("../lanes/documents/register.app.js", () => ({
  registerDocumentsApp: frontendLaneMocks.documents,
}));
vi.mock("../lanes/agentic/register.app.js", () => ({
  registerAgenticApp: frontendLaneMocks.agentic,
}));

import plugin from "../server.js";

const pluginRoot = resolve(import.meta.dirname, "..");

function readManifest(): unknown {
  return JSON.parse(readFileSync(resolve(pluginRoot, "package.json"), "utf8"));
}

beforeEach(() => {
  for (const register of Object.values(backendLaneMocks)) register.mockReset();
  for (const register of Object.values(frontendLaneMocks)) register.mockReset();
  backendLaneMocks.remote.mockResolvedValue(undefined);
});

describe("WP-01 scaffold", () => {
  it("manifest parses against the strict bb schema", () => {
    const manifest = pluginPackageJsonSchema.parse(readManifest());

    expect(manifest.bb.description).toBeTruthy();
    expect(manifest.bb.branding.icon).toBe("./assets/fs-icon.svg");
    expect(manifest.bb.themes?.[0]?.id).toBe("fsds-dark");
    expect(manifest.engines).toBeDefined();
    expect("engines" in manifest.bb).toBe(false);
  });

  it("manifest rejects an unknown bb key", () => {
    const manifest = pluginPackageJsonSchema.parse(readManifest());
    const invalidManifest = {
      ...manifest,
      bb: { ...manifest.bb, foo: "not allowed" },
    };

    expect(() => pluginPackageJsonSchema.parse(invalidManifest)).toThrow();
  });

  it("composition root registers all nine backend lanes in order", async () => {
    const calls: string[] = [];
    backendLaneMocks.remote.mockImplementation(async () => {
      calls.push("remote");
    });
    backendLaneMocks.sync.mockImplementation(() => calls.push("sync"));
    backendLaneMocks.findings.mockImplementation(() => calls.push("findings"));
    backendLaneMocks.productSecurity.mockImplementation(() =>
      calls.push("product-security"),
    );
    backendLaneMocks.bom.mockImplementation(() => calls.push("bom"));
    backendLaneMocks.firmware.mockImplementation(() => calls.push("firmware"));
    backendLaneMocks.bench.mockImplementation(() => calls.push("bench"));
    backendLaneMocks.documents.mockImplementation(() =>
      calls.push("documents"),
    );
    backendLaneMocks.agentic.mockImplementation(() => calls.push("agentic"));
    const host = createFakePluginHost({ pluginId: "finite-state" });

    await plugin(host.bb);

    expect(calls).toEqual([
      "remote",
      "sync",
      "findings",
      "product-security",
      "bom",
      "firmware",
      "bench",
      "documents",
      "agentic",
    ]);
    for (const register of Object.values(backendLaneMocks)) {
      expect(register).toHaveBeenCalledOnce();
    }
    await host.harness.lifecycle.dispose();
  });

  it("remote bootstrap resolves before consumer lanes", async () => {
    let releaseRemote: (() => void) | undefined;
    backendLaneMocks.remote.mockImplementation(
      () =>
        new Promise<void>((resolveRemote) => {
          releaseRemote = resolveRemote;
        }),
    );
    const host = createFakePluginHost({ pluginId: "finite-state" });

    const registration = plugin(host.bb);

    expect(backendLaneMocks.remote).toHaveBeenCalledOnce();
    for (const register of Object.values(backendLaneMocks).slice(1)) {
      expect(register).not.toHaveBeenCalled();
    }
    expect(releaseRemote).toBeDefined();
    releaseRemote?.();
    await registration;

    for (const register of Object.values(backendLaneMocks)) {
      expect(register).toHaveBeenCalledOnce();
    }
    const serverSource = readFileSync(resolve(pluginRoot, "server.ts"), "utf8");
    expect(serverSource).not.toContain("settings.define");
    await host.harness.lifecycle.dispose();
  });

  it("frontend root registers all nine app lanes in order", async () => {
    const calls: string[] = [];
    frontendLaneMocks.remote.mockImplementation(() => calls.push("remote"));
    frontendLaneMocks.sync.mockImplementation(() => calls.push("sync"));
    frontendLaneMocks.findings.mockImplementation(() => calls.push("findings"));
    frontendLaneMocks.productSecurity.mockImplementation(() =>
      calls.push("product-security"),
    );
    frontendLaneMocks.bom.mockImplementation(() => calls.push("bom"));
    frontendLaneMocks.firmware.mockImplementation(() => calls.push("firmware"));
    frontendLaneMocks.bench.mockImplementation(() => calls.push("bench"));
    frontendLaneMocks.documents.mockImplementation(() =>
      calls.push("documents"),
    );
    frontendLaneMocks.agentic.mockImplementation(() => calls.push("agentic"));
    installTestPluginRuntime();

    await loadPluginApp(() => import("../app.js"));

    expect(calls).toEqual([
      "remote",
      "sync",
      "findings",
      "product-security",
      "bom",
      "firmware",
      "bench",
      "documents",
      "agentic",
    ]);
    for (const register of Object.values(frontendLaneMocks)) {
      expect(register).toHaveBeenCalledOnce();
    }
  });

  it("db() migrates once and memoizes the real SQLite handle", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state" });
    const database = vi.spyOn(host.bb.storage, "database");
    const migrate = vi.spyOn(host.bb.storage, "migrate");
    const context = createPluginContext(host.bb);

    const first = context.db();
    const second = context.db();

    expect(first).toBe(second);
    expect(database).toHaveBeenCalledOnce();
    expect(migrate).toHaveBeenCalledOnce();
    expect(migrate).toHaveBeenCalledWith(first, MIGRATIONS);
    await host.harness.lifecycle.dispose();
  });

  it("db() retries migration before publishing a handle", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state" });
    const migrateSuccessfully = host.bb.storage.migrate.bind(host.bb.storage);
    const database = vi.spyOn(host.bb.storage, "database");
    const migrate = vi.spyOn(host.bb.storage, "migrate");
    const migratedHandles = new Set<
      ReturnType<typeof host.bb.storage.database>
    >();
    migrate.mockImplementationOnce(() => {
      throw new Error("induced migration failure");
    });
    migrate.mockImplementation((handle, migrations) => {
      migrateSuccessfully(handle, migrations);
      migratedHandles.add(handle);
    });
    const context = createPluginContext(host.bb);
    let returnedBeforeMigration:
      | ReturnType<typeof host.bb.storage.database>
      | undefined;

    expect(() => {
      returnedBeforeMigration = context.db();
    }).toThrow("induced migration failure");
    expect(returnedBeforeMigration).toBeUndefined();

    const migrated = context.db();

    expect(database).toHaveBeenCalledTimes(2);
    expect(migrate).toHaveBeenCalledTimes(2);
    expect(migratedHandles.has(migrated)).toBe(true);
    expect(context.db()).toBe(migrated);
    expect(database).toHaveBeenCalledTimes(2);
    expect(migrate).toHaveBeenCalledTimes(2);
    await host.harness.lifecycle.dispose();
  });

  it("service() memoizes by key", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state" });
    const context = createPluginContext(host.bb);
    const factory = vi.fn(() => ({ ready: true }));

    const first = context.service("remote", factory);
    const second = context.service("remote", factory);

    expect(first).toBe(second);
    expect(factory).toHaveBeenCalledOnce();
    await host.harness.lifecycle.dispose();
  });
});
