import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createConnection,
  migrate,
  getAppSettings,
  setAppSettings,
} from "@bb/db";
import { defaultAppSettings } from "@bb/domain";
import { withTestHarness } from "../helpers/test-app.js";
import { DEFAULTS } from "@bb/config/defaults";
import { loadServerConfig } from "@bb/config/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appInstallFromServerConfig,
  createTelemetryService,
  runWithTelemetryAppSurface,
} from "../../src/services/system/telemetry.js";

function createTestLogger() {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

describe("telemetry service", () => {
  let dataDir: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "bb-telemetry-test-"));
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("sends events with a stable anonymous install id", async () => {
    const telemetry = await createTelemetryService({
      apiKey: "phc_test",
      appInstall: null,
      appSurface: "web",
      appVersion: "1.2.3",
      dataDir,
      installCampaign: null,
      telemetryEnabled: true,
      enabled: true,
      logger: createTestLogger(),
    });

    telemetry.capture({ name: "app_started" });
    runWithTelemetryAppSurface("desktop", () => {
      telemetry.capture({
        name: "thread_created",
        properties: {
          is_child_thread: true,
          provider: "claude-code",
        },
      });
    });
    telemetry.capture({
      name: "user_message_sent",
      properties: {
        is_child_thread: false,
        message_source: "thread_send",
        provider: "codex",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const persistedId = (
      await readFile(join(dataDir, "telemetry-id"), "utf8")
    ).trim();
    expect(persistedId).toMatch(/^[0-9a-f]{32}$/);

    const calls = fetchMock.mock.calls.map((call) => {
      const [url, init] = call as [string, { body: string }];
      return { url, payload: JSON.parse(init.body) as Record<string, never> };
    });
    for (const { url, payload } of calls) {
      expect(url).toBe("https://us.i.posthog.com/capture/");
      expect(payload).toMatchObject({
        api_key: "phc_test",
        distinct_id: persistedId,
      });
    }
    expect(calls[0]?.payload).toMatchObject({
      event: "app_started",
      properties: {
        app_version: "1.2.3",
        app_surface: "web",
        arch: process.arch,
        platform: process.platform,
      },
    });
    expect(calls[1]?.payload).toMatchObject({
      event: "thread_created",
      properties: {
        app_version: "1.2.3",
        app_surface: "desktop",
        is_child_thread: true,
        provider: "claude-code",
      },
    });
    expect(calls[2]?.payload).toMatchObject({
      event: "user_message_sent",
      properties: {
        app_version: "1.2.3",
        app_surface: "web",
        is_child_thread: false,
        message_source: "thread_send",
        provider: "codex",
      },
    });
  });

  it("tags events with how bb was installed without sending any commits", async () => {
    const commit = "a".repeat(40);
    const installs = [
      appInstallFromServerConfig({}),
      appInstallFromServerConfig({ BB_APP_INSTALL_KIND: "npm" }),
      appInstallFromServerConfig({
        BB_APP_INSTALL_KIND: "source",
        BB_APP_SOURCE_COMMIT: commit,
        BB_APP_SOURCE_ORIGIN: "official",
      }),
      appInstallFromServerConfig({
        BB_APP_INSTALL_KIND: "source",
        BB_APP_SOURCE_COMMIT: commit,
        BB_APP_SOURCE_ORIGIN: "fork",
      }),
    ];
    for (const appInstall of installs) {
      const telemetry = await createTelemetryService({
        apiKey: "phc_test",
        appInstall,
        appSurface: "web",
        appVersion: "1.2.3",
        dataDir,
        installCampaign: null,
        telemetryEnabled: true,
        enabled: true,
        logger: createTestLogger(),
      });
      telemetry.capture({ name: "app_started" });
    }

    const properties = fetchMock.mock.calls.map((call) => {
      const [, init] = call as [string, { body: string }];
      return (JSON.parse(init.body) as { properties: Record<string, unknown> })
        .properties;
    });
    expect(properties[0]).toMatchObject({
      install_kind: "unmanaged",
      node_version: process.version,
    });
    expect(properties[0]).not.toHaveProperty("source_origin");
    expect(properties[1]).toMatchObject({ install_kind: "npm" });
    expect(properties[2]).toMatchObject({
      install_kind: "source",
      source_origin: "official",
    });
    expect(properties[3]).toMatchObject({
      install_kind: "source",
      source_origin: "fork",
    });
    for (const payload of properties) {
      expect(payload).not.toHaveProperty("source_commit");
      expect(JSON.stringify(payload)).not.toContain(commit);
    }
  });

  it("reuses the persisted install id across restarts", async () => {
    const args = {
      apiKey: "phc_test",
      appInstall: null,
      appSurface: "web" as const,
      appVersion: "1.2.3",
      dataDir,
      installCampaign: null,
      telemetryEnabled: true,
      enabled: true,
      logger: createTestLogger(),
    };
    const first = await createTelemetryService(args);
    first.capture({ name: "app_started" });
    const second = await createTelemetryService(args);
    second.capture({ name: "app_started" });

    const ids = fetchMock.mock.calls.map((call) => {
      const [, init] = call as [string, { body: string }];
      return (JSON.parse(init.body) as { distinct_id: string }).distinct_id;
    });
    expect(ids[0]).toBe(ids[1]);
  });

  it.each([
    {
      apiKey: "",
      appVersion: "1.2.3",
      enabled: true,
      label: "there is no API key",
    },
    {
      apiKey: "phc_test",
      appVersion: "1.2.3",
      enabled: false,
      label: "the user opted out",
    },
    {
      apiKey: "phc_test",
      appVersion: DEFAULTS.appVersion,
      enabled: true,
      label: "the release version is unresolved",
    },
  ])("is fully inert when $label", async ({ apiKey, appVersion, enabled }) => {
    const telemetry = await createTelemetryService({
      apiKey,
      appInstall: null,
      appSurface: "web",
      appVersion,
      dataDir,
      installCampaign: null,
      telemetryEnabled: true,
      enabled,
      logger: createTestLogger(),
    });
    telemetry.setEnabled(true);
    telemetry.capture({ name: "app_started" });

    expect(fetchMock).not.toHaveBeenCalled();
    await expect(readdir(dataDir)).resolves.toEqual([]);
  });

  it("honors persisted opt-out at startup and changes without restarting", async () => {
    const db = createConnection(":memory:");
    migrate(db);
    try {
      setAppSettings(db, { ...getAppSettings(db), telemetryEnabled: false });
      const args = {
        apiKey: "phc_test",
        appInstall: null,
        appSurface: "web" as const,
        appVersion: "1.2.3",
        dataDir,
        enabled: true,
        installCampaign: null,
        telemetryEnabled: getAppSettings(db).telemetryEnabled,
        logger: createTestLogger(),
      };
      const telemetry = await createTelemetryService(args);
      telemetry.capture({ name: "app_started" });
      expect(fetchMock).not.toHaveBeenCalled();
      setAppSettings(db, { ...getAppSettings(db), telemetryEnabled: true });
      telemetry.setEnabled(true);
      telemetry.capture({ name: "app_started" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      setAppSettings(db, { ...getAppSettings(db), telemetryEnabled: false });
      telemetry.setEnabled(false);
      telemetry.capture({ name: "app_started" });
      const restarted = await createTelemetryService({
        ...args,
        telemetryEnabled: getAppSettings(db).telemetryEnabled,
      });
      restarted.capture({ name: "app_started" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      db.$client.close();
    }
  });

  it("updates the cached preference only after valid settings writes", async () => {
    await withTestHarness(async (harness) => {
      const telemetry = await createTelemetryService({
        apiKey: "phc_test",
        appInstall: null,
        appSurface: "web",
        appVersion: "1.2.3",
        dataDir,
        enabled: true,
        installCampaign: null,
        telemetryEnabled: getAppSettings(harness.db).telemetryEnabled,
        logger: createTestLogger(),
      });
      harness.deps.telemetry = telemetry;
      const put = (settings: object) =>
        harness.app.request("/api/v1/settings/general", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(settings),
        });
      telemetry.capture({ name: "app_started" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(
        (await put({ ...defaultAppSettings, telemetryEnabled: false })).status,
      ).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [, optOutRequest] = fetchMock.mock.calls[1] as [
        string,
        { body: string },
      ];
      const [, appStartedRequest] = fetchMock.mock.calls[0] as [
        string,
        { body: string },
      ];
      const optOutEvent = JSON.parse(optOutRequest.body) as {
        distinct_id: string;
        event: string;
      };
      const appStartedEvent = JSON.parse(appStartedRequest.body) as {
        distinct_id: string;
      };
      expect(optOutEvent).toMatchObject({
        distinct_id: appStartedEvent.distinct_id,
        event: "telemetry_disabled",
      });
      telemetry.capture({ name: "app_started" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(
        (await put({ ...defaultAppSettings, telemetryEnabled: false })).status,
      ).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect((await put({ telemetryEnabled: true })).status).toBe(400);
      telemetry.capture({ name: "app_started" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const { telemetryEnabled, ...legacy } = defaultAppSettings;
      expect(telemetryEnabled).toBe(true);
      expect((await put(legacy)).status).toBe(200);
      telemetry.capture({ name: "app_started" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect((await put(defaultAppSettings)).status).toBe(200);
      telemetry.capture({ name: "app_started" });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  it("tags only the first app_started of a new install with its campaign", async () => {
    const args = {
      apiKey: "phc_test",
      appInstall: null,
      appSurface: "web" as const,
      appVersion: "1.2.3",
      dataDir,
      enabled: true,
      installCampaign: "claude-code-alt",
      telemetryEnabled: true,
      logger: createTestLogger(),
    };
    const first = await createTelemetryService(args);
    first.capture({ name: "app_started" });
    first.capture({ name: "app_started" });
    first.capture({
      name: "thread_created",
      properties: { is_child_thread: false, provider: "codex" },
    });
    const restarted = await createTelemetryService(args);
    restarted.capture({ name: "app_started" });

    const payloads = fetchMock.mock.calls.map((call) => {
      const [, init] = call as [string, { body: string }];
      return JSON.parse(init.body) as {
        event: string;
        properties: Record<string, unknown>;
      };
    });
    expect(payloads).toHaveLength(4);
    expect(payloads[0]).toMatchObject({
      event: "app_started",
      properties: { install_campaign: "claude-code-alt" },
    });
    for (const payload of payloads.slice(1)) {
      expect(payload.properties).not.toHaveProperty("install_campaign");
    }
  });

  it("never sends a campaign when the first app_started is opted out", async () => {
    const telemetry = await createTelemetryService({
      apiKey: "phc_test",
      appInstall: null,
      appSurface: "web",
      appVersion: "1.2.3",
      dataDir,
      enabled: true,
      installCampaign: "claude-code-alt",
      telemetryEnabled: false,
      logger: createTestLogger(),
    });
    telemetry.capture({ name: "app_started" });
    telemetry.setEnabled(true);
    telemetry.capture({ name: "app_started" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(
      (JSON.parse(init.body) as { properties: Record<string, unknown> })
        .properties,
    ).not.toHaveProperty("install_campaign");
  });

  it("ignores an invalid campaign from the environment", async () => {
    const config = loadServerConfig({
      env: {
        BB_DATA_DIR: dataDir,
        BB_HOST_DAEMON_PORT: "5555",
        BB_INSTALL_CAMPAIGN: "Not A Slug",
        BB_SERVER_PORT: "4444",
        NODE_ENV: "development",
      },
    });
    const telemetry = await createTelemetryService({
      apiKey: "phc_test",
      appInstall: null,
      appSurface: "web",
      appVersion: "1.2.3",
      dataDir,
      enabled: true,
      installCampaign: config.BB_INSTALL_CAMPAIGN ?? null,
      telemetryEnabled: true,
      logger: createTestLogger(),
    });
    telemetry.capture({ name: "app_started" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(
      (JSON.parse(init.body) as { properties: Record<string, unknown> })
        .properties,
    ).not.toHaveProperty("install_campaign");
  });

  it("logs and swallows send failures", async () => {
    const logger = createTestLogger();
    fetchMock.mockRejectedValue(new Error("offline"));
    const telemetry = await createTelemetryService({
      apiKey: "phc_test",
      appInstall: null,
      appSurface: "desktop",
      appVersion: "1.2.3",
      dataDir,
      installCampaign: null,
      telemetryEnabled: true,
      enabled: true,
      logger,
    });

    telemetry.capture({ name: "app_started" });
    await vi.waitFor(() => {
      expect(logger.debug).toHaveBeenCalledWith(
        {
          app_surface: "desktop",
          err: expect.any(Error),
          event: "app_started",
        },
        "Telemetry event send failed",
      );
    });
  });
});
