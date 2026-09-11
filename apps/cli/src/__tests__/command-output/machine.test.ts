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
    machineProviderId: null,
    lifecycle: {
      phase: "active",
      suspendedAt: null,
      message: null,
      pendingLog: "",
      teardown: null,
    },
    maxPermissionMode: "full",
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
    machineProviderId: "ssh",
    lifecycle: {
      phase: "active",
      suspendedAt: null,
      message: null,
      pendingLog: "",
      teardown: null,
    },
    maxPermissionMode: "full",
    lastSeenAt: null,
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 2,
  },
];

const creating: Host = {
  ...hosts[1]!,
  lifecycle: {
    ...hosts[1]!.lifecycle,
    phase: "creating",
    message: "Creating SSH machine…",
  },
};

describe("bb machine command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerMachineCommands(program, () => "http://server");

  it("polls the creating host until it becomes active", async () => {
    const get = vi.fn(async () => hosts[1]);
    stubServerApi({
      "v1.hosts.$post": vi.fn(async () => creating),
      "v1.hosts.:id.enrollment-command.$get": vi.fn(async () => null),
      "v1.hosts.:id.$get": get,
    });
    await runCommand(["machine", "create", "--provider", "ssh"], register);
    expect(get).toHaveBeenCalledOnce();
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "Machine laptop created",
    ]);
  });

  it("prints the host from --no-wait without polling", async () => {
    const get = vi.fn(async () => hosts[1]);
    stubServerApi({
      "v1.hosts.$post": vi.fn(async () => creating),
      "v1.hosts.:id.$get": get,
    });
    await runCommand(
      ["machine", "create", "--provider", "ssh", "--no-wait", "--json"],
      register,
    );
    expect(get).not.toHaveBeenCalled();
    expect(JSON.parse(collectLogPayloads(vi.mocked(console.log))[0])).toEqual(
      creating,
    );
  });

  it("prints the manual enrollment command while following", async () => {
    const command = "curl -fsSL https://machine.example/install.sh | sh";
    stubServerApi({
      "v1.hosts.$post": vi.fn(async () => creating),
      "v1.hosts.:id.enrollment-command.$get": vi.fn(async () => ({
        command,
        expiresAt: Date.now() + 60_000,
      })),
      "v1.hosts.:id.$get": vi.fn(async () => hosts[1]),
    });
    await runCommand(["machine", "create", "--provider", "manual"], register);
    expect(collectLogPayloads(vi.mocked(console.error))).toContain(command);
  });

  it("waits for delayed manual enrollment readiness and prints the command once", async () => {
    const command = "curl -fsSL https://machine.example/install.sh | sh";
    const enrollment = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ command, expiresAt: Date.now() + 60_000 });
    const get = vi
      .fn()
      .mockResolvedValueOnce(creating)
      .mockResolvedValueOnce(creating)
      .mockResolvedValue(hosts[1]);
    stubServerApi({
      "v1.hosts.$post": vi.fn(async () => creating),
      "v1.hosts.:id.enrollment-command.$get": enrollment,
      "v1.hosts.:id.$get": get,
    });
    await runCommand(["machine", "create", "--provider", "manual"], register);
    expect(
      collectLogPayloads(vi.mocked(console.error)).filter(
        (value) => value === command,
      ),
    ).toEqual([command]);
    expect(enrollment).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed JSON without submitting inputs", async () => {
    const create = vi.fn(async () => creating);
    stubServerApi({ "v1.hosts.$post": create });
    await expect(
      runCommand(
        [
          "machine",
          "create",
          "--provider",
          "ssh",
          "--inputs",
          '{"credential":"secret"',
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(create).not.toHaveBeenCalled();
  });

  it("aborts the create request on SIGINT", async () => {
    const create = vi.fn(
      async (_request: object, options: { init: { signal: AbortSignal } }) => {
        process.emit("SIGINT");
        expect(options.init.signal.aborted).toBe(true);
        throw new Error("aborted");
      },
    );
    stubServerApi({ "v1.hosts.$post": create });
    await expect(
      runCommand(["machine", "create", "--provider", "ssh"], register),
    ).rejects.toThrow("process.exit:130");
    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      "Error: Stopped following; creation continues. Use bb machine remove <host-id> to cancel.",
    ]);
  });

  it.each(["list", "show", "remove"] as const)(
    "can %s a machine before its first enrollment",
    async (command) => {
      const pending = { ...creating, id: "host-pending", name: "pending" };
      const get = vi.fn(async () => pending);
      const remove = vi.fn(async () => undefined);
      stubServerApi({
        "v1.hosts.$get": vi.fn(
          async ({ query }: { query: { includeCreating?: string } }) =>
            query.includeCreating === "true" ? [...hosts, pending] : hosts,
        ),
        "v1.hosts.:id.$get": get,
        "v1.hosts.:id.$delete": remove,
      });

      await runCommand(
        command === "list"
          ? ["machine", "list", "--json"]
          : command === "show"
            ? ["machine", "show", pending.id, "--json"]
            : ["machine", "remove", pending.name, "--yes"],
        register,
      );

      if (command === "remove") {
        expect(remove).toHaveBeenCalledWith({ param: { id: pending.id } });
      } else {
        expect(
          JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])),
        ).toEqual(command === "list" ? [...hosts, pending] : pending);
        if (command === "show")
          expect(get).toHaveBeenCalledWith({ param: { id: pending.id } });
      }
    },
  );

  it("bb machine list renders names, IDs, status, and relative last seen", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_120_000);
    stubServerApi({ "v1.hosts.$get": vi.fn(async () => hosts) });

    await runCommand(["machine", "list"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "",
      "Name         ID            Status        Provider       Last seen\n-----------  ------------  ------------  -------------  ---------\nworkstation  host-primary  connected     user-enrolled  2m ago\n-----------  ------------  ------------  -------------  ---------\nlaptop       host-remote   disconnected  ssh            never",
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

  it.each([
    ["suspend", "v1.hosts.:id.suspend.$post", "suspended"],
    ["resume", "v1.hosts.:id.resume.$post", "resumed"],
    ["retry-cleanup", "v1.hosts.:id.retry-cleanup.$post", "cleanup retried"],
  ] as const)(
    "bb machine %s resolves the machine and invokes the lifecycle action",
    async (command, route, message) => {
      const lifecycleAction = vi.fn(async () =>
        command === "retry-cleanup"
          ? { ok: true as const }
          : {
              ...hosts[1]!,
              lifecycle: {
                ...hosts[1]!.lifecycle,
                phase:
                  command === "suspend"
                    ? ("suspended" as const)
                    : ("active" as const),
              },
            },
      );
      stubServerApi({
        "v1.hosts.$get": vi.fn(async () => hosts),
        [route]: lifecycleAction,
      });

      await runCommand(["machine", command, "laptop"], register);

      expect(lifecycleAction).toHaveBeenCalledWith({
        param: { id: "host-remote" },
      });
      expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
        `Machine host-remote ${message}`,
      ]);
    },
  );

  it("polls the host phase before reporting lifecycle completion", async () => {
    vi.useFakeTimers();
    const suspend = vi.fn(async () => ({
      ...hosts[1]!,
      lifecycle: { ...hosts[1]!.lifecycle, phase: "suspending" as const },
    }));
    const get = vi.fn(async () => ({
      ...hosts[1]!,
      lifecycle: { ...hosts[1]!.lifecycle, phase: "suspended" as const },
    }));
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => hosts),
      "v1.hosts.:id.$get": get,
      "v1.hosts.:id.suspend.$post": suspend,
    });

    const command = runCommand(["machine", "suspend", "laptop"], register);
    await vi.waitFor(() => expect(suspend).toHaveBeenCalledOnce());
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    await command;

    expect(get).toHaveBeenCalledWith({ param: { id: "host-remote" } });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "Machine host-remote suspended",
    ]);
  });

  it("bb machine remove resolves and removes a provider machine", async () => {
    const remove = vi.fn(async () => undefined);
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => hosts),
      "v1.hosts.:id.$delete": remove,
    });

    await runCommand(["machine", "remove", "laptop", "--yes"], register);

    expect(remove).toHaveBeenCalledWith({ param: { id: "host-remote" } });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "Machine host-remote removed",
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
