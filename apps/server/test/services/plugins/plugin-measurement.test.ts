import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getInstalledPlugin,
  setInstalledPluginEnabled,
  upsertInstalledPlugin,
  upsertPluginMarketplace,
  type DbConnection,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import {
  capturePluginStateChanged,
  clearRecommendationAttribution,
  reportPluginUse,
  resolvePluginMeasurementIdentity,
  runWithPluginMeasurementSource,
  withPluginMeasurementInvocation,
} from "../../../src/services/plugins/plugin-measurement.js";
import { CURATED_MARKETPLACE_V2_URL } from "../../../src/services/plugin-catalog/marketplace-manifest.js";
import type { TelemetryEvent } from "../../../src/services/system/telemetry.js";

let db: DbConnection;
let captured: TelemetryEvent[];
let enabled: boolean;
const deps = () => ({
  db,
  telemetry: {
    isEnabled: () => enabled,
    setEnabled: (value: boolean) => {
      enabled = value;
    },
    capture: (event: TelemetryEvent) => {
      if (enabled) captured.push(event);
    },
  },
});
function install(
  id = "browser-automation",
  overrides: Partial<Parameters<typeof upsertInstalledPlugin>[1]> = {},
) {
  return upsertInstalledPlugin(db, {
    id,
    source: `builtin:${id}`,
    provenance: { kind: "builtin" },
    sourceIntent: { kind: "builtin", name: id },
    exactResolution: { kind: "builtin" },
    updateState: {
      lastCheckAt: null,
      availableCompatibleVersion: null,
      newestIncompatibleVersion: null,
      statusDetail: null,
    },
    activeArtifactId: null,
    rootDir: `/fixture/${id}`,
    version: "1.0.0",
    enabled: true,
    enabledFollowsDefault: false,
    ...overrides,
  });
}
function marketplace(
  url = CURATED_MARKETPLACE_V2_URL,
  id = "browser-automation",
) {
  upsertPluginMarketplace(db, {
    name: "bb-community",
    sourceKind: "https",
    manifestUrl: url,
    sourceGitRef: null,
    sourceGitSubdirectory: null,
    sourceGitCommit: null,
    manifestJson: JSON.stringify({
      schemaVersion: 1,
      name: "bb-community",
      displayName: "Community",
      plugins: [
        {
          id,
          displayName: "Browser Automation",
          description: "Browser actions",
          icon: "Zap",
          author: { name: "bb" },
          source: { npm: { package: `@get-bb/${id}` } },
        },
      ],
    }),
    statsJson: null,
    etag: null,
    lastModified: null,
    lastSuccessfulRefreshAt: null,
    lastAttemptedRefreshAt: null,
    lastError: null,
  });
}

beforeEach(() => {
  db = createMigratedConnection();
  captured = [];
  enabled = true;
});
afterEach(() => db.$client.close());

describe("plugin measurement provenance", () => {
  it("maps the bundled prompt identity and rejects private copies and misleading builtin names", () => {
    const row = install("bb--prompt-library", {
      sourceIntent: { kind: "builtin", name: "prompt-library" },
      provenance: {
        kind: "catalog",
        marketplace: "bb-official",
        entryId: "prompt-library",
      },
    });
    expect(resolvePluginMeasurementIdentity(deps(), row)).toEqual({
      public_plugin: "prompt-library",
      plugin_source: "builtin",
    });
    const privateCopy = install("browser-automation", {
      provenance: { kind: "direct" },
      sourceIntent: { kind: "path", canonicalPath: "/private" },
      exactResolution: { kind: "path" },
    });
    expect(resolvePluginMeasurementIdentity(deps(), privateCopy)).toBeNull();
    capturePluginStateChanged(deps(), privateCopy.id, undefined);
    reportPluginUse(deps(), privateCopy.id, {
      action: "browser_run",
      outcome: "succeeded",
    });
    expect(captured).toEqual([]);
    const wrongBuiltin = install("browser-automation", {
      sourceIntent: { kind: "builtin", name: "workflows" },
    });
    expect(resolvePluginMeasurementIdentity(deps(), wrongBuiltin)).toBeNull();
    expect(
      resolvePluginMeasurementIdentity(
        { ...deps(), watchBuiltinPluginSources: true },
        row,
      ),
    ).toBeNull();
  });

  it("requires official catalog URL, entry and matching installed source", () => {
    const row = install("browser-automation", {
      provenance: {
        kind: "catalog",
        marketplace: "bb-community",
        entryId: "browser-automation",
      },
      sourceIntent: {
        kind: "npm",
        packageName: "@get-bb/browser-automation",
        registry: "https://registry.npmjs.org",
        requestedSpec: "latest",
        specKind: "tag",
      },
      exactResolution: {
        kind: "npm",
        version: "1.0.0",
        integrity: "sha512-fixture",
      },
    });
    marketplace("https://private.example/marketplace.json");
    expect(resolvePluginMeasurementIdentity(deps(), row)).toBeNull();
    marketplace();
    expect(resolvePluginMeasurementIdentity(deps(), row)).toEqual({
      public_plugin: "browser-automation",
      plugin_source: "public_catalog",
    });
    expect(
      resolvePluginMeasurementIdentity(deps(), {
        ...row,
        sourceNpmPackage: "private-browser",
      }),
    ).toBeNull();
    expect(
      resolvePluginMeasurementIdentity(deps(), {
        ...row,
        catalogEntryId: "private-browser",
      }),
    ).toBeNull();
  });
});

describe("confirmed state changes", () => {
  it("captures transitions with explicit source and defaults absent context to unknown", () => {
    const row = install();
    capturePluginStateChanged(deps(), row.id, undefined);
    capturePluginStateChanged(deps(), row.id, row);
    runWithPluginMeasurementSource("first_run", null, () => {
      setInstalledPluginEnabled(db, row.id, false);
      capturePluginStateChanged(deps(), row.id, row);
    });
    const disabled = getInstalledPlugin(db, row.id);
    setInstalledPluginEnabled(db, row.id, true);
    capturePluginStateChanged(deps(), row.id, disabled);
    expect(
      captured.map((event) =>
        "properties" in event ? event.properties : null,
      ),
    ).toEqual([
      {
        public_plugin: "browser-automation",
        plugin_source: "builtin",
        surface: "unknown",
        entry: null,
        previous_state: "absent",
        state: "enabled",
      },
      {
        public_plugin: "browser-automation",
        plugin_source: "builtin",
        surface: "onboarding",
        entry: "first_run",
        previous_state: "enabled",
        state: "disabled",
      },
      {
        public_plugin: "browser-automation",
        plugin_source: "builtin",
        surface: "unknown",
        entry: null,
        previous_state: "disabled",
        state: "enabled",
      },
    ]);
  });

  it("retains each source across interleaved asynchronous work", async () => {
    const browser = install();
    const workflows = install("workflows");
    await Promise.all([
      runWithPluginMeasurementSource("first_run", null, async () => {
        await Promise.resolve();
        capturePluginStateChanged(deps(), browser.id, undefined);
      }),
      runWithPluginMeasurementSource("replay", null, async () => {
        capturePluginStateChanged(deps(), workflows.id, undefined);
        await Promise.resolve();
      }),
    ]);
    const editor = install("monaco-editor");
    capturePluginStateChanged(deps(), editor.id, undefined);
    expect(
      captured.map((event) =>
        event.name === "plugin_state_changed"
          ? [
              event.properties.public_plugin,
              event.properties.entry ?? event.properties.surface,
            ]
          : null,
      ),
    ).toEqual([
      ["workflows", "replay"],
      ["browser-automation", "first_run"],
      ["monaco-editor", "unknown"],
    ]);
  });

  it("does not collect opted-out state changes or invent replay on resume", () => {
    const row = install();
    enabled = false;
    capturePluginStateChanged(deps(), row.id, undefined);
    enabled = true;
    capturePluginStateChanged(deps(), row.id, row);
    expect(captured).toEqual([]);
  });
});

describe("intentional use", () => {
  it("deduplicates nested wrappers and outcomes while preserving separate invocations", async () => {
    install();
    const report = () =>
      reportPluginUse(deps(), "browser-automation", {
        action: "browser_run",
        outcome: "invoked",
      });
    await withPluginMeasurementInvocation(
      "browser-automation",
      "agent",
      async () => {
        report();
        await Promise.resolve();
        withPluginMeasurementInvocation("browser-automation", "user", report);
        reportPluginUse(deps(), "browser-automation", {
          action: "browser_run",
          outcome: "succeeded",
        });
      },
    );
    withPluginMeasurementInvocation("browser-automation", "user", report);
    expect(
      captured.map((event) =>
        event.name === "plugin_use"
          ? [event.properties.outcome, event.properties.initiator]
          : null,
      ),
    ).toEqual([
      ["invoked", "agent"],
      ["succeeded", "agent"],
      ["invoked", "user"],
    ]);
  });

  it("ignores private state and use while rejecting reported spoofed identity", () => {
    const privateRow = install("private-name", {
      sourceIntent: { kind: "path", canonicalPath: "/private" },
      exactResolution: { kind: "path" },
      provenance: { kind: "direct" },
    });
    capturePluginStateChanged(deps(), privateRow.id, undefined);
    reportPluginUse(deps(), "private-name", {
      action: "browser_run",
      outcome: "invoked",
    });
    expect(captured).toEqual([]);
    expect(() =>
      reportPluginUse(deps(), "private-name", {
        action: "browser_run",
        outcome: "invoked",
        public_plugin: "browser-automation",
      }),
    ).toThrow();
    install();
    expect(() =>
      reportPluginUse(deps(), "browser-automation", {
        action: "editor_opened",
        outcome: "observed",
      }),
    ).toThrow();
  });

  it("does not turn an observed frontend action into server-confirmed execution", () => {
    install("monaco-editor");
    expect(() =>
      reportPluginUse(deps(), "monaco-editor", {
        action: "editor_opened",
        outcome: "succeeded",
      }),
    ).toThrow();
    reportPluginUse(deps(), "monaco-editor", {
      action: "editor_opened",
      outcome: "observed",
      initiator: "user",
    });
    enabled = false;
    reportPluginUse(deps(), "monaco-editor", {
      action: "file_saved",
      outcome: "succeeded",
    });
    expect(captured).toHaveLength(1);
  });
});

it("attributes a public plugin outside the old list only after enable, clears on consent and disable", () => {
  const id = "new-recommended-plugin";
  marketplace(CURATED_MARKETPLACE_V2_URL, id);
  const row = install(id, {
    enabled: false,
    provenance: { kind: "catalog", marketplace: "bb-community", entryId: id },
    sourceIntent: {
      kind: "npm",
      packageName: `@get-bb/${id}`,
      registry: "https://registry.npmjs.org",
      requestedSpec: "latest",
      specKind: "tag",
    },
    exactResolution: {
      kind: "npm",
      version: "1.0.0",
      integrity: "sha512-fixture",
    },
  });
  const recommendationId = "00000000-0000-4000-8000-000000000001";
  runWithPluginMeasurementSource("first_run", recommendationId, () => {
    capturePluginStateChanged(deps(), id, row);
    expect(captured).toHaveLength(0);
    setInstalledPluginEnabled(db, id, true);
    capturePluginStateChanged(deps(), id, row);
  });
  withPluginMeasurementInvocation(id, "user", () => {
    reportPluginUse(deps(), id, {
      action: "cli_invoked",
      outcome: "succeeded",
    });
    reportPluginUse(deps(), id, {
      action: "cli_invoked",
      outcome: "succeeded",
    });
  });
  expect(
    captured.map((event) =>
      event.name === "recommendation" ? event.properties.action : event.name,
    ),
  ).toEqual(["selected", "used"]);
  clearRecommendationAttribution(db);
  reportPluginUse(deps(), id, { action: "cli_invoked", outcome: "succeeded" });
  expect(captured.at(-1)?.name).toBe("plugin_use");
  const current = getInstalledPlugin(db, id);
  setInstalledPluginEnabled(db, id, false);
  capturePluginStateChanged(deps(), id, current);
  const disabled = getInstalledPlugin(db, id);
  runWithPluginMeasurementSource("replay", recommendationId, () => {
    setInstalledPluginEnabled(db, id, true);
    capturePluginStateChanged(deps(), id, disabled);
  });
  setInstalledPluginEnabled(db, id, false);
  capturePluginStateChanged(deps(), id, getInstalledPlugin(db, id));
  setInstalledPluginEnabled(db, id, true);
  reportPluginUse(deps(), id, { action: "tool_invoked", outcome: "succeeded" });
  expect(captured.at(-1)?.name).toBe("plugin_use");
});
