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

  it("bb machine list --json prints the raw host list", async () => {
    stubServerApi({ "v1.hosts.$get": vi.fn(async () => hosts) });

    await runCommand(["machine", "list", "--json"], register);

    expect(
      JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])),
    ).toEqual(hosts);
  });

  it("bb machine list renders names, IDs, status, and relative last seen", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_120_000);
    stubServerApi({ "v1.hosts.$get": vi.fn(async () => hosts) });

    await runCommand(["machine", "list"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "",
      "Name         ID            Status        Last seen\n-----------  ------------  ------------  ---------\nworkstation  host-primary  connected     2m ago\n-----------  ------------  ------------  ---------\nlaptop       host-remote   disconnected  never",
      "",
    ]);
  });

  it("bb machine retry-update resolves the machine and requests a retry", async () => {
    const retryUpdate = vi.fn(async () => ({ ok: true as const }));
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => hosts),
      "v1.hosts.:id.retry-update.$post": retryUpdate,
    });

    await runCommand(["machine", "retry-update", "laptop"], register);

    expect(retryUpdate).toHaveBeenCalledOnce();
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "Machine host-remote update retry requested",
    ]);
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
