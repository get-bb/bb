import { describe, expect, it } from "vitest";
import {
  buildServerTargetOptions,
  shouldAuthenticateCustomWithConnect,
} from "../src/server-target-options.js";

const CONNECT_SERVERS = [
  { handle: "laptop", name: "Laptop", url: "https://laptop.getbb.app" },
];
const CUSTOM_SERVERS = [
  { id: "id-1", name: "Office", url: "https://office.example.com" },
];

describe("buildServerTargetOptions", () => {
  it("lists builtin, connect, and custom servers with the selected one flagged", () => {
    const servers = buildServerTargetOptions({
      connectServers: CONNECT_SERVERS,
      connectTrusted: true,
      customServers: CUSTOM_SERVERS,
      selectedServerId: "id-1",
    });
    expect(servers).toEqual([
      {
        id: "builtin",
        kind: "builtin",
        name: "This Mac",
        selected: false,
        url: null,
      },
      {
        id: "connect:laptop",
        kind: "connect",
        name: "Laptop",
        selected: false,
        url: "https://laptop.getbb.app",
      },
      {
        id: "id-1",
        kind: "custom",
        name: "Office",
        selected: true,
        url: "https://office.example.com",
      },
    ]);
  });

  it("hides bb Connect servers when bb Connect is untrusted", () => {
    const servers = buildServerTargetOptions({
      connectServers: CONNECT_SERVERS,
      connectTrusted: false,
      customServers: CUSTOM_SERVERS,
      selectedServerId: "builtin",
    });
    expect(servers.map((server) => server.id)).toEqual(["builtin", "id-1"]);
    expect(servers[0]?.selected).toBe(true);
  });
});

describe("shouldAuthenticateCustomWithConnect", () => {
  it("signs in to a getbb.app custom server only while bb Connect is trusted", () => {
    expect(
      shouldAuthenticateCustomWithConnect({
        connectTrusted: true,
        url: "https://sawyer.getbb.app",
      }),
    ).toBe(true);
    expect(
      shouldAuthenticateCustomWithConnect({
        connectTrusted: false,
        url: "https://sawyer.getbb.app",
      }),
    ).toBe(false);
    expect(
      shouldAuthenticateCustomWithConnect({
        connectTrusted: true,
        url: "https://office.example.com",
      }),
    ).toBe(false);
  });
});
