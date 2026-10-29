import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getInstalledPlugin,
  setInstalledPluginEnabled,
  upsertInstalledPlugin,
  upsertPluginMarketplace,
  type DbConnection,
  type UpsertInstalledPluginInput,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import {
  capturePluginStateChanged,
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
  overrides: Partial<UpsertInstalledPluginInput> = {},
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
function marketplace(url = CURATED_MARKETPLACE_V2_URL) {
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
          id: "browser-automation",
          displayName: "Browser Automation",
          description: "Browser actions",
          icon: "Zap",
          author: { name: "bb" },
          source: { npm: { package: "@get-bb/browser-automation" } },
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
    });
    expect(resolvePluginMeasurementIdentity(deps(), privateCopy)).toEqual({
      public_plugin: null,
      plugin_source: "local",
    });
    const wrongBuiltin = install("browser-automation", {
      sourceIntent: { kind: "builtin", name: "workflows" },
    });
    expect(
      resolvePluginMeasurementIdentity(deps(), wrongBuiltin).public_plugin,
    ).toBeNull();
    expect(
      resolvePluginMeasurementIdentity(
        { ...deps(), watchBuiltinPluginSources: true },
        row,
      ).public_plugin,
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
    expect(resolvePluginMeasurementIdentity(deps(), row)).toEqual({
      public_plugin: null,
      plugin_source: "private",
    });
    marketplace();
    expect(resolvePluginMeasurementIdentity(deps(), row)).toEqual({
      public_plugin: "browser-automation",
      plugin_source: "public_catalog",
    });
    expect(
      resolvePluginMeasurementIdentity(deps(), {
        ...row,
        sourceNpmPackage: "private-browser",
      }).public_plugin,
    ).toBeNull();
    expect(
      resolvePluginMeasurementIdentity(deps(), {
        ...row,
        catalogEntryId: "private-browser",
      }).public_plugin,
    ).toBeNull();
  });
});

describe("confirmed state changes", () => {
  it("captures transitions with explicit source and defaults absent context to unknown", () => {
    const row = install();
    capturePluginStateChanged(deps(), row.id, undefined);
    capturePluginStateChanged(deps(), row.id, row);
    runWithPluginMeasurementSource("first_run", () => {
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
        source: "unknown",
        previous_state: "absent",
        state: "enabled",
      },
      {
        public_plugin: "browser-automation",
        plugin_source: "builtin",
        source: "first_run",
        previous_state: "enabled",
        state: "disabled",
      },
      {
        public_plugin: "browser-automation",
        plugin_source: "builtin",
        source: "unknown",
        previous_state: "disabled",
        state: "enabled",
      },
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
      deps(),
      "browser-automation",
      "agent",
      async () => {
        report();
        await Promise.resolve();
        withPluginMeasurementInvocation(
          deps(),
          "browser-automation",
          "user",
          report,
        );
        reportPluginUse(deps(), "browser-automation", {
          action: "browser_run",
          outcome: "succeeded",
        });
      },
    );
    withPluginMeasurementInvocation(
      deps(),
      "browser-automation",
      "user",
      report,
    );
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

  it("only counts explicit dispatch for anonymous plugins and rejects reported spoofed identity", () => {
    install("private-name", {
      sourceIntent: { kind: "path", canonicalPath: "/private" },
      provenance: { kind: "direct" },
    });
    reportPluginUse(deps(), "private-name", {
      action: "browser_run",
      outcome: "invoked",
    });
    expect(captured).toEqual([]);
    withPluginMeasurementInvocation(deps(), "private-name", "unknown", () => {
      withPluginMeasurementInvocation(
        deps(),
        "private-name",
        "unknown",
        () => {},
      );
    });
    expect(captured).toEqual([
      {
        name: "plugin_use",
        properties: {
          public_plugin: null,
          plugin_source: "local",
          initiator: "unknown",
          action: "other_action",
          outcome: "invoked",
        },
      },
    ]);
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
    withPluginMeasurementInvocation(deps(), "monaco-editor", "agent", () => {});
    expect(captured).toHaveLength(1);
  });
});
