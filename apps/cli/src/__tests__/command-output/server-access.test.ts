import { describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "@bb/domain";
import {
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerServerCommands } from "../../commands/server.js";

const provider = (id: string, enabled: boolean) => ({
  id,
  displayName: id,
  description: id,
  pluginId: null,
  routeKind: "custom" as const,
  enabled,
  availability: { status: "available" as const },
  urls: [],
});

function config(disabled: string[]) {
  return {
    serverId: "srv_test",
    routes: [],
    generalSettings: {
      ...defaultAppSettings,
      disabledServerAccessProviderIds: disabled,
    },
    serverAccess: {
      providers: ["local-network", "connect", "direct"].map((id) =>
        provider(id, !disabled.includes(id)),
      ),
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

  it("turns a route on or off through the disabled route list", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => config(["local-network"])),
      "v1.settings.general.$put": put,
    });
    await runCommand(["server", "access", "enable", "local-network"], register);
    expect(put).toHaveBeenLastCalledWith({
      json: expect.objectContaining({ disabledServerAccessProviderIds: [] }),
    });
    await runCommand(["server", "access", "disable", "connect"], register);
    expect(put).toHaveBeenLastCalledWith({
      json: expect.objectContaining({
        disabledServerAccessProviderIds: ["local-network", "connect"],
      }),
    });
  });

  it("writes the route order and refuses unknown route ids", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => config([])),
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
