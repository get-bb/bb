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

  it("defaults automation create to the personal project", async () => {
    const queue = createFetchQueue([{ body: { id: "auto_1" }, status: 201 }]);
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
      }),
    });

    await sdk.automations.create({
      name: "Digest",
      trigger: {
        triggerType: "schedule",
        cron: "0 9 * * 1-5",
        timezone: "America/New_York",
      },
      execution: {
        mode: "agent",
        prompt: "Summarize.",
        providerId: "codex",
        model: "gpt-5",
        permissionMode: "readonly",
      },
      environment: { type: "host", workspace: { type: "personal" } },
      origin: "human",
    });

    expect(queue.requests[0]?.url).toBe(
      "http://bb.test/api/v1/projects/proj_personal/automations",
    );
    expect(queue.requests[0]?.method).toBe("POST");
  });

  it("stamps origin agent and createdByThreadId from BB_THREAD_ID on create", async () => {
    const previous = process.env.BB_THREAD_ID;
    process.env.BB_THREAD_ID = "thr_creator";
    try {
      const queue = createFetchQueue([{ body: { id: "auto_2" }, status: 201 }]);
      const sdk = createBbSdk({
        transport: createHttpTransport({
          baseUrl: "http://bb.test",
          fetch: queue.fetch,
          runtime: "node",
        }),
      });

      await sdk.automations.create({
        projectId: "proj_123",
        name: "Digest",
        trigger: {
          triggerType: "schedule",
          cron: "0 9 * * 1-5",
          timezone: "America/New_York",
        },
        execution: {
          mode: "agent",
          prompt: "Summarize.",
          providerId: "codex",
          model: "gpt-5",
          permissionMode: "readonly",
        },
        environment: { type: "host", workspace: { type: "personal" } },
        // origin omitted on purpose: the SDK should fill it from the thread env.
      } as Parameters<typeof sdk.automations.create>[0]);

      const body = JSON.parse(queue.requests[0]?.bodyText ?? "{}");
      expect(body.origin).toBe("agent");
      expect(body.createdByThreadId).toBe("thr_creator");
    } finally {
      if (previous === undefined) {
        delete process.env.BB_THREAD_ID;
      } else {
        process.env.BB_THREAD_ID = previous;
      }
    }
  });

});
