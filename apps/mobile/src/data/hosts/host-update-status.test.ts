import type { Host } from "@bb/domain";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract/protocol";
import { describe, expect, it } from "vitest";
import {
  formatHostUpdateStatus,
  hostCanRetryUpdate,
  hostNeedsUpdate,
} from "./host-update-status";
import { fetchServerProtocolVersion } from "./server-protocol-version";

function host(overrides: Partial<Host> = {}): Host {
  return {
    id: "h1",
    name: "mbp",
    type: "persistent",
    status: "connected",
    maxPermissionMode: "full",
    lastSeenAt: null,
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

// The server this phone talks to; deliberately not the constant compiled
// into the app, which ships on its own schedule.
const SERVER = HOST_DAEMON_PROTOCOL_VERSION + 5;

describe("host update status", () => {
  it("flags a disconnected daemon the server rejected, whatever this build's protocol is", () => {
    expect(hostNeedsUpdate(host())).toBe(false);
    expect(
      hostNeedsUpdate(
        host({ status: "connected", lastRejectedProtocolVersion: 1 }),
      ),
    ).toBe(false);
    // Phone built at the daemon's protocol: the web comparison against the
    // compiled constant would hide this one.
    const stranded = host({
      status: "disconnected",
      lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
    });
    expect(hostNeedsUpdate(stranded)).toBe(true);
    expect(hostCanRetryUpdate(stranded, SERVER)).toBe(true);
    expect(formatHostUpdateStatus(stranded, SERVER)).toBe(
      `Needs update · daemon protocol ${HOST_DAEMON_PROTOCOL_VERSION} · server protocol ${SERVER}`,
    );
  });

  it("does not offer a retry to a daemon newer than the server", () => {
    // Phone built ahead of the server: the compiled constant would say retry,
    // and the server would answer 409 host_cannot_self_update.
    const newer = host({
      status: "disconnected",
      lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
    });
    const olderServer = HOST_DAEMON_PROTOCOL_VERSION - 2;
    expect(hostNeedsUpdate(newer)).toBe(true);
    expect(hostCanRetryUpdate(newer, olderServer)).toBe(false);
    expect(hostCanRetryUpdate(newer, HOST_DAEMON_PROTOCOL_VERSION - 1)).toBe(
      false,
    );
    expect(formatHostUpdateStatus(newer, olderServer)).toBe(
      `Needs update · daemon protocol ${HOST_DAEMON_PROTOCOL_VERSION - 1} · server protocol ${olderServer}`,
    );
  });

  it("shows the status without a server number and no retry until the server answered", () => {
    const stranded = host({
      status: "disconnected",
      lastRejectedProtocolVersion: 30,
    });
    expect(hostNeedsUpdate(stranded)).toBe(true);
    expect(hostCanRetryUpdate(stranded, null)).toBe(false);
    expect(formatHostUpdateStatus(stranded, null)).toBe(
      "Needs update · daemon protocol 30",
    );
    expect(formatHostUpdateStatus(host(), null)).toBeNull();
  });
});

describe("fetchServerProtocolVersion", () => {
  it("reads protocolVersion from GET /install/version through the profile fetch", async () => {
    const calls: string[] = [];
    const client = {
      serverUrl: "http://127.0.0.1:41999/",
      fetch: (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response(
          JSON.stringify({ version: "1.2.3", protocolVersion: 31 }),
          { status: 200 },
        );
      }) as typeof fetch,
    };
    await expect(fetchServerProtocolVersion(client)).resolves.toBe(31);
    expect(calls).toEqual(["http://127.0.0.1:41999/install/version"]);
  });

  it("rejects a non-2xx or malformed answer instead of guessing", async () => {
    const failing = {
      serverUrl: "http://127.0.0.1:41999",
      fetch: (async () =>
        new Response("nope", { status: 502 })) as typeof fetch,
    };
    await expect(fetchServerProtocolVersion(failing)).rejects.toThrow(/502/u);
    const malformed = {
      serverUrl: "http://127.0.0.1:41999",
      fetch: (async () =>
        new Response(JSON.stringify({ version: "1.2.3" }), {
          status: 200,
        })) as typeof fetch,
    };
    await expect(fetchServerProtocolVersion(malformed)).rejects.toThrow();
  });
});
