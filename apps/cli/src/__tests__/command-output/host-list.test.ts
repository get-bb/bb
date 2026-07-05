import { describe, expect, it, vi } from "vitest";
import type { Host } from "@bb/domain";
import {
  setupCommandOutputTestEnvironment,
  collectLogPayloads,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerHostCommands } from "../../commands/host.js";

function makeHost(overrides: Partial<Host> & Pick<Host, "id">): Host {
  return {
    name: overrides.id,
    type: "persistent",
    status: "connected",
    lastSeenAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("bb host list command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerHostCommands(program, () => "http://server");

  it("bb host list renders id, name, and status in the shared borderless table", async () => {
    const list = vi.fn(async () => [
      makeHost({ id: "host-primary-1", name: "studio", status: "connected" }),
      makeHost({
        id: "host-laptop-2",
        name: "laptop",
        status: "disconnected",
      }),
    ]);
    stubServerApi({ "v1.hosts.$get": list });

    await runCommand(["host", "list"], register);

    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).toContain("ID              Name    Status        Last seen");
    expect(output).toContain("host-primary-1  studio  connected     -");
    expect(output).toContain("host-laptop-2   laptop  disconnected  -");
  });

  it("bb host list prints a message when there are no hosts", async () => {
    stubServerApi({ "v1.hosts.$get": vi.fn(async () => []) });

    await runCommand(["host", "list"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "No hosts found",
    ]);
  });

  it("bb host list --json prints the raw host list", async () => {
    const hosts = [makeHost({ id: "host-primary-1", lastSeenAt: 1000 })];
    stubServerApi({ "v1.hosts.$get": vi.fn(async () => hosts) });

    await runCommand(["host", "list", "--json"], register);

    const payloads = collectLogPayloads(vi.mocked(console.log));
    expect(payloads).toHaveLength(1);
    expect(JSON.parse(payloads[0])).toEqual(hosts);
  });
});
