import { describe, expect, it, vi } from "vitest";
import { addDesktopServer } from "../src/server-add.js";
import type { ServerProbeResult } from "../src/server-probe.js";

describe("addDesktopServer", () => {
  it("rejects non-http(s) URLs as unreachable without probing", async () => {
    const probe = vi.fn<
      (serverUrl: string) => Promise<ServerProbeResult>
    >();
    const persist = vi.fn();

    const result = await addDesktopServer({
      existingUrls: [],
      persist,
      probe,
      request: { url: "file:///tmp/not-a-server" },
      source: "manual",
    });

    expect(result).toEqual({ ok: false, reason: "unreachable" });
    expect(probe).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("rejects incompatible probes with a typed reason", async () => {
    const probe = vi.fn(async (): Promise<ServerProbeResult> => ({
      kind: "incompatible",
      reason: "not bb",
      serverUrl: "https://evil.example.com",
    }));
    const persist = vi.fn();

    const result = await addDesktopServer({
      existingUrls: [],
      persist,
      probe,
      request: { name: "Evil", url: "https://evil.example.com" },
      source: "manual",
    });

    expect(result).toEqual({ ok: false, reason: "incompatible" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("rejects unavailable probes as unreachable", async () => {
    const probe = vi.fn(async (): Promise<ServerProbeResult> => ({
      kind: "unavailable",
      reason: "ECONNREFUSED",
      serverUrl: "https://offline.example.com",
    }));

    const result = await addDesktopServer({
      existingUrls: [],
      persist: vi.fn(),
      probe,
      request: { url: "https://offline.example.com" },
      source: "connect",
    });

    expect(result).toEqual({ ok: false, reason: "unreachable" });
  });

  it("persists only after a compatible probe", async () => {
    const probe = vi.fn(async (): Promise<ServerProbeResult> => ({
      kind: "compatible",
      serverUrl: "https://ok.example.com",
    }));
    const persist = vi.fn(async (args: {
      name: string;
      source: "manual" | "connect";
      url: string;
    }) => ({
      id: "server-1",
      name: args.name.length > 0 ? args.name : "ok.example.com",
      source: args.source,
      url: args.url,
    }));

    const result = await addDesktopServer({
      existingUrls: ["http://127.0.0.1:38886"],
      persist,
      probe,
      request: { name: "Prod", url: "https://ok.example.com/" },
      source: "manual",
    });

    expect(probe).toHaveBeenCalledWith("https://ok.example.com");
    expect(persist).toHaveBeenCalledWith({
      name: "Prod",
      source: "manual",
      url: "https://ok.example.com",
    });
    expect(result).toEqual({
      ok: true,
      server: {
        id: "server-1",
        name: "Prod",
        source: "manual",
        url: "https://ok.example.com",
      },
    });
  });

  it("rejects duplicate URLs without probing", async () => {
    const probe = vi.fn();
    const result = await addDesktopServer({
      existingUrls: ["https://ok.example.com/"],
      persist: vi.fn(),
      probe,
      request: { url: "https://ok.example.com" },
      source: "manual",
    });

    expect(result).toEqual({ ok: false, reason: "unreachable" });
    expect(probe).not.toHaveBeenCalled();
  });
});
