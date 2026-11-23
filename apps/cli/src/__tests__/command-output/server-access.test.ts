import { describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "@bb/domain";
import {
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerServerCommands } from "../../commands/server.js";

const provider = (id: string) => ({
  id,
  displayName: id,
  description: id,
  pluginId: id === "connect" ? "bb--connect" : null,
  routeKind: "custom" as const,
  availability: { status: "available" as const },
  urls: [],
});

function config() {
  return {
    serverId: "srv_test",
    routes: [],
    generalSettings: { ...defaultAppSettings },
    serverAccess: {
      providers: ["local-network", "connect", "direct"].map(provider),
      effectiveUrl: null,
      urlSource: null,
      localNetwork: {
        bindHost: "127.0.0.1",
        addresses: [],
        listenerError: null,
      },
    },
  };
}

describe("bb server access", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerServerCommands(
      program.enablePositionalOptions(),
      () => "http://server",
    );

  it("adds and removes the local network and manual routes, and leaves plugin routes to their plugin", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => config()),
      "v1.settings.general.$put": put,
    });
    await runCommand(["server", "access", "add", "local-network"], register);
    expect(put).toHaveBeenLastCalledWith({
      json: expect.objectContaining({ localNetworkEnabled: true }),
    });
    await runCommand(
      ["server", "access", "add", "direct", "https://bb.example.com"],
      register,
    );
    expect(put).toHaveBeenLastCalledWith({
      json: expect.objectContaining({
        machineServerUrl: "https://bb.example.com",
      }),
    });
    await runCommand(["server", "access", "remove", "direct"], register);
    expect(put).toHaveBeenLastCalledWith({
      json: expect.objectContaining({ machineServerUrl: null }),
    });
    put.mockClear();
    await expect(
      runCommand(["server", "access", "remove", "connect"], register),
    ).rejects.toThrow("process.exit:1");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("comes from a plugin"),
    );
    await expect(
      runCommand(["server", "access", "add", "direct"], register),
    ).rejects.toThrow("process.exit:1");
    expect(put).not.toHaveBeenCalled();
  });

  it("writes the route order and refuses unknown route ids", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => config()),
      "v1.settings.general.$put": put,
    });
    await runCommand(
      ["server", "access", "order", "direct", "local-network"],
      register,
    );
    expect(put).toHaveBeenLastCalledWith({
      json: expect.objectContaining({
        serverAccessOrder: ["direct", "local-network"],
      }),
    });
    put.mockClear();
    await expect(
      runCommand(["server", "access", "order", "tailnet"], register),
    ).rejects.toThrow("process.exit:1");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Unknown route tailnet"),
    );
    expect(put).not.toHaveBeenCalled();
  });
});
