import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveConnectBaseUrl } from "./redeem.js";
import {
  readConnectCredential,
  writeConnectCredential,
} from "./credential-store.js";
import { ConnectTunnelService } from "./tunnel-service.js";

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("deriveConnectBaseUrl", () => {
  it("drops the handle label to reach the apex", () => {
    expect(deriveConnectBaseUrl("https://sawyer.getbb.app")).toBe(
      "https://getbb.app",
    );
    expect(deriveConnectBaseUrl("https://my-box.vibecodethis.site/")).toBe(
      "https://vibecodethis.site",
    );
  });
});

describe("connect credential store", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips the credential and ignores malformed files", () => {
    dir = mkdtempSync(join(tmpdir(), "bb-connect-svc-"));
    expect(readConnectCredential(dir)).toBeNull();
    writeConnectCredential(dir, {
      serverUrl: "https://sawyer.getbb.app",
      handle: "sawyer",
      credential: "bbcred_x",
    });
    expect(readConnectCredential(dir)).toEqual({
      serverUrl: "https://sawyer.getbb.app",
      handle: "sawyer",
      credential: "bbcred_x",
    });
  });
});

describe("ConnectTunnelService", () => {
  let dir: string;
  let service: ConnectTunnelService | undefined;
  afterEach(() => {
    // Always tear down the (dead) tunnel socket + reconnect timer.
    service?.stop();
    service = undefined;
    vi.unstubAllGlobals();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("starts unpaired", () => {
    dir = mkdtempSync(join(tmpdir(), "bb-connect-svc-"));
    service = new ConnectTunnelService({
      dataDir: dir,
      loopbackBaseUrl: "http://127.0.0.1:38886",
      logger: silentLogger,
    });
    expect(service.status()).toEqual({
      paired: false,
      handle: null,
      url: null,
      connected: false,
      lastError: null,
    });
  });

  it("pair redeems, persists the credential, and reports paired", async () => {
    dir = mkdtempSync(join(tmpdir(), "bb-connect-svc-"));
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ credential: "bbcred_live", handle: "sawyer" }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    service = new ConnectTunnelService({
      dataDir: dir,
      loopbackBaseUrl: "http://127.0.0.1:38886",
      logger: silentLogger,
    });
    // Loopback serverUrl so the post-pair tunnel dial refuses instantly (no
    // real gate contacted); explicit baseUrl drives the redeem endpoint.
    const status = await service.pair({
      code: "ABCD",
      serverUrl: "http://127.0.0.1:59321",
      baseUrl: "https://getbb.app",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://getbb.app/api/connect/redeem",
      expect.objectContaining({ method: "POST" }),
    );
    expect(status.paired).toBe(true);
    expect(status.handle).toBe("sawyer");
    expect(status.url).toBe("http://127.0.0.1:59321");
    // Persisted for reconnect-on-restart.
    expect(readConnectCredential(dir)?.credential).toBe("bbcred_live");
  });

  it("disconnect clears the stored credential", async () => {
    dir = mkdtempSync(join(tmpdir(), "bb-connect-svc-"));
    // Loopback serverUrl: start() dials it and refuses instantly (hermetic).
    writeConnectCredential(dir, {
      serverUrl: "http://127.0.0.1:59322",
      handle: "sawyer",
      credential: "bbcred_x",
    });
    service = new ConnectTunnelService({
      dataDir: dir,
      loopbackBaseUrl: "http://127.0.0.1:38886",
      logger: silentLogger,
    });
    service.start();
    expect(service.status().paired).toBe(true);

    const after = service.disconnect();
    expect(after.paired).toBe(false);
    expect(existsSync(join(dir, "connect.json"))).toBe(false);
  });

  it("surfaces a redeem failure without persisting", async () => {
    dir = mkdtempSync(join(tmpdir(), "bb-connect-svc-"));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "expired" }), { status: 410 }),
      ),
    );
    service = new ConnectTunnelService({
      dataDir: dir,
      loopbackBaseUrl: "http://127.0.0.1:38886",
      logger: silentLogger,
    });
    await expect(
      service.pair({ code: "OLD", serverUrl: "https://sawyer.getbb.app" }),
    ).rejects.toThrow(/410.*expired/);
    expect(existsSync(join(dir, "connect.json"))).toBe(false);
  });
});
