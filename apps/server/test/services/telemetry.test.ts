import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTelemetryService } from "../../src/services/system/telemetry.js";

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
      appVersion: "1.2.3",
      dataDir,
      enabled: true,
      logger: createTestLogger(),
    });

    telemetry.capture({ name: "app_started" });
    telemetry.capture({
      name: "thread_created",
      properties: {
        is_child_thread: true,
        provider: "claude-code",
      },
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
        arch: process.arch,
        platform: process.platform,
      },
    });
    expect(calls[1]?.payload).toMatchObject({
      event: "thread_created",
      properties: {
        app_version: "1.2.3",
        is_child_thread: true,
        provider: "claude-code",
      },
    });
    expect(calls[2]?.payload).toMatchObject({
      event: "user_message_sent",
      properties: {
        app_version: "1.2.3",
        is_child_thread: false,
        message_source: "thread_send",
        provider: "codex",
      },
    });
  });

  it("reuses the persisted install id across restarts", async () => {
    const args = {
      apiKey: "phc_test",
      appVersion: "1.2.3",
      dataDir,
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
    { apiKey: "", enabled: true, label: "no API key" },
    { apiKey: "phc_test", enabled: false, label: "opted out" },
  ])("is fully inert when $label", async ({ apiKey, enabled }) => {
    const telemetry = await createTelemetryService({
      apiKey,
      appVersion: "1.2.3",
      dataDir,
      enabled,
      logger: createTestLogger(),
    });
    telemetry.capture({ name: "app_started" });

    expect(fetchMock).not.toHaveBeenCalled();
    await expect(readdir(dataDir)).resolves.toEqual([]);
  });

  it("logs and swallows send failures", async () => {
    const logger = createTestLogger();
    fetchMock.mockRejectedValue(new Error("offline"));
    const telemetry = await createTelemetryService({
      apiKey: "phc_test",
      appVersion: "1.2.3",
      dataDir,
      enabled: true,
      logger,
    });

    telemetry.capture({ name: "app_started" });
    await vi.waitFor(() => {
      expect(logger.debug).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        "Telemetry event send failed",
      );
    });
  });
});
