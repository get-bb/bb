import { describe, expect, it, vi } from "vitest";
import type { Host } from "@bb/domain";
import {
  collectLogPayloads,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import {
  formatMachineLastSeen,
  registerMachineCommands,
  resolveMachineId,
} from "../../commands/machine.js";

const hosts: Host[] = [
  {
    id: "host-primary",
    name: "workstation",
    type: "persistent",
    status: "connected",
    lastSeenAt: 1_700_000_000_000,
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 2,
  },
  {
    id: "host-remote",
    name: "laptop",
    type: "persistent",
    status: "disconnected",
    lastSeenAt: null,
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 2,
  },
];

describe("bb machine command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerMachineCommands(program, () => "http://server");

  function stubSystemConfigFetch(multiMachine: boolean): void {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ experiments: { multiMachine } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  it("bb machine list --json prints the raw host list", async () => {
    stubSystemConfigFetch(true);
    stubServerApi({ "v1.hosts.$get": vi.fn(async () => hosts) });

    await runCommand(["machine", "list", "--json"], register);

    expect(
      JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])),
    ).toEqual(hosts);
  });

  it("bb machine list renders names, IDs, status, and relative last seen", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_120_000);
    stubSystemConfigFetch(true);
    stubServerApi({ "v1.hosts.$get": vi.fn(async () => hosts) });

    await runCommand(["machine", "list"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "",
      "Name         ID            Status        Last seen\n-----------  ------------  ------------  ---------\nworkstation  host-primary  connected     2m ago\n-----------  ------------  ------------  ---------\nlaptop       host-remote   disconnected  never",
      "",
    ]);
  });

  it("bb machine list errors when the Multi-machine experiment is off", async () => {
    stubSystemConfigFetch(false);
    const listHosts = vi.fn(async () => hosts);
    stubServerApi({ "v1.hosts.$get": listHosts });

    await expect(runCommand(["machine", "list"], register)).rejects.toThrow(
      "process.exit:1",
    );

    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      "Error: Machine commands are behind the Multi-machine experiment — enable it in Settings → Experiments.",
    );
    expect(listHosts).not.toHaveBeenCalled();
  });

  it("bb machine list --json fails the same way with the experiment off", async () => {
    stubSystemConfigFetch(false);
    stubServerApi({ "v1.hosts.$get": vi.fn(async () => hosts) });

    await expect(
      runCommand(["machine", "list", "--json"], register),
    ).rejects.toThrow("process.exit:1");

    expect(vi.mocked(console.log)).not.toHaveBeenCalled();
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      "Error: Machine commands are behind the Multi-machine experiment — enable it in Settings → Experiments.",
    );
  });
});

describe("machine selection", () => {
  it("resolves an ID before names", () => {
    expect(resolveMachineId(hosts, "host-primary")).toBe("host-primary");
  });

  it("resolves an unambiguous name", () => {
    expect(resolveMachineId(hosts, "laptop")).toBe("host-remote");
  });

  it("lists matching IDs for an ambiguous name", () => {
    expect(() =>
      resolveMachineId(
        [...hosts, { ...hosts[0], id: "host-other" }],
        "workstation",
      ),
    ).toThrow(
      "Machine name 'workstation' is ambiguous. Matches: workstation (host-primary), workstation (host-other).",
    );
  });

  it("lists available machines for an unknown selector", () => {
    expect(() => resolveMachineId(hosts, "desktop")).toThrow(
      "Machine 'desktop' was not found. Available machines: workstation (host-primary), laptop (host-remote).",
    );
  });

  it("formats future clock skew as just now", () => {
    expect(formatMachineLastSeen(101, 100)).toBe("just now");
  });
});
