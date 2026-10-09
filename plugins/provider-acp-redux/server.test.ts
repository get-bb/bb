import { getEventListeners } from "node:events";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { z } from "zod";
import { KNOWN_ACP_AGENTS } from "./src/known-agents.js";
import acpProvidersPlugin from "./server.js";

const PLUGIN_ID = "bb--provider-acp-redux";

const DECLARED_ICON_NAMES = Object.keys(
  z
    .object({
      bb: z.object({
        branding: z.object({
          experimental_icons: z.record(z.string(), z.string()),
        }),
      }),
    })
    .parse(
      JSON.parse(
        readFileSync(new URL("./package.json", import.meta.url), "utf8"),
      ),
    ).bb.branding.experimental_icons,
);

function customAgents(...agents: unknown[]): string {
  return JSON.stringify(agents);
}

function forkOf(
  host: ReturnType<typeof createFakePluginHost>,
  providerId: string,
): string | undefined {
  return host.harness.registrations.providerRegistrations.find(
    (declaration) => declaration.id === providerId,
  )?.capabilities.fork;
}

function registeredIds(
  host: ReturnType<typeof createFakePluginHost>,
): string[] {
  return host.harness.registrations.providerRegistrations.map(
    (declaration) => declaration.id,
  );
}

async function loadPlugin(options: {
  customAgents?: string;
  probe?: (command: string) => unknown;
  hosts?: { id: string; status: string }[];
}) {
  const host = createFakePluginHost({
    pluginId: PLUGIN_ID,
    experimental_declaredIconNames: DECLARED_ICON_NAMES,
    ...(options.customAgents === undefined
      ? {}
      : { settings: { customAgents: options.customAgents } }),
    ...(options.probe === undefined
      ? {}
      : {
          experimental_callHostRpc: (call: { input: unknown }) =>
            options.probe?.(
              (call.input as { command: string }).command,
            ) as never,
        }),
  });
  host.harness.sdk.stub("hosts.list", () =>
    Promise.resolve(options.hosts ?? []),
  );
  host.harness.sdk.stub("providers.catalog", () => Promise.resolve([]));
  await acpProvidersPlugin(host.bb);
  return host;
}

describe("the ACP plugin's registrations", () => {
  it("registers every shipped agent, and a configured one beside them", async () => {
    const host = await loadPlugin({
      customAgents: customAgents({
        id: "amp",
        displayName: "Amp",
        command: "amp",
      }),
    });

    expect(registeredIds(host)).toContain("acp-cursor");
    expect(registeredIds(host)).toContain("acp-amp");
  });

  it("removes a configured agent the setting no longer lists", async () => {
    const host = await loadPlugin({
      customAgents: customAgents({
        id: "amp",
        displayName: "Amp",
        command: "amp",
      }),
    });
    expect(registeredIds(host)).toContain("acp-amp");

    await host.harness.setSettings({ customAgents: "[]" });

    await vi.waitFor(() =>
      expect(registeredIds(host)).not.toContain("acp-amp"),
    );
    expect(registeredIds(host)).toContain("acp-cursor");
  });

  it("keeps the rest of the list when one entry is malformed", async () => {
    const host = await loadPlugin({
      customAgents: customAgents(
        { id: "Bad Slug", displayName: "x", command: "x" },
        { id: "amp", displayName: "Amp", command: "amp" },
      ),
    });

    expect(registeredIds(host)).toContain("acp-amp");
    expect(
      host.harness.logEntries.some((entry) =>
        entry.message.includes("is not a valid agent"),
      ),
    ).toBe(true);
  });
});

describe("the ACP plugin's registration bookkeeping", () => {
  it("registers the shipped agents before the factory's first await", async () => {
    const host = createFakePluginHost({
      pluginId: PLUGIN_ID,
      experimental_declaredIconNames: DECLARED_ICON_NAMES,
    });
    host.harness.sdk.stub("hosts.list", () => Promise.resolve([]));

    const loading = acpProvidersPlugin(host.bb);
    expect(registeredIds(host)).toContain("acp-cursor");
    await loading;
  });

  it("restores the shipped agent when its override is removed", async () => {
    const host = await loadPlugin({
      customAgents: customAgents({
        id: "opencode",
        displayName: "My opencode",
        command: "/opt/opencode",
      }),
    });
    const override = host.harness.registrations.providerRegistrations.find(
      (declaration) => declaration.id === "acp-opencode",
    );
    expect(override?.displayName).toBe("My opencode");
    expect(override?.experimental_nativeSkillRoots?.project).toHaveLength(3);
    expect(override?.experimental_resolvesNativeRoots).toBe(true);

    await host.harness.setSettings({ customAgents: "[]" });

    await vi.waitFor(() => {
      const opencode = host.harness.registrations.providerRegistrations.filter(
        (declaration) => declaration.id === "acp-opencode",
      );
      expect(opencode).toHaveLength(1);
      expect(opencode[0]?.displayName).toBe("opencode");
    });
  });

  it("keeps an untouched agent's registration identical across a save", async () => {
    const host = await loadPlugin({ customAgents: "[]" });
    const idsBefore = registeredIds(host);
    const before = host.harness.registrations.providerRegistrations.find(
      (declaration) => declaration.id === "acp-cursor",
    );

    await host.harness.setSettings({
      customAgents: customAgents({
        id: "amp",
        displayName: "Amp",
        command: "amp",
      }),
    });
    await vi.waitFor(() =>
      expect(registeredIds(host)).toEqual([...idsBefore, "acp-amp"]),
    );

    expect(
      host.harness.registrations.providerRegistrations.find(
        (declaration) => declaration.id === "acp-cursor",
      ),
    ).toBe(before);
  });

  it("serializes overlapping settings changes into one consistent state", async () => {
    const host = await loadPlugin({ customAgents: "[]" });
    const cursorBefore = host.harness.registrations.providerRegistrations.find(
      (declaration) => declaration.id === "acp-cursor",
    );

    await Promise.all([
      host.harness.setSettings({
        customAgents: customAgents({
          id: "amp",
          displayName: "Amp",
          command: "amp",
        }),
      }),
      host.harness.setSettings({
        customAgents: customAgents({
          id: "amp",
          displayName: "Amp",
          command: "amp",
        }),
      }),
    ]);

    await vi.waitFor(() => expect(registeredIds(host)).toContain("acp-amp"));
    expect(registeredIds(host).filter((id) => id === "acp-amp")).toHaveLength(
      1,
    );
    expect(
      host.harness.registrations.providerRegistrations.find(
        (declaration) => declaration.id === "acp-cursor",
      ),
    ).toBe(cursorBefore);
  });
});

describe("the ACP plugin's capability probe", () => {
  it("narrows a declared fork the agent does not advertise", async () => {
    const host = await loadPlugin({
      hosts: [{ id: "host_1", status: "connected" }],
      probe: () => ({ reachable: true, fork: false }),
    });
    expect(forkOf(host, "acp-opencode")).toBe("tip");

    const run = host.harness.runService("acp-capability-probe");
    await vi.waitFor(() => expect(forkOf(host, "acp-opencode")).toBe("none"));
    run.controller.abort();
    await run.done;
  });

  it("never widens a fork on an agent whose probe reports more", async () => {
    const probed: string[] = [];
    const host = await loadPlugin({
      hosts: [{ id: "host_1", status: "connected" }],
      probe: (command) => {
        probed.push(command);
        return { reachable: true, fork: true };
      },
    });

    const run = host.harness.runService("acp-capability-probe");
    await vi.waitFor(() => expect(probed.length).toBeGreaterThan(0));
    run.controller.abort();
    await run.done;

    expect(forkOf(host, "acp-opencode")).toBe("tip");
    expect(probed).not.toContain("cursor-agent");
    expect(forkOf(host, "acp-cursor")).toBe("none");
  });

  it("only spawns the agents a probe answer could change", async () => {
    const probed: string[] = [];
    const host = await loadPlugin({
      customAgents: customAgents({
        id: "amp",
        displayName: "Amp",
        command: "amp",
      }),
      hosts: [{ id: "host_1", status: "connected" }],
      probe: (command) => {
        probed.push(command);
        return { reachable: false, reason: "not installed" };
      },
    });

    const run = host.harness.runService("acp-capability-probe");
    await vi.waitFor(() => expect(probed.length).toBeGreaterThan(0));
    run.controller.abort();
    await run.done;

    expect(probed).not.toContain("cursor-agent");
    expect(probed).not.toContain("amp");
    expect(probed.length).toBeGreaterThan(0);
  });

  it("does not re-probe when a host worker exits", async () => {
    const host = await loadPlugin({
      hosts: [{ id: "host_1", status: "connected" }],
      probe: () => ({ reachable: false, reason: "not installed" }),
    });

    const run = host.harness.runService("acp-capability-probe");
    await vi.waitFor(() =>
      expect(host.harness.experimental_hostRpcCalls.length).toBeGreaterThan(0),
    );
    run.controller.abort();
    await run.done;
    const afterProbe = host.harness.experimental_hostRpcCalls.length;

    await host.harness.experimental_emitHostWorkerExit("host_1");

    expect(host.harness.experimental_hostRpcCalls).toHaveLength(afterProbe);
  });

  it("leaves no abort listener behind per poll", async () => {
    const host = await loadPlugin({
      hosts: [{ id: "host_1", status: "connected" }],
      probe: () => ({ reachable: false, reason: "not installed" }),
    });

    const run = host.harness.runService("acp-capability-probe");
    const { signal } = run.controller;
    vi.useFakeTimers();
    try {
      for (let poll = 0; poll < 5; poll += 1) {
        await vi.advanceTimersByTimeAsync(5_000);
      }
      expect(host.harness.sdk.callsTo("hosts.list").length).toBeGreaterThan(2);
      expect(getEventListeners(signal, "abort").length).toBeLessThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }

    run.controller.abort();
    await run.done;
  });

  it("ignores a probe answer the probe schema rejects", async () => {
    const host = await loadPlugin({
      hosts: [{ id: "host_1", status: "connected" }],
      probe: () => ({ reachable: true }),
    });

    const run = host.harness.runService("acp-capability-probe");
    await vi.waitFor(() =>
      expect(host.harness.experimental_hostRpcCalls.length).toBeGreaterThan(0),
    );
    run.controller.abort();
    await run.done;

    expect(forkOf(host, "acp-opencode")).toBe("tip");
  });

  it("leaves the declaration alone when the agent is unreachable", async () => {
    const host = await loadPlugin({
      hosts: [{ id: "host_1", status: "connected" }],
      probe: () => ({ reachable: false, reason: "not installed" }),
    });

    const run = host.harness.runService("acp-capability-probe");
    await vi.waitFor(() =>
      expect(host.harness.experimental_hostRpcCalls.length).toBeGreaterThan(0),
    );
    run.controller.abort();
    await run.done;

    expect(forkOf(host, "acp-opencode")).toBe("tip");
  });

  it("probes nothing while every host is disconnected", async () => {
    const probed: string[] = [];
    const host = await loadPlugin({
      hosts: [{ id: "host_1", status: "disconnected" }],
      probe: (command) => {
        probed.push(command);
        return { reachable: false, reason: "not installed" };
      },
    });

    const run = host.harness.runService("acp-capability-probe");
    await vi.waitFor(() =>
      expect(host.harness.sdk.callsTo("hosts.list").length).toBeGreaterThan(0),
    );
    run.controller.abort();
    await run.done;

    expect(probed).toEqual([]);
  });
});

describe("known agent logos", () => {
  it("declares every agent logo in the manifest", () => {
    for (const agent of KNOWN_ACP_AGENTS) {
      if (agent.icon === undefined) continue;
      expect(agent.icon, agent.id).toMatch(
        new RegExp(`^${PLUGIN_ID}/[a-z0-9][a-z0-9-]*$`, "u"),
      );
      expect(DECLARED_ICON_NAMES, `${agent.id} icon ${agent.icon}`).toContain(
        agent.icon.slice(PLUGIN_ID.length + 1),
      );
    }
  });
});

describe("the ACP registry", () => {
  const REGISTRY_DOCUMENT = {
    version: "1.0.0",
    agents: [
      {
        id: "claude-acp",
        name: "Claude Agent",
        version: "0.88.0",
        description: "ACP wrapper for Anthropic's Claude",
        distribution: {
          npx: { package: "@agentclientprotocol/claude-agent-acp@0.88.0" },
        },
      },
      {
        id: "cursor",
        name: "Cursor",
        version: "1.0.0",
        distribution: { npx: { package: "cursor-acp@1.0.0" } },
      },
      {
        id: "native-only",
        name: "Native Only",
        version: "2.0.0",
        distribution: {
          binary: { "linux-x86_64": { archive: "https://x.test/a", cmd: "a" } },
        },
      },
    ],
  };

  function stubRegistry(respond: () => Response | Promise<Response>) {
    const fetchMock = vi.fn(respond);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function statuses(view: unknown): Record<string, string> {
    return Object.fromEntries(
      (view as { agents: { id: string; status: string }[] }).agents.map(
        (agent) => [agent.id, agent.status],
      ),
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds a registry agent as a provider and removes it again, through RPC and the CLI", async () => {
    const fetchMock = stubRegistry(() => Response.json(REGISTRY_DOCUMENT));
    const host = await loadPlugin({});

    const listed = await host.harness.callRpc("listRegistry", {
      refresh: false,
    });
    expect(statuses(listed)).toEqual({
      "claude-acp": "available",
      cursor: "built-in",
      "native-only": "manual-install",
    });

    const added = await host.harness.callRpc("addRegistryAgent", {
      id: "claude-acp",
    });
    expect(statuses(added)["claude-acp"]).toBe("added");
    await vi.waitFor(() =>
      expect(registeredIds(host)).toContain("acp-claude-acp"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const removed = await host.harness.runCli(["remove", "claude-acp"]);
    expect(removed).toMatchObject({
      exitCode: 0,
      stdout: "Removed claude-acp",
    });
    await vi.waitFor(() =>
      expect(registeredIds(host)).not.toContain("acp-claude-acp"),
    );

    const readded = await host.harness.runCli(["add", "claude-acp"]);
    expect(readded.stdout).toBe(
      "Added Claude Agent 0.88.0 as provider acp-claude-acp\nRuns: npx -y @agentclientprotocol/claude-agent-acp@0.88.0",
    );
    const listing = await host.harness.runCli(["registry"]);
    expect(listing.stdout.split("\n")).toEqual([
      "claude-acp  Claude Agent 0.88.0  [added]  ACP wrapper for Anthropic's Claude",
      "cursor  Cursor 1.0.0  [built in]",
      "native-only  Native Only 2.0.0  [manual install]",
    ]);
  });

  it("refuses a built-in, a binary-only and an unknown agent without touching the setting", async () => {
    stubRegistry(() => Response.json(REGISTRY_DOCUMENT));
    const host = await loadPlugin({});

    await expect(
      host.harness.callRpc("addRegistryAgent", { id: "cursor" }),
    ).rejects.toThrow("already built into bb");
    await expect(
      host.harness.callRpc("addRegistryAgent", { id: "native-only" }),
    ).rejects.toThrow("only as a downloadable binary");
    await expect(
      host.harness.callRpc("addRegistryAgent", { id: "nope" }),
    ).rejects.toThrow('The ACP registry has no agent "nope"');
    const failed = await host.harness.runCli(["add", "nope"]);
    expect(failed.exitCode).not.toBe(0);
    expect(
      await host.harness.callRpc("listRegistry", { refresh: false }),
    ).toMatchObject({ agents: [{ status: "available" }, {}, {}] });
  });

  it("serves the saved copy with the reason when the registry cannot be reached, and says so when there is none", async () => {
    let online = true;
    const fetchMock = stubRegistry(() =>
      online
        ? Response.json(REGISTRY_DOCUMENT)
        : new Response("down", { status: 503 }),
    );
    const host = await loadPlugin({});
    await host.harness.callRpc("listRegistry", { refresh: false });

    online = false;
    const stale = (await host.harness.callRpc("listRegistry", {
      refresh: true,
    })) as {
      error: string | null;
      fetchedAt: number | null;
      agents: unknown[];
    };
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stale.error).toBe("The ACP registry answered 503.");
    expect(stale.fetchedAt).not.toBeNull();
    expect(stale.agents).toHaveLength(3);

    const fresh = await loadPlugin({});
    const empty = await fresh.harness.runCli(["registry"]);
    expect(empty.stdout).toBe(
      "Could not load the ACP registry: The ACP registry answered 503.",
    );
  });
});
