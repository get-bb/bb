import { describe, expect, it } from "vitest";
import type { Environment, JsonValue } from "@bb/domain";
import { createBbSdk } from "../src/core.js";
import { createHttpTransport } from "../src/transport-http.js";
import type { FetchImplementation } from "../src/response.js";

interface CapturedRequest {
  bodyText: string | undefined;
  method: string;
  url: string;
}

interface QueuedJsonResponse {
  body: JsonValue;
  status?: number;
}

interface FetchQueue {
  fetch: FetchImplementation;
  requests: CapturedRequest[];
}

type EnvironmentOverrides = Partial<Environment>;

function makeEnvironment(overrides: EnvironmentOverrides = {}): Environment {
  return {
    id: "env_test",
    name: null,
    projectId: "proj_test",
    hostId: "host_test",
    path: "/workspace",
    managed: false,
    isGitRepo: true,
    isWorktree: false,
    workspaceProvisionType: "unmanaged",
    baseBranch: null,
    branchName: null,
    defaultBranch: null,
    mergeBaseBranch: null,
    cleanupRequestedAt: null,
    cleanupMode: null,
    status: "ready",
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function bodyText(init: RequestInit | undefined): string | undefined {
  return typeof init?.body === "string" ? init.body : undefined;
}

function jsonResponse(args: QueuedJsonResponse): Response {
  const status = args.status ?? 200;
  // 204 is a null-body status; the Response constructor throws on a body.
  if (status === 204) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(args.body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createFetchQueue(responses: readonly QueuedJsonResponse[]): FetchQueue {
  const requests: CapturedRequest[] = [];
  const remaining = [...responses];
  const fetchMock: FetchImplementation = async (input, init) => {
    requests.push({
      bodyText: bodyText(init),
      method: init?.method ?? "GET",
      url: String(input),
    });
    const next = remaining.shift();
    if (!next) {
      throw new Error("No queued SDK test response");
    }
    return jsonResponse(next);
  };
  return { fetch: fetchMock, requests };
}

describe("@bb/sdk", () => {
  it("routes thread list calls through the HTTP transport", async () => {
    const queue = createFetchQueue([{ body: [] }]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await expect(
      sdk.threads.list({ archived: true, projectId: "proj_123" }),
    ).resolves.toEqual([]);

    expect(queue.requests).toEqual([
      {
        bodyText: undefined,
        method: "GET",
        url: "http://bb.test/api/v1/threads?projectId=proj_123&archived=true",
      },
    ]);
  });

  it("writes app data through the wildcard app-data route", async () => {
    const queue = createFetchQueue([
      {
        body: {
          path: "state.json",
          value: { count: 1 },
          version: "v1",
          sizeBytes: 11,
          modifiedAtMs: 10,
        },
      },
    ]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await expect(
      sdk.apps.data.write({
        applicationId: "status",
        path: "state.json",
        value: { count: 1 },
      }),
    ).resolves.toMatchObject({
      path: "state.json",
      value: { count: 1 },
    });

    expect(queue.requests).toEqual([
      {
        bodyText: JSON.stringify({ value: { count: 1 } }),
        method: "PUT",
        url: "http://bb.test/api/v1/apps/status/data/state.json",
      },
    ]);
  });

  it("uses current app context for the data and message areas", async () => {
    const queue = createFetchQueue([
      {
        body: {
          path: "state.json",
          value: { count: 2 },
          version: "v2",
          sizeBytes: 11,
          modifiedAtMs: 20,
        },
      },
      { body: { ok: true } },
    ]);
    const sdk = createBbSdk({
      context: {
        applicationId: "status",
        appSessionToken: "appsess_test",
        targetThreadId: "thr_123",
      },
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "injected-app",
      }),
    });

    await expect(sdk.data.read({ path: "state.json" })).resolves.toEqual({
      count: 2,
    });
    await expect(
      sdk.message.send({ payload: "Please review." }),
    ).resolves.toBeUndefined();

    expect(queue.requests).toEqual([
      {
        bodyText: undefined,
        method: "GET",
        url: "http://bb.test/api/v1/apps/status/data/state.json",
      },
      {
        bodyText: JSON.stringify({
          payload: "Please review.",
          appSessionToken: "appsess_test",
          targetThreadId: "thr_123",
        }),
        method: "POST",
        url: "http://bb.test/api/v1/apps/status/message",
      },
    ]);
  });

  it("normalizes HTTP error responses through the transport", async () => {
    const queue = createFetchQueue([
      {
        body: { message: "Thread not found" },
        status: 404,
      },
    ]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await expect(
      sdk.threads.get({ threadId: "thr_missing" }),
    ).rejects.toThrow("HTTP 404: Thread not found");
  });

  it("updates environment metadata through the HTTP transport", async () => {
    const environment = makeEnvironment({
      id: "env_update",
      name: "Review workspace",
      mergeBaseBranch: "release",
    });
    const queue = createFetchQueue([{ body: environment }]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await expect(
      sdk.environments.update({
        environmentId: "env_update",
        mergeBaseBranch: "release",
        name: "Review workspace",
      }),
    ).resolves.toEqual(environment);

    expect(queue.requests).toEqual([
      {
        bodyText: JSON.stringify({
          mergeBaseBranch: "release",
          name: "Review workspace",
        }),
        method: "PATCH",
        url: "http://bb.test/api/v1/environments/env_update",
      },
    ]);
  });

  it("rejects empty environment updates before sending a request", async () => {
    const queue = createFetchQueue([]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await expect(
      // @ts-expect-error Environment update requires at least one update field.
      sdk.environments.update({ environmentId: "env_update" }),
    ).rejects.toThrow("At least one field must be provided");
    expect(queue.requests).toEqual([]);
  });

  it("apps.data.read resolves undefined when the data path has no entry", async () => {
    const queue = createFetchQueue([
      {
        body: { code: "ENOENT", message: "App data not found: state.json" },
        status: 404,
      },
    ]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await expect(
      sdk.apps.data.read({ applicationId: "status", path: "state.json" }),
    ).resolves.toBeUndefined();
  });

  it("serializes workflow launches and reads the created run", async () => {
    const queue = createFetchQueue([
      { body: { id: "wfr_1", status: "created" }, status: 201 },
    ]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await expect(
      sdk.workflows.run({
        projectId: "proj_123",
        source: { type: "named", name: "deep-research" },
        args: { topic: "x" },
        clientRequestId: "launch-1",
      }),
    ).resolves.toMatchObject({ id: "wfr_1" });

    // Omitted override fields must stay out of the body — the server fills
    // defaults at the boundary and treats present fields as explicit.
    expect(queue.requests).toEqual([
      {
        bodyText: JSON.stringify({
          projectId: "proj_123",
          source: { type: "named", name: "deep-research" },
          args: { topic: "x" },
          clientRequestId: "launch-1",
        }),
        method: "POST",
        url: "http://bb.test/api/v1/workflow-runs",
      },
    ]);
  });

  it("builds workflow read URLs with only the provided query params", async () => {
    const queue = createFetchQueue([
      { body: [] },
      { body: [] },
      { body: [] },
      { body: [] },
    ]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await sdk.workflows.list({ projectId: "proj_123", hostId: "host_1" });
    await sdk.workflows.listRuns({ projectId: "proj_123", limit: "10" });
    await sdk.workflows.events({ runId: "wfr_1", afterSeq: "42" });
    await sdk.workflows.events({ runId: "wfr_1" });

    expect(queue.requests.map((request) => request.url)).toEqual([
      "http://bb.test/api/v1/workflows?projectId=proj_123&hostId=host_1",
      "http://bb.test/api/v1/workflow-runs?projectId=proj_123&limit=10",
      "http://bb.test/api/v1/workflow-runs/wfr_1/events?afterSeq=42",
      "http://bb.test/api/v1/workflow-runs/wfr_1/events",
    ]);
  });

  it("resolves workflow wait to null on 204 timeout and to the run on 200", async () => {
    const queue = createFetchQueue([
      { body: null, status: 204 },
      { body: { id: "wfr_1", status: "completed" } },
    ]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await expect(
      sdk.workflows.wait({ runId: "wfr_1", waitMs: "5000" }),
    ).resolves.toBeNull();
    await expect(sdk.workflows.wait({ runId: "wfr_1" })).resolves.toMatchObject(
      { status: "completed" },
    );

    expect(queue.requests.map((request) => request.url)).toEqual([
      "http://bb.test/api/v1/workflow-runs/wfr_1/wait?waitMs=5000",
      "http://bb.test/api/v1/workflow-runs/wfr_1/wait",
    ]);
  });

  it("acks workflow cancel and surfaces lifecycle 409 codes on resume", async () => {
    const queue = createFetchQueue([
      { body: { ok: true } },
      {
        body: {
          code: "workflow_run_not_resumable",
          message: "Run is not resumable",
        },
        status: 409,
      },
    ]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await expect(sdk.workflows.cancel({ runId: "wfr_1" })).resolves.toEqual({
      ok: true,
    });
    await expect(sdk.workflows.resume({ runId: "wfr_1" })).rejects.toMatchObject(
      {
        code: "workflow_run_not_resumable",
        name: "BbHttpError",
        status: 409,
      },
    );

    expect(
      queue.requests.map((request) => `${request.method} ${request.url}`),
    ).toEqual([
      "POST http://bb.test/api/v1/workflow-runs/wfr_1/cancel",
      "POST http://bb.test/api/v1/workflow-runs/wfr_1/resume",
    ]);
  });

  it("reads per-agent workflow event logs by run id and agent index", async () => {
    const queue = createFetchQueue([{ body: [] }]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await expect(
      sdk.workflows.agentEvents({ runId: "wfr_1", agentIndex: "3" }),
    ).resolves.toEqual([]);

    expect(queue.requests).toEqual([
      {
        bodyText: undefined,
        method: "GET",
        url: "http://bb.test/api/v1/workflow-runs/wfr_1/agents/3/events",
      },
    ]);
  });

  it("apps.data.read surfaces a missing application as an error", async () => {
    const queue = createFetchQueue([
      {
        body: { code: "app_missing", message: "App not found" },
        status: 404,
      },
    ]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await expect(
      sdk.apps.data.read({ applicationId: "ghost", path: "state.json" }),
    ).rejects.toMatchObject({
      code: "app_missing",
      message: "HTTP 404: App not found",
      name: "BbHttpError",
      status: 404,
    });
  });
});
