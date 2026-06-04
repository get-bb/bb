import { describe, expect, it, vi } from "vitest";
import type {
  AppDataBroadcastMessage,
  AppDataListResponse,
} from "@bb/server-contract";
import type { BbSdk } from "@bb/sdk";
import { createBbSdk } from "@bb/sdk/core";
import { createHttpTransport } from "@bb/sdk/browser";
import { appRuntimeBrowserBundle } from "@bb/sdk/app-runtime";
import {
  appRuntimeScriptAsset,
  injectAppClientScript,
  type AppClientBootstrap,
} from "../../../src/services/threads/app-client-script.js";

type OpenHandler = () => void;
type CloseHandler = () => void;
type ErrorHandler = () => void;
type MessageHandler = (event: SocketMessageEvent) => void;
type FetchMock = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
type FetchCall = Parameters<FetchMock>;

interface SocketMessageEvent {
  data: string;
}

interface ScriptWindow {
  bb?: BbSdk;
  fetch?: FetchMock;
}

interface ExecuteScriptArgs {
  fetchMock: FetchMock;
  windowObject: ScriptWindow;
}

interface DeferredResponse {
  promise: Promise<Response>;
  resolve(response: Response): void;
}

interface SdkSurfaceParityArgs {
  actual: BbSdk;
  reference: BbSdk;
}

const bootstrap: AppClientBootstrap = {
  applicationId: "status",
  appSessionToken: "appsess_test",
  targetThreadId: "thr_123",
  wsUrl: "ws://server/ws",
};

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  messages: string[] = [];
  onclose: CloseHandler | null = null;
  onerror: ErrorHandler | null = null;
  onmessage: MessageHandler | null = null;
  onopen: OpenHandler | null = null;
  readyState = FakeWebSocket.CONNECTING;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  emit(payload: AppDataBroadcastMessage): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  send(message: string): void {
    this.messages.push(message);
  }
}

function extractBootstrapScript(html: string): string {
  const match = /<script data-bb-app-client>([\s\S]*?)<\/script>/u.exec(html);
  const script = match?.[1];
  if (!script) {
    throw new Error("Injected app client bootstrap script not found");
  }
  return script;
}

function extractRuntimeScriptUrl(html: string): string {
  const match = /<script src="([^"]+)"><\/script>/u.exec(html);
  const url = match?.[1];
  if (!url) {
    throw new Error("Injected app runtime script reference not found");
  }
  return url;
}

function executeScript(args: ExecuteScriptArgs): void {
  FakeWebSocket.instances = [];
  args.windowObject.fetch = args.fetchMock;
  const html = injectAppClientScript("<html><head></head></html>", bootstrap);
  if (extractRuntimeScriptUrl(html) !== appRuntimeScriptAsset.url) {
    throw new Error("Injected HTML references an unexpected runtime URL");
  }
  // Mirror the browser: the inline bootstrap runs first, then the shared
  // runtime bundle the script src points at.
  const script = `${extractBootstrapScript(html)}\n${
    appRuntimeBrowserBundle.contents
  }`;
  const runScript = new Function("window", "fetch", "WebSocket", script);
  runScript(args.windowObject, args.fetchMock, FakeWebSocket);
}

function listResponse(body: AppDataListResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function jsonResponse(body: object): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function requireBb(windowObject: ScriptWindow): BbSdk {
  if (!windowObject.bb) {
    throw new Error("window.bb was not installed");
  }
  return windowObject.bb;
}

function createDeferredResponse(): DeferredResponse {
  let resolvePromise: DeferredResponse["resolve"] = () => {};
  const promise = new Promise<Response>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: resolvePromise,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function expectSdkSurfaceParity(args: SdkSurfaceParityArgs) {
  expect(Object.keys(args.actual).sort()).toEqual(
    Object.keys(args.reference).sort(),
  );
  expect(Object.keys(args.actual.apps).sort()).toEqual(
    Object.keys(args.reference.apps).sort(),
  );
  expect(Object.keys(args.actual.apps.data).sort()).toEqual(
    Object.keys(args.reference.apps.data).sort(),
  );
  expect(Object.keys(args.actual.data).sort()).toEqual(
    Object.keys(args.reference.data).sort(),
  );
  expect(Object.keys(args.actual.environments).sort()).toEqual(
    Object.keys(args.reference.environments).sort(),
  );
  expect(Object.keys(args.actual.guide).sort()).toEqual(
    Object.keys(args.reference.guide).sort(),
  );
  expect(Object.keys(args.actual.hosts).sort()).toEqual(
    Object.keys(args.reference.hosts).sort(),
  );
  expect(Object.keys(args.actual.managers).sort()).toEqual(
    Object.keys(args.reference.managers).sort(),
  );
  expect(Object.keys(args.actual.message).sort()).toEqual(
    Object.keys(args.reference.message).sort(),
  );
  expect(Object.keys(args.actual.projects).sort()).toEqual(
    Object.keys(args.reference.projects).sort(),
  );
  expect(Object.keys(args.actual.projects.sources).sort()).toEqual(
    Object.keys(args.reference.projects.sources).sort(),
  );
  expect(Object.keys(args.actual.providers).sort()).toEqual(
    Object.keys(args.reference.providers).sort(),
  );
  expect(Object.keys(args.actual.replay).sort()).toEqual(
    Object.keys(args.reference.replay).sort(),
  );
  expect(Object.keys(args.actual.status).sort()).toEqual(
    Object.keys(args.reference.status).sort(),
  );
  expect(Object.keys(args.actual.threads).sort()).toEqual(
    Object.keys(args.reference.threads).sort(),
  );
  expect(Object.keys(args.actual.threads.events).sort()).toEqual(
    Object.keys(args.reference.threads.events).sort(),
  );
  expect(Object.keys(args.actual.threads.interactions).sort()).toEqual(
    Object.keys(args.reference.threads.interactions).sort(),
  );
}

describe("app client script", () => {
  it("installs the real SDK surface and routes representative parity methods", async () => {
    const fetchCalls: FetchCall[] = [];
    const fetchMock: FetchMock = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = String(input);
      if (url.includes("/api/v1/projects/proj_1/sources")) {
        return jsonResponse({
          id: "src_1",
          projectId: "proj_1",
          type: "local_path",
          hostId: "host_1",
          path: "/tmp/project",
          isDefault: true,
        });
      }
      if (url.includes("/api/v1/projects/proj_1")) {
        return jsonResponse({ id: "proj_1", name: "Project" });
      }
      if (url.includes("/api/v1/threads/mgr_1")) {
        return jsonResponse({
          id: "mgr_1",
          projectId: "proj_1",
          type: "manager",
          status: "idle",
          title: "Manager",
          parentThreadId: null,
          pinnedAt: null,
          environmentId: null,
        });
      }
      if (url.includes("/api/v1/threads?")) {
        return jsonResponse([]);
      }
      if (url.includes("/api/v1/environments/env_1/diff/branches")) {
        return jsonResponse({ branches: [] });
      }
      if (url.includes("/api/v1/environments/env_1/diff/file")) {
        return jsonResponse({ file: null });
      }
      return jsonResponse({});
    };
    const windowObject: ScriptWindow = {};
    executeScript({ fetchMock, windowObject });

    const bb = requireBb(windowObject);
    const reference = createBbSdk({
      context: {
        applicationId: bootstrap.applicationId,
        ...(bootstrap.appSessionToken
          ? { appSessionToken: bootstrap.appSessionToken }
          : {}),
        ...(bootstrap.targetThreadId
          ? { targetThreadId: bootstrap.targetThreadId }
          : {}),
      },
      transport: createHttpTransport({
        fetch: fetchMock,
        runtime: "injected-app",
      }),
    });

    expectSdkSurfaceParity({ actual: bb, reference });
    await expect(bb.status.get({ projectId: "proj_1" })).resolves.toMatchObject(
      {
        project: { id: "proj_1", name: "Project" },
      },
    );
    await expect(
      bb.managers.status({ managerId: "mgr_1" }),
    ).resolves.toMatchObject({
      manager: { id: "mgr_1", type: "manager" },
      managedThreads: [],
    });
    await expect(
      bb.projects.sources.add({
        projectId: "proj_1",
        type: "local_path",
        hostId: "host_1",
        path: "/tmp/project",
      }),
    ).resolves.toMatchObject({ id: "src_1" });
    expect(bb.guide.render({ chapter: "app" }).content).toContain("Apps");
    await expect(
      bb.environments.diffBranches({
        environmentId: "env_1",
        query: "main",
        limit: "5",
      }),
    ).resolves.toEqual({ branches: [] });
    await expect(
      bb.environments.diffFile({
        environmentId: "env_1",
        target: "uncommitted",
        path: "README.md",
        side: "new",
      }),
    ).resolves.toEqual({ file: null });

    const calledUrls = fetchCalls.map((call) => String(call[0]));
    expect(calledUrls.some((url) => url.includes("/api/v1/projects/proj_1"))).toBe(
      true,
    );
    expect(calledUrls.some((url) => url.includes("/api/v1/threads/mgr_1"))).toBe(
      true,
    );
    expect(
      calledUrls.some((url) =>
        url.includes("/api/v1/environments/env_1/diff/branches"),
      ),
    ).toBe(true);
    expect(
      calledUrls.some((url) =>
        url.includes("/api/v1/environments/env_1/diff/file"),
      ),
    ).toBe(true);
  });

  it("subscribes before replaying existing data for onChange", async () => {
    const fetchMock = vi.fn(async () => listResponse({ entries: [] }));
    const windowObject: ScriptWindow = {};
    executeScript({ fetchMock, windowObject });

    const bb = requireBb(windowObject);
    bb.data.onChange({ prefix: "", callback: vi.fn() });
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
    const socket = FakeWebSocket.instances[0];
    if (!socket) {
      throw new Error("Expected websocket");
    }
    socket.open();
    await flushPromises();

    expect(JSON.parse(socket.messages[0] ?? "")).toEqual({
      type: "subscribe",
      entity: "app",
      id: "status:data",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/apps/status/data?prefix=",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("does not deliver initial replay entries after onChange unsubscribe", async () => {
    const deferred = createDeferredResponse();
    const fetchMock = vi.fn(async () => deferred.promise);
    const windowObject: ScriptWindow = {};
    executeScript({ fetchMock, windowObject });

    const bb = requireBb(windowObject);
    const callback = vi.fn();
    const unsubscribe = bb.data.onChange({ prefix: "", callback });
    await Promise.resolve();
    const socket = FakeWebSocket.instances[0];
    if (!socket) {
      throw new Error("Expected websocket");
    }
    socket.open();
    await flushPromises();

    unsubscribe();
    deferred.resolve(
      listResponse({
        entries: [
          {
            path: "state.json",
            value: { count: 1 },
            version: "v1",
            sizeBytes: 1,
            modifiedAtMs: 1,
          },
        ],
      }),
    );
    await flushPromises();

    expect(callback).not.toHaveBeenCalled();
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
    expect(socket.messages.map((message) => JSON.parse(message))).toEqual([
      {
        type: "subscribe",
        entity: "app",
        id: "status:data",
      },
      {
        type: "unsubscribe",
        entity: "app",
        id: "status:data",
      },
    ]);
  });

  it("replays existing data when a resync hint arrives", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        listResponse({
          entries: [
            {
              path: "state.json",
              value: { count: 1 },
              version: "v1",
              sizeBytes: 1,
              modifiedAtMs: 1,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        listResponse({
          entries: [
            {
              path: "state.json",
              value: { count: 2 },
              version: "v2",
              sizeBytes: 1,
              modifiedAtMs: 2,
            },
          ],
        }),
      );
    const windowObject: ScriptWindow = {};
    executeScript({ fetchMock, windowObject });

    const bb = requireBb(windowObject);
    const callback = vi.fn();
    bb.data.onChange({ prefix: "", callback });
    await Promise.resolve();
    const socket = FakeWebSocket.instances[0];
    if (!socket) {
      throw new Error("Expected websocket");
    }
    socket.open();
    await flushPromises();
    socket.emit({
      type: "app-data.resync",
      applicationId: "status",
    });
    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledTimes(2);
    });

    expect(callback).toHaveBeenCalledWith({
      path: "state.json",
      value: { count: 1 },
      deleted: false,
    });
    expect(callback).toHaveBeenCalledWith({
      path: "state.json",
      value: { count: 2 },
      deleted: false,
    });
  });

  it("preserves data read write delete and list behavior with SDK object args", async () => {
    const fetchMock: FetchMock = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/data/state.json") && init?.method === "GET") {
        return new Response(
          JSON.stringify({
            path: "state.json",
            value: { count: 1 },
            version: "v1",
            sizeBytes: 1,
            modifiedAtMs: 1,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (url.endsWith("/data") && init?.method === "GET") {
        return listResponse({
          entries: [
            {
              path: "state.json",
              value: { count: 1 },
              version: "v1",
              sizeBytes: 1,
              modifiedAtMs: 1,
            },
          ],
        });
      }
      if (url.endsWith("/data?prefix=") && init?.method === "GET") {
        return listResponse({
          entries: [
            {
              path: "state.json",
              value: { count: 1 },
              version: "v1",
              sizeBytes: 1,
              modifiedAtMs: 1,
            },
          ],
        });
      }
      if (url.endsWith("/data/state.json") && init?.method === "PUT") {
        return jsonResponse({
          path: "state.json",
          value: { count: 2 },
          version: "v2",
          sizeBytes: 1,
          modifiedAtMs: 2,
        });
      }
      return new Response(null, { status: 204 });
    });
    const windowObject: ScriptWindow = {};
    executeScript({ fetchMock, windowObject });

    const bb = requireBb(windowObject);
    await expect(bb.data.read({ path: "state.json" })).resolves.toEqual({
      count: 1,
    });
    await expect(
      bb.data.write({ path: "state.json", value: { count: 2 } }),
    ).resolves.toBeUndefined();
    await expect(
      bb.data.delete({ path: "state.json" }),
    ).resolves.toBeUndefined();
    await expect(bb.data.list({ prefix: "" })).resolves.toEqual([
      { path: "state.json", value: { count: 1 } },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/apps/status/data/state.json",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/apps/status/data/state.json",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("sends app messages through the SDK message area", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    const windowObject: ScriptWindow = {};
    executeScript({ fetchMock, windowObject });

    const bb = requireBb(windowObject);
    await expect(
      bb.message.send({ payload: "Please review.", targetThreadId: "thr_456" }),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/apps/status/message",
      expect.objectContaining({
        body: JSON.stringify({
          payload: "Please review.",
          appSessionToken: "appsess_test",
          targetThreadId: "thr_456",
        }),
        method: "POST",
      }),
    );
  });
});
