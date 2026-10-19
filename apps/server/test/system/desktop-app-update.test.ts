import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopAppUpdateInfo,
  DesktopAppUpdateRequest,
} from "@bb/config/desktop-app-update";
import { createDesktopAppUpdateService } from "../../src/services/system/desktop-app-update.js";
import type { DesktopUpdateChannel } from "../../src/services/system/desktop-update-channel.js";
import type { AppUpdateService } from "../../src/services/system/app-update.js";
import { testLogger } from "../helpers/test-app.js";

class DesktopChannel implements DesktopUpdateChannel {
  info: DesktopAppUpdateInfo = {
    supported: true,
    version: "1.0.0",
    latestVersion: "1.1.0",
    pendingVersion: null,
    updateAvailable: true,
    updateDownloaded: false,
    downloadState: "downloading",
  };
  requests: DesktopAppUpdateRequest["action"][] = [];
  listeners = new Set<(info: DesktopAppUpdateInfo | null) => void>();
  async request(
    action: DesktopAppUpdateRequest["action"],
  ): Promise<DesktopAppUpdateInfo> {
    this.requests.push(action);
    return this.info;
  }
  subscribe(listener: (info: DesktopAppUpdateInfo | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  push(info: Partial<DesktopAppUpdateInfo>): void {
    this.info = { ...this.info, ...info };
    for (const listener of this.listeners) listener(this.info);
  }
  dispose(): void {
    this.listeners.clear();
  }
}

const roots: string[] = [];
const services: AppUpdateService[] = [];

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-desktop-update-"));
  roots.push(dataDir);
  const channel = new DesktopChannel();
  const running = { count: 0 };
  const create = (currentVersion: string) => {
    const service = createDesktopAppUpdateService({
      channel,
      currentVersion,
      dataDir,
      countRunningThreads: () => running.count,
      notifyChanged: vi.fn(),
      logger: testLogger,
    });
    services.push(service);
    return service;
  };
  return { channel, running, create, service: create("1.0.0") };
}

afterEach(async () => {
  for (const service of services.splice(0)) service.dispose();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("desktop-hosted server updates", () => {
  it("confirms running threads, waits for the download, and records the new server after restart", async () => {
    const { service, channel, running, create } = await fixture();
    const status = await service.getStatus({ forceRefresh: true });
    expect(status).toMatchObject({
      desktopUpdateSupported: true,
      support: { kind: "unsupported", reason: "desktop" },
      current: { version: "1.0.0" },
      available: { version: "1.1.0" },
    });
    running.count = 2;
    await expect(
      service.apply({ confirmInterruptingThreads: false }),
    ).rejects.toMatchObject({
      body: { code: "threads_running", details: { runningThreadCount: 2 } },
    });
    expect(channel.requests).not.toContain("install");

    await service.apply({ confirmInterruptingThreads: true });
    expect(
      (await service.getStatus({ forceRefresh: false })).activity.phase,
    ).toBe("preparing");
    await expect(
      service.apply({ confirmInterruptingThreads: true }),
    ).rejects.toMatchObject({ body: { code: "app_update_in_progress" } });
    expect(channel.requests).not.toContain("install");
    channel.push({
      updateDownloaded: true,
      pendingVersion: "1.1.0",
      downloadState: "downloaded",
    });
    await vi.waitFor(
      () =>
        expect(
          channel.requests.filter((action) => action === "install"),
        ).toHaveLength(1),
      { timeout: 3_000 },
    );
    service.dispose();

    const restarted = create("1.1.0");
    const result = (await restarted.getStatus({ forceRefresh: false }))
      .lastResult;
    expect(result).toMatchObject({
      outcome: "updated",
      from: { version: "1.0.0" },
      to: { version: "1.1.0" },
    });
    if (result === null) throw new Error("expected persisted update result");
    expect(
      (await restarted.acknowledgeResult({ id: result.id })).lastResult
        ?.acknowledged,
    ).toBe(true);
  });

  it("keeps the server running when a new thread starts during download", async () => {
    const { service, channel, running } = await fixture();
    await service.apply({ confirmInterruptingThreads: false });
    running.count = 1;
    channel.push({
      updateDownloaded: true,
      pendingVersion: "1.1.0",
      downloadState: "downloaded",
    });
    await vi.waitFor(async () =>
      expect(
        (await service.getStatus({ forceRefresh: false })).lastResult?.message,
      ).toContain("1 thread started while bb was downloading"),
    );
    expect(channel.requests).not.toContain("install");
    expect(
      (await service.getStatus({ forceRefresh: false })).activity.phase,
    ).toBe("idle");
  });

  it("reports a failed download without restarting and allows another attempt", async () => {
    const { service, channel } = await fixture();
    await service.apply({ confirmInterruptingThreads: false });
    channel.push({ downloadState: "failed" });
    await vi.waitFor(async () =>
      expect(
        (await service.getStatus({ forceRefresh: false })).lastResult?.message,
      ).toContain("Download failed"),
    );
    expect(channel.requests).not.toContain("install");
    channel.push({ downloadState: "downloading" });
    await expect(
      service.apply({ confirmInterruptingThreads: false }),
    ).resolves.toMatchObject({ activity: { phase: "preparing" } });
  });

  it("keeps confirmed update support after a timeout and accepts a successful retry", async () => {
    const { service, channel } = await fixture();
    await service.getStatus({ forceRefresh: true });
    const request = vi.spyOn(channel, "request");
    request.mockRejectedValue(new Error("The desktop app did not respond."));

    expect(await service.getStatus({ forceRefresh: true })).toMatchObject({
      desktopUpdateSupported: true,
      blocked: { reason: "fetch-failed" },
    });
    await expect(
      service.apply({ confirmInterruptingThreads: false }),
    ).rejects.toMatchObject({ body: { code: "app_update_blocked" } });
    expect(channel.requests).not.toContain("install");

    request.mockRestore();
    expect(await service.getStatus({ forceRefresh: true })).toMatchObject({
      desktopUpdateSupported: true,
      blocked: null,
      available: { version: "1.1.0" },
    });
    await expect(
      service.apply({ confirmInterruptingThreads: false }),
    ).resolves.toMatchObject({ activity: { phase: "preparing" } });
  });

  it("does not offer an update action when the native updater cannot install", async () => {
    const { service, channel } = await fixture();
    channel.push({ supported: false });
    expect(
      (await service.getStatus({ forceRefresh: false })).desktopUpdateSupported,
    ).toBeUndefined();
    await expect(
      service.apply({ confirmInterruptingThreads: true }),
    ).rejects.toMatchObject({ body: { code: "app_update_unsupported" } });
    expect(channel.requests).not.toContain("install");
  });
});
