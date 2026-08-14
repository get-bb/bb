import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { createPluginContext } from "../../lib/context.js";
import { createRemoteServiceController } from "../../lib/remote/index.js";
import type { RemoteSettingValues } from "../../lib/remote/config.js";
import { AssuranceStudioClient } from "../../lib/remote/assurance-studio/client.js";
import { ForgeComputeClient } from "../../lib/remote/forge-compute/client.js";
import type { ForgeComputeTransport } from "../../lib/remote/forge-compute/mcp-transport.js";
import { PlatformClient } from "../../lib/remote/platform/client.js";
import {
  PLATFORM_ROUTES,
  SECURITY_ASSESSMENT_ROUTES,
} from "../../lib/remote/platform/routes.js";
import { ASSURANCE_STUDIO_ROUTES } from "../../lib/remote/assurance-studio/routes.js";
import type { Scheduler } from "../../lib/remote/rate-limit.js";
import { PLATFORM_REFERENCE_ROUTES } from "../mock-remote/generated/platform-routes.js";
import { ASSURANCE_STUDIO_REFERENCE_ROUTES } from "../mock-remote/generated/assurance-studio-routes.js";
import { registerRemoteServices } from "../../lanes/remote/register.js";
import { rpcContract } from "../../shared/contract.js";
import { createMockRemote } from "../mock-remote/server.js";

async function firstPage<T>(
  pages: AsyncIterable<{ items: T[] }>,
): Promise<T[]> {
  for await (const page of pages) return page.items;
  return [];
}

function mountMockAtPath(
  baseUrl: string,
  rootFetch: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const mountPath = new URL(baseUrl).pathname.replace(/\/$/u, "");
  return async (input, init) => {
    const url = new URL(String(input));
    if (!url.pathname.startsWith(`${mountPath}/`)) {
      return Response.json(
        { error: "request missed mock mount" },
        { status: 404 },
      );
    }
    url.pathname = url.pathname.slice(mountPath.length);
    return await rootFetch(url, init);
  };
}

describe("direct remote and compute contract", () => {
  it("keeps the plugin running while missing Platform remains a scoped connection state", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state" });
    await registerRemoteServices(host.bb, createPluginContext(host.bb));
    expect(await host.harness.callRpc("connectionsStatus")).toEqual({
      platform: {
        state: "needs-configuration",
        message: "Connect your Finite State account to load projects",
        checkedAt: null,
      },
      assuranceStudio: {
        state: "disabled",
        message: "Assurance Studio is not configured",
        checkedAt: null,
      },
      forgeCompute: {
        state: "disabled",
        message: "Forge Compute is disabled",
        checkedAt: null,
      },
    });
    expect(host.harness.needsConfigurationMessages).toEqual([]);
    await host.harness.setSettings({ platformConcurrency: "16" });
    await vi.waitFor(() => {
      expect(host.harness.realtimeSignals).toContainEqual({
        channel: "finite-state:connections-changed",
        payload: null,
      });
    });
    const source = readFileSync(
      new URL("../../lanes/remote/register.ts", import.meta.url),
      "utf8",
    );
    expect(source.match(/settings\.define\(/gu)).toHaveLength(1);
    await host.harness.lifecycle.dispose();
    await host.harness.lifecycle.dispose();
  });

  it("keeps every Platform mapping inside the vendored operation inventory", () => {
    const operations = new Set(
      PLATFORM_REFERENCE_ROUTES.map((route) => route.operationId),
    );
    for (const route of Object.values(PLATFORM_ROUTES))
      expect(operations.has(route.operationId)).toBe(true);
    for (const [, operation] of Object.values(SECURITY_ASSESSMENT_ROUTES))
      expect(operations.has(operation)).toBe(true);
  });

  it("runs normalized core reads through path-prefixed Platform and AS mock bases with Forge absent", async () => {
    const mock = createMockRemote({
      platformToken: "platform-token",
      assuranceStudioKey: "as-key",
      fixtureRoot: import.meta.dirname,
      register(service, registry) {
        if (service === "platform") {
          registry.register("platform:GET:/public/v0/projects", () =>
            Response.json({ items: [{ id: "p1" }], total: 1 }),
          );
        } else {
          registry.register(
            "assurance-studio:GET:/api/projects/{projectId}/threats",
            () =>
              Response.json({
                data: { items: [{ id: "t1", project_id: "p1" }], total: 1 },
              }),
          );
        }
      },
    });
    const platformBaseUrl = "http://platform.mock/api";
    const assuranceStudioBaseUrl = "http://as.mock/gateway";
    const platform = new PlatformClient({
      baseUrl: platformBaseUrl,
      token: "platform-token",
      fetch: mountMockAtPath(platformBaseUrl, mock.platform.fetch),
    });
    const assuranceStudio = new AssuranceStudioClient({
      baseUrl: assuranceStudioBaseUrl,
      apiKey: "as-key",
      fetch: mountMockAtPath(
        assuranceStudioBaseUrl,
        mock.assuranceStudio.fetch,
      ),
    });
    expect(await firstPage(platform.listProjects())).toEqual([{ id: "p1" }]);
    expect(
      await firstPage(
        assuranceStudio.listEntities("threat", { projectId: "p1" }),
      ),
    ).toEqual([
      expect.objectContaining({ id: "t1", projectId: "p1", kind: "threat" }),
    ]);
  });

  it("reconfigures only the changed service while stable delegates retain identity", async () => {
    const values: RemoteSettingValues = {
      platformBaseUrl: "https://platform-one.example/api",
      platformToken: "p",
      platformConcurrency: "8",
      asBaseUrl: "https://as.example",
      asApiKey: "a",
      asConcurrency: "8",
      forgeTransport: "disabled",
      forgeUrl: "",
      forgeCommand: "",
      forgeAuthToken: undefined,
      forgeConcurrency: "4",
      standaloneUnpackExecutablePath: "",
      standaloneUnpackImage: "localhost:5000/services-unpack:latest",
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json([]));
    const host = createFakePluginHost({ pluginId: "finite-state" });
    const controller = createRemoteServiceController(
      createPluginContext(host.bb),
      values,
    );
    const platformDelegate = controller.services.platform;
    const asDelegate = controller.services.assuranceStudio;
    await Promise.resolve();
    const next = {
      ...values,
      platformBaseUrl: "https://platform-two.example/api",
    };
    await controller.reconfigure(next, values);
    await Promise.resolve();
    expect(controller.services.platform).toBe(platformDelegate);
    expect(controller.services.assuranceStudio).toBe(asDelegate);
    expect(
      fetchMock.mock.calls.filter(
        ([input]) => new URL(String(input)).hostname === "as.example",
      ),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        new URL(String(input)).hostname.startsWith("platform-"),
      ),
    ).toHaveLength(2);
    await controller.dispose();
    fetchMock.mockRestore();
  });

  it("keeps named AS non-entity mappings in the vendored snapshot and handler audit", () => {
    const paths = new Set(
      ASSURANCE_STUDIO_REFERENCE_ROUTES.map(
        (route) => `${route.method}:${route.pathTemplate}`,
      ),
    );
    for (const route of Object.values(ASSURANCE_STUDIO_ROUTES))
      expect(paths.has(`${route.method}:${route.path}`)).toBe(true);
  });

  it("isolates Platform auth, offset paging, and ambiguous writes", async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        calls.push({ url, init });
        if (url.pathname.includes("/status"))
          throw new TypeError("connection reset with secret token");
        return Response.json({ items: [{ id: "p1" }], total: 1 });
      },
    );
    const client = new PlatformClient({
      baseUrl: "https://platform.example/private/path?secret=x",
      token: "platform-secret",
      fetch,
    });
    expect(await firstPage(client.listProjects({ pageSize: 8 }))).toEqual([
      { id: "p1" },
    ]);
    expect(calls[0]?.url.pathname).toBe("/private/path/public/v0/projects");
    expect(calls[0]?.url.searchParams.get("offset")).toBe("0");
    expect(new Headers(calls[0]?.init?.headers).get("X-Authorization")).toBe(
      "platform-secret",
    );
    expect(new Headers(calls[0]?.init?.headers).has("X-API-Key")).toBe(false);
    await expect(
      client.setVexStatus({
        projectVersionId: "pv",
        findingId: "12",
        status: "IN_TRIAGE",
      }),
    ).rejects.toMatchObject({ code: "REMOTE_WRITE_INDETERMINATE" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("normalizes AS envelopes, strips embeddings, maps dataflow create fields, and preserves delete impact", async () => {
    const bodies: unknown[] = [];
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.body) bodies.push(JSON.parse(String(init.body)));
        if (init?.method === "DELETE")
          return Response.json(
            {
              data: {
                allowed_actions: ["cascade", "detach"],
                recommended_action: "detach",
                references: [{ id: "r" }],
              },
            },
            { status: 409 },
          );
        if (init?.method === "POST")
          return Response.json({
            success: true,
            data: {
              id: "df1",
              project_id: "prj",
              review_version: "9007199254740993",
              review_status: "pending",
              human_edited: true,
              embedding: [1, 2],
              nested: { vector: [3] },
            },
          });
        return Response.json({
          data: {
            items: [
              {
                id: "t1",
                project_id: "prj",
                human_edited: false,
                embedding: [1],
              },
            ],
            total: 1,
          },
        });
      },
    );
    const client = new AssuranceStudioClient({
      baseUrl: "https://as.example/base",
      apiKey: "as-secret",
      fetch,
    });
    const entities = await firstPage(
      client.listEntities("threat", { projectId: "prj" }),
    );
    expect(entities[0]).toMatchObject({ id: "t1", humanEdited: false });
    expect(entities[0]?.fields).not.toHaveProperty("embedding");
    const created = await client.createEntity("dataflow", {
      projectId: "prj",
      fields: {
        from_component: "a",
        to_component: "b",
        encrypted: true,
      },
    });
    expect(created.entity.reviewVersion).toBe("9007199254740993");
    expect(created.entity.fields).not.toHaveProperty("embedding");
    expect(bodies[0]).toMatchObject({
      source_component_id: "a",
      target_component_id: "b",
      is_encrypted: true,
    });
    const deleted = await client.deleteEntity("threat", {
      projectId: "prj",
      id: "t1",
      mode: "detach",
    });
    expect(deleted).toEqual({
      success: false,
      impact: {
        allowedActions: ["cascade", "detach"],
        recommendedAction: "detach",
        references: [{ id: "r" }],
      },
    });
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("X-API-Key")).toBe("as-secret");
    expect(headers.has("X-Authorization")).toBe(false);
  });

  it("watches Forge jobs to exactly normalized terminal states and publishes hints only", async () => {
    const rawStatuses = ["RUNNING", "CANCELLED"];
    const hints: unknown[] = [];
    const scheduler: Scheduler = { now: () => 0, sleep: async () => undefined };
    const transport: ForgeComputeTransport = {
      health: async () => undefined,
      verifyDynamic: async () => ({}),
      penTestRun: async () => ({}),
      listJobs: async () => ({ count: 0, jobs: [] }),
      getJobStatus: async () => ({
        job_id: "job-1",
        status: rawStatuses.shift(),
        tool: "future_registry_tool",
        recipe: "r",
        scope: {},
        environment: {},
        run_id: null,
        elapsed_seconds: 1,
        log_path: "/secret",
        log_tail: "one\ntwo",
        events: [{ n: 1 }],
        event_count: 1,
      }),
      close: async () => undefined,
    };
    const client = new ForgeComputeClient({
      transport,
      scheduler,
      remoteTransport: true,
      publishHint: (hint) => hints.push(hint),
    });
    const statuses: string[] = [];
    for await (const item of client.watchJob("job-1")) {
      statuses.push(item.status);
      if (item.status === "FAILED")
        expect(item.error?.code).toBe("FORGE_JOB_CANCELLED");
    }
    expect(statuses).toEqual(["RUNNING", "FAILED"]);
    expect(hints).toEqual([
      { jobId: "job-1", status: "RUNNING", eventCount: 1 },
      { jobId: "job-1", status: "FAILED", eventCount: 1 },
    ]);
    expect(JSON.stringify(hints)).not.toContain("events");
    expect(JSON.stringify(hints)).not.toContain("log");
  });

  it("keeps a configured-but-unreachable Platform client loaded", async () => {
    const values: RemoteSettingValues = {
      platformBaseUrl: "https://platform.example/api",
      platformToken: "p",
      platformConcurrency: "8",
      asBaseUrl: "",
      asApiKey: undefined,
      asConcurrency: "8",
      forgeTransport: "disabled",
      forgeUrl: "",
      forgeCommand: "",
      forgeAuthToken: undefined,
      forgeConcurrency: "4",
      standaloneUnpackExecutablePath: "",
      standaloneUnpackImage: "localhost:5000/services-unpack:latest",
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ error: "unauthorized" }, { status: 401 }),
      );
    const host = createFakePluginHost({ pluginId: "finite-state" });
    const controller = createRemoteServiceController(
      createPluginContext(host.bb),
      values,
    );
    await vi.waitFor(() => {
      expect(controller.connectionStatus().platform.state).toBe("unreachable");
    });
    expect(host.harness.needsConfigurationMessages).toEqual([]);
    await expect(controller.services.platform.health()).rejects.toMatchObject({
      service: "platform",
      code: "REMOTE_HTTP_401",
    });
    expect(controller.connectionStatus().assuranceStudio.state).toBe(
      "disabled",
    );
    await controller.dispose();
    fetchMock.mockRestore();
  });

  it("keeps registered connection status contract-safe while publishing structured auth diagnostics for both remotes", async () => {
    const values = {
      platformBaseUrl: "https://platform.example/api",
      platformToken: "p",
      platformConcurrency: "8",
      asBaseUrl: "https://fs-alpha.finitestate.io",
      asApiKey: "a",
      asConcurrency: "8",
      forgeTransport: "disabled",
      forgeUrl: "",
      forgeCommand: "",
      forgeAuthToken: "",
      forgeConcurrency: "4",
      standaloneUnpackExecutablePath: "",
      standaloneUnpackImage: "localhost:5000/services-unpack:latest",
    } satisfies RemoteSettingValues;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ error: "unauthorized" }, { status: 401 }),
      );
    const host = createFakePluginHost({ pluginId: "finite-state-auth-status" });
    await registerRemoteServices(host.bb, createPluginContext(host.bb));
    await host.harness.setSettings({
      platformBaseUrl: values.platformBaseUrl,
      platformToken: values.platformToken ?? "",
      asBaseUrl: values.asBaseUrl,
      asApiKey: values.asApiKey ?? "",
    });

    await vi.waitFor(async () => {
      expect(await host.harness.callRpc("connectionsStatus")).toMatchObject({
        platform: { state: "unreachable" },
        assuranceStudio: { state: "unreachable" },
      });
    });
    const registeredStatus = rpcContract.connectionsStatus.output.parse(
      await host.harness.callRpc("connectionsStatus"),
    );
    expect(registeredStatus).toMatchObject({
      platform: {
        state: "unreachable",
        message: "Platform credentials were rejected (HTTP 401).",
      },
      assuranceStudio: {
        state: "unreachable",
        message: "Assurance Studio credentials were rejected (HTTP 401).",
      },
    });
    for (const connection of [
      registeredStatus.platform,
      registeredStatus.assuranceStudio,
    ]) {
      expect(connection.message?.length).toBeLessThan(200);
      expect(connection.message).not.toMatch(
        /(?:authorization|api[_-]?key|https?:\/\/|[?@])/iu,
      );
    }
    await expect(
      host.harness.callRpc("remoteConnectionDiagnostics"),
    ).resolves.toMatchObject({
      platform: {
        kind: "authentication",
        status: 401,
        request: {
          method: "GET",
          url: "https://platform.example/api/public/v0/projects?offset=0&limit=1",
        },
        credential: {
          header: "X-Authorization",
          setting: "platformToken",
        },
      },
      assuranceStudio: {
        kind: "authentication",
        status: 401,
        request: {
          method: "GET",
          url: "https://fs-alpha.finitestate.io/api/projects?page=1&limit=1",
        },
        credential: {
          header: "X-API-Key",
          setting: "asApiKey",
        },
      },
    });
    await expect(
      host.harness.callRpc("remoteConnectionSelfDiagnosis"),
    ).resolves.toMatchObject({
      platform: {
        state: "auth-failed",
        message: expect.stringContaining("Platform authentication failed"),
      },
      assuranceStudio: {
        state: "auth-failed",
        message: expect.stringContaining(
          "Assurance Studio authentication failed",
        ),
      },
    });
    await host.harness.lifecycle.dispose();
    fetchMock.mockRestore();
  });

  it("keeps syntactically malformed URL settings distinct from reachability", async () => {
    const values: RemoteSettingValues = {
      platformBaseUrl: "not a URL",
      platformToken: "p",
      platformConcurrency: "8",
      asBaseUrl: "also not a URL",
      asApiKey: "a",
      asConcurrency: "8",
      forgeTransport: "disabled",
      forgeUrl: "",
      forgeCommand: "",
      forgeAuthToken: undefined,
      forgeConcurrency: "4",
      standaloneUnpackExecutablePath: "",
      standaloneUnpackImage: "localhost:5000/services-unpack:latest",
    };
    const host = createFakePluginHost({
      pluginId: "finite-state-bad-remote-url",
    });
    const controller = createRemoteServiceController(
      createPluginContext(host.bb),
      values,
    );

    expect(controller.connectionStatus()).toMatchObject({
      platform: {
        state: "needs-configuration",
        message: expect.stringContaining(
          "Platform URL (platformBaseUrl) is malformed",
        ),
      },
      assuranceStudio: {
        state: "needs-configuration",
        message: expect.stringContaining(
          "Assurance Studio URL (asBaseUrl) is malformed",
        ),
      },
    });
    await controller.dispose();
  });

  it("reports base-URL convention failures as settings errors without probing", async () => {
    const values: RemoteSettingValues = {
      platformBaseUrl: "https://platform.example",
      platformToken: "p",
      platformConcurrency: "8",
      asBaseUrl: "https://fs-alpha.finitestate.io/api",
      asApiKey: "a",
      asConcurrency: "8",
      forgeTransport: "disabled",
      forgeUrl: "",
      forgeCommand: "",
      forgeAuthToken: undefined,
      forgeConcurrency: "4",
      standaloneUnpackExecutablePath: "",
      standaloneUnpackImage: "localhost:5000/services-unpack:latest",
    };
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const host = createFakePluginHost({ pluginId: "finite-state-base-shape" });
    await registerRemoteServices(host.bb, createPluginContext(host.bb));
    await host.harness.setSettings({
      platformBaseUrl: values.platformBaseUrl,
      platformToken: values.platformToken ?? "",
      asBaseUrl: values.asBaseUrl,
      asApiKey: values.asApiKey ?? "",
    });

    await expect(
      host.harness.callRpc("remoteConnectionSelfDiagnosis"),
    ).resolves.toMatchObject({
      platform: {
        state: "invalid-settings",
        message:
          "Platform URL (platformBaseUrl) must end with /api because Platform routes omit that prefix.",
      },
      assuranceStudio: {
        state: "invalid-settings",
        message:
          "Assurance Studio URL (asBaseUrl) must not end with /api because Assurance Studio routes already include that prefix.",
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await host.harness.lifecycle.dispose();
    fetchMock.mockRestore();
  });

  it.each([
    {
      name: "valid both",
      asConfigured: true,
      platformResult: "ok" as const,
      expected: { platform: "ok", assuranceStudio: "ok" },
    },
    {
      name: "one 401",
      asConfigured: true,
      platformResult: "401" as const,
      expected: { platform: "auth-failed", assuranceStudio: "ok" },
    },
    {
      name: "one unreachable",
      asConfigured: true,
      platformResult: "unreachable" as const,
      expected: { platform: "unreachable", assuranceStudio: "ok" },
    },
    {
      name: "one unconfigured",
      asConfigured: false,
      platformResult: "ok" as const,
      expected: { platform: "ok", assuranceStudio: "not-configured" },
    },
  ])(
    "publishes registered self-diagnosis for $name",
    async ({ name, asConfigured, expected, platformResult }) => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (input) => {
          const url = new URL(String(input));
          if (url.hostname === "platform.example") {
            if (platformResult === "401")
              return Response.json({ error: "unauthorized" }, { status: 401 });
            if (platformResult === "unreachable")
              throw new TypeError("connection refused");
          }
          return Response.json({ items: [], total: 0 });
        });
      const host = createFakePluginHost({
        pluginId: `finite-state-${platformResult}-${asConfigured}`,
      });
      await registerRemoteServices(host.bb, createPluginContext(host.bb));
      await host.harness.setSettings({
        platformBaseUrl: "https://platform.example/api",
        platformToken: "platform-secret-never-surface",
        asBaseUrl: asConfigured ? "https://fs-alpha.finitestate.io" : "",
        asApiKey: asConfigured ? "as-secret-never-surface" : "",
      });

      await vi.waitFor(
        async () => {
          expect(
            await host.harness.callRpc("remoteConnectionSelfDiagnosis"),
          ).toMatchObject({
            platform: { state: expected.platform },
            assuranceStudio: { state: expected.assuranceStudio },
          });
        },
        { timeout: platformResult === "unreachable" ? 10_000 : 1_000 },
      );
      const serialized = JSON.stringify(
        await host.harness.callRpc("remoteConnectionSelfDiagnosis"),
      );
      expect(serialized).not.toContain("platform-secret-never-surface");
      expect(serialized).not.toContain("as-secret-never-surface");
      if (name === "valid both") {
        expect(
          host.harness.realtimeSignals.filter(
            (signal) => signal.channel === "finite-state:connections-changed",
          ),
        ).toHaveLength(3);
      }
      await host.harness.lifecycle.dispose();
      fetchMock.mockRestore();
    },
  );
});
