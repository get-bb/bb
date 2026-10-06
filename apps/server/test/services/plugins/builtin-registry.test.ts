import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BUILTIN_PLUGIN_ID_PREFIX,
  BUNDLED_PLUGINS,
  resolveBuiltinPluginRootPathForModuleDir,
} from "../../../src/services/plugins/builtin-registry.js";
import { resolveBundledMarketplaceDirectory } from "../../../src/services/plugin-catalog/bundled-marketplace.js";

const UNPREFIXED_BUNDLED_PLUGIN_IDS = [
  "account-pool",
  "agent-annotations",
  "ask-user-question",
  "automations",
  "bb-account",
  "bb-ai",
  "bb-guide",
  "browser-automation",
  "concurrency-limit",
  "connect",
  "custom-instructions",
  "drafts",
  "environment-git-worktree",
  "environment-modal-sandbox",
  "environment-personal-workspace",
  "environment-project-checkout",
  "github",
  "inline-vis",
  "keep-awake",
  "memory",
  "monaco-editor",
  "navigation",
  "pdf-preview",
  "plugin-api-docs",
  "plugin-api-tester",
  "provider-acp",
  "provider-claude-code",
  "provider-codex",
  "provider-pi",
  "provider-retry",
  "push-notifications",
  "scheduled-send",
  "secrets",
  "side-chat",
  "simple-notes",
  "tasks",
  "theme-preview",
  "thread-list",
  "workflows",
];

describe("bundled plugin ids", () => {
  it("prefixes every bundled plugin added after the reservation with bb--", () => {
    const unprefixed = BUNDLED_PLUGINS.map((plugin) => plugin.pluginId)
      .filter((pluginId) => !pluginId.startsWith(BUILTIN_PLUGIN_ID_PREFIX))
      .sort();

    expect(unprefixed).toEqual(UNPREFIXED_BUNDLED_PLUGIN_IDS);
  });
});

describe("bundled plugin artifact resolution", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bb-builtin-resolution-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeBundle(directory: string) {
    await mkdir(join(directory, "connect"), { recursive: true });
    await writeFile(join(directory, "marketplace.json"), "{}");
  }

  it("uses newly prepared plugins and catalog when an upgrade leaves old server artifacts", async () => {
    const moduleDir = join(root, "apps/server/dist");
    const stale = join(moduleDir, "builtin-plugins");
    const prepared = join(root, "packages/bundled-plugins/dist");
    await writeBundle(stale);
    await writeBundle(prepared);

    expect(
      resolveBuiltinPluginRootPathForModuleDir({ moduleDir, name: "connect" }),
    ).toBe(join(prepared, "connect"));
    expect(resolveBundledMarketplaceDirectory(moduleDir)).toBe(prepared);
  });

  it("loads the bundled artifacts shipped inside an installed package", async () => {
    const moduleDir = join(root, "node_modules/bb-app/server/dist");
    const packaged = join(moduleDir, "builtin-plugins");
    await writeBundle(packaged);

    expect(
      resolveBuiltinPluginRootPathForModuleDir({ moduleDir, name: "connect" }),
    ).toBe(join(packaged, "connect"));
    expect(resolveBundledMarketplaceDirectory(moduleDir)).toBe(packaged);
  });

  it("retains source development plugin and generated catalog resolution", async () => {
    const moduleDir = join(root, "apps/server/src/services/plugins");
    const plugin = join(root, "plugins/connect");
    const catalog = join(
      root,
      "apps/server/src/generated/bb-official-marketplace",
    );
    await mkdir(plugin, { recursive: true });
    await mkdir(catalog, { recursive: true });
    await writeFile(join(catalog, "marketplace.json"), "{}");

    expect(
      resolveBuiltinPluginRootPathForModuleDir({ moduleDir, name: "connect" }),
    ).toBe(plugin);
    expect(resolveBundledMarketplaceDirectory(moduleDir)).toBe(catalog);
  });
});
