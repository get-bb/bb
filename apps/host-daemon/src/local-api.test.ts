import http from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeferredPromise } from "@bb/test-helpers";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  createHostDaemonLocalClient,
  type WorkspaceOpenTarget,
} from "@bb/host-daemon-contract";
import { startLocalApiServer, type LocalApiServer } from "./local-api.js";
import { resolveHostPlatform } from "./host-platform.js";
import type { HostDaemonLocalApiConfig } from "./local-api-config.js";
import {
  WorkspaceOpenTargetError,
  type ListWorkspaceOpenTargetsOptions,
} from "@bb/local-open-targets";

describe("local API server", () => {
  let server: LocalApiServer | null = null;
  const finderTarget: WorkspaceOpenTarget = {
    id: "finder",
    label: "Finder",
    capabilities: {
      openDirectory: true,
      openFile: false,
      openFileAtLine: false,
    },
  };

  function createLocalApiConfig(
    overrides: Partial<HostDaemonLocalApiConfig> = {},
  ): HostDaemonLocalApiConfig {
    return {
      bindHost: "localhost",
      healthPath: "/health",
      healthValue: "ok",
      port: 0,
      ...overrides,
    };
  }

  afterEach(async () => {
    await server?.close();
    server = null;
    vi.useRealTimers();
  });

  it("rejects a foreign browser origin instead of only withholding CORS", async () => {
    const openInTarget = vi.fn(async () => undefined);
    server = await startLocalApiServer({
      hostId: "host-1",
      localApiConfig: createLocalApiConfig(),
      serverUrl: "http://server.test",
      serverPort: 3334,
      devAppPort: 5173,
      getConnected: () => true,
      openInTarget,
    });
    const baseUrl = `http://localhost:${server.port}`;

    async function postOpenInTarget(
      headers: Record<string, string>,
    ): Promise<number> {
      const response = await fetch(`${baseUrl}/open-in-target`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          context: { kind: "local" },
          columnNumber: null,
          lineNumber: null,
          path: tmpdir(),
          targetId: "vscode",
        }),
      });
      return response.status;
    }

    expect(
      await postOpenInTarget({
        "content-type": "text/plain",
        origin: "http://127.0.0.1:3009",
      }),
    ).toBe(403);
    expect(
      await postOpenInTarget({
        "content-type": "text/plain",
        origin: "http://rebind.example",
      }),
    ).toBe(403);
    expect(openInTarget).not.toHaveBeenCalled();

    expect(
      await postOpenInTarget({
        "content-type": "application/json",
        origin: "http://localhost:3334",
      }),
    ).toBe(200);
    expect(await postOpenInTarget({ "content-type": "application/json" })).toBe(
      200,
    );
    expect(openInTarget).toHaveBeenCalledTimes(2);
  });

  it("allows the exact remote server origin the daemon is enrolled with", async () => {
    server = await startLocalApiServer({
      hostId: "host-remote",
      localApiConfig: createLocalApiConfig(),
      serverUrl: "https://remote-bb.example.test/projects/proj_1",
      serverPort: 0,
      getConnected: () => true,
    });

    const response = await fetch(`http://localhost:${server.port}/status`, {
      headers: { Origin: "https://remote-bb.example.test" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://remote-bb.example.test",
    );
  });

  it("rejects a DNS-rebound origin that matches its own Host", async () => {
    const openInTarget = vi.fn(async () => undefined);
    server = await startLocalApiServer({
      hostId: "host-1",
      localApiConfig: createLocalApiConfig(),
      serverUrl: "http://server.test",
      serverPort: 3334,
      devAppPort: 5173,
      getConnected: () => true,
      openInTarget,
    });
    const { port } = server;
    const { bindHost } = server;

    function post(headers: Record<string, string>): Promise<number> {
      return new Promise((resolve, reject) => {
        const request = http.request(
          {
            host: bindHost,
            port,
            path: "/open-in-target",
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
          },
          (response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
          },
        );
        request.once("error", reject);
        request.end(
          JSON.stringify({
            context: { kind: "local" },
            columnNumber: null,
            lineNumber: null,
            path: tmpdir(),
            targetId: "vscode",
          }),
        );
      });
    }

    expect(
      await post({
        origin: `http://rebind.example:${port}`,
        host: `rebind.example:${port}`,
      }),
    ).toBe(403);
    expect(openInTarget).not.toHaveBeenCalled();

    expect(
      await post({
        origin: `http://${bindHost}:${port}`,
        host: `${bindHost}:${port}`,
      }),
    ).toBe(200);
    expect(openInTarget).toHaveBeenCalledTimes(1);
  });

  it("serves host identity and status over localhost", async () => {
    server = await startLocalApiServer({
      hostId: "host-1",
      localApiConfig: createLocalApiConfig(),
      serverUrl: "http://server.test",
      serverPort: 3334,
      devAppPort: 5173,
      getConnected: () => true,
    });
    const client = createHostDaemonLocalClient(
      `http://localhost:${server.port}`,
    );

    const statusResponse = await client.status.$get();

    expect(await statusResponse.json()).toEqual({
      hostId: "host-1",
      connected: true,
      protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
      serverUrl: "http://server.test",
      supportsNativeFolderPicker: process.platform === "darwin",
      platform: resolveHostPlatform(),
    });
    const healthResponse = await client.health.$get();
    expect(await healthResponse.text()).toBe("ok");
  });

  it("explains how to resolve a local API port collision", async () => {
    const occupied = createNetServer();
    await new Promise<void>((resolve, reject) => {
      occupied.once("error", reject);
      occupied.listen(0, "127.0.0.1", resolve);
    });
    const address = occupied.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected occupied test server to have a TCP address");
    }

    try {
      await expect(
        startLocalApiServer({
          hostId: "host-1",
          localApiConfig: createLocalApiConfig({
            bindHost: "127.0.0.1",
            port: address.port,
          }),
          serverUrl: "http://server.test",
          serverPort: 3334,
          getConnected: () => true,
        }),
      ).rejects.toThrow(
        `Host daemon local API port ${address.port} is already in use on 127.0.0.1. Choose another port with --host-daemon-port <port>.`,
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        occupied.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("lists workspace open targets and delegates target-aware open requests", async () => {
    const workspacePath = await mkdtemp(path.join(tmpdir(), "bb-workspace-"));
    const targets: WorkspaceOpenTarget[] = [
      {
        capabilities: {
          openDirectory: true,
          openFile: true,
          openFileAtLine: true,
        },
        id: "vscode",
        label: "VS Code",
      },
      {
        capabilities: {
          openDirectory: true,
          openFile: false,
          openFileAtLine: false,
        },
        id: "finder",
        label: "Finder",
      },
    ];
    const listWorkspaceOpenTargets = vi.fn(async () => targets);
    const openInTarget = vi.fn(async () => undefined);

    server = await startLocalApiServer({
      hostId: "host-1",
      localApiConfig: createLocalApiConfig(),
      serverUrl: "http://server.test",
      serverPort: 3334,
      devAppPort: 5173,
      getConnected: () => true,
      listWorkspaceOpenTargets,
      openInTarget,
    });
    const client = createHostDaemonLocalClient(
      `http://localhost:${server.port}`,
    );

    const targetsResponse = await client["workspace-open-targets"].$get({
      query: {},
    });
    await client["open-in-target"].$post({
      json: {
        context: { kind: "local" },
        columnNumber: null,
        lineNumber: null,
        path: workspacePath,
        targetId: "vscode",
      },
    });

    expect(await targetsResponse.json()).toEqual({ targets });
    expect(listWorkspaceOpenTargets).toHaveBeenCalledWith({});
    expect(openInTarget).toHaveBeenCalledWith({
      context: { kind: "local" },
      columnNumber: null,
      lineNumber: null,
      path: workspacePath,
      targetId: "vscode",
    });

    await rm(workspacePath, { recursive: true, force: true });
  });

  it("shares slow discovery and serves stale targets while refreshing after a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    const listWorkspaceOpenTargets = vi.fn(async () => {
      vi.setSystemTime(61_000);
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      return [finderTarget];
    });
    server = await startLocalApiServer({
      hostId: "host-1",
      localApiConfig: createLocalApiConfig(),
      serverUrl: "http://server.test",
      serverPort: 3334,
      getConnected: () => true,
      listWorkspaceOpenTargets,
    });
    const url = `http://localhost:${server.port}/workspace-open-targets`;
    const responses = await Promise.all([fetch(url), fetch(url)]);
    for (const response of responses) {
      expect(await response.json()).toEqual({
        targets: [finderTarget],
      });
    }
    expect(listWorkspaceOpenTargets).toHaveBeenCalledTimes(1);

    vi.setSystemTime(120_999);
    expect((await fetch(url)).status).toBe(200);
    expect(listWorkspaceOpenTargets).toHaveBeenCalledTimes(1);

    const refresh = createDeferredPromise<WorkspaceOpenTarget[]>();
    listWorkspaceOpenTargets.mockReturnValue(refresh.promise);
    vi.setSystemTime(121_000);
    try {
      const staleResponses = await Promise.all([
        fetch(url, { signal: AbortSignal.timeout(1_000) }),
        fetch(url, { signal: AbortSignal.timeout(1_000) }),
      ]);
      for (const response of staleResponses) {
        expect(await response.json()).toEqual({ targets: [finderTarget] });
      }
      expect(listWorkspaceOpenTargets).toHaveBeenCalledTimes(2);
    } finally {
      refresh.resolve([]);
    }
    await expect
      .poll(async () => (await fetch(url)).json())
      .toEqual({ targets: [] });
  });

  it("keeps file-specific discovery fresh and invalidates cached targets when PATH changes", async () => {
    let shellPath = "/first/bin";
    const listWorkspaceOpenTargets = vi.fn(
      async (query: ListWorkspaceOpenTargetsOptions) =>
        query.path === undefined
          ? [{ ...finderTarget, label: shellPath }]
          : [
              ...(query.baseTargets ?? []),
              { ...finderTarget, id: "vscode" as const, label: query.path },
            ],
    );
    server = await startLocalApiServer({
      hostId: "host-1",
      localApiConfig: createLocalApiConfig(),
      serverUrl: "http://server.test",
      serverPort: 3334,
      getConnected: () => true,
      listWorkspaceOpenTargets,
      shellEnv: () => ({ PATH: shellPath }),
    });
    const url = `http://localhost:${server.port}/workspace-open-targets`;
    const initial = await (await fetch(url)).json();
    for (const filePath of ["/tmp/file.ts", "/tmp/file.png", "/tmp/file.ts"]) {
      expect(
        await (
          await fetch(`${url}?path=${encodeURIComponent(filePath)}`)
        ).json(),
      ).toEqual({
        targets: [
          { ...finderTarget, label: "/first/bin" },
          { ...finderTarget, id: "vscode", label: filePath },
        ],
      });
    }
    expect(await (await fetch(url)).json()).toEqual(initial);
    expect(listWorkspaceOpenTargets).toHaveBeenCalledTimes(4);

    shellPath = "/second/bin";
    expect(await (await fetch(`${url}?path=/tmp/file.ts`)).json()).toEqual({
      targets: [
        { ...finderTarget, label: "/second/bin" },
        { ...finderTarget, id: "vscode", label: "/tmp/file.ts" },
      ],
    });
    expect(await (await fetch(url)).json()).toEqual({
      targets: [{ ...finderTarget, label: "/second/bin" }],
    });
    expect(listWorkspaceOpenTargets).toHaveBeenCalledTimes(6);
    expect((await fetch(url)).status).toBe(200);
    expect(listWorkspaceOpenTargets).toHaveBeenCalledTimes(6);
  });

  it("retries failed open-target discovery instead of caching the failure", async () => {
    const listWorkspaceOpenTargets = vi
      .fn<() => Promise<WorkspaceOpenTarget[]>>()
      .mockRejectedValueOnce(new Error("discovery failed"))
      .mockResolvedValue([finderTarget]);
    server = await startLocalApiServer({
      hostId: "host-1",
      localApiConfig: createLocalApiConfig(),
      serverUrl: "http://server.test",
      serverPort: 3334,
      getConnected: () => true,
      listWorkspaceOpenTargets,
    });
    const url = `http://localhost:${server.port}/workspace-open-targets`;
    expect((await fetch(url)).status).toBe(500);
    expect(await (await fetch(url)).json()).toEqual({
      targets: [finderTarget],
    });
    expect((await fetch(url)).status).toBe(200);
    expect(listWorkspaceOpenTargets).toHaveBeenCalledTimes(2);
  });

  it("retries client configuration after an invalid file is repaired", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    const dataDir = await mkdtemp(path.join(tmpdir(), "bb-client-config-"));
    const configPath = path.join(dataDir, "client.json");
    const origin = "https://remote-bb.example.test";
    try {
      await writeFile(configPath, "{");
      server = await startLocalApiServer({
        dataDir,
        hostId: "host-1",
        localApiConfig: createLocalApiConfig(),
        serverUrl: "http://server.test",
        serverPort: 3334,
        getConnected: () => true,
      });
      const url = `http://localhost:${server.port}/status`;
      expect((await fetch(url, { headers: { origin } })).status).toBe(403);
      await writeFile(
        configPath,
        JSON.stringify({ servers: { [origin]: {} } }),
      );
      expect((await fetch(url, { headers: { origin } })).status).toBe(200);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("allows configured remote origins and resolves remote SSH open requests", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bb-client-config-"));
    await writeFile(
      path.join(dataDir, "client.json"),
      JSON.stringify({
        servers: {
          "https://remote-bb.example.test": {
            hosts: {
              host_remote: {
                sshAuthority: "devbox",
              },
            },
          },
        },
      }),
      "utf8",
    );
    const openInTarget = vi.fn(async () => undefined);

    try {
      server = await startLocalApiServer({
        dataDir,
        hostId: "host-1",
        localApiConfig: createLocalApiConfig(),
        serverUrl: "http://server.test",
        serverPort: 3334,
        devAppPort: 5173,
        getConnected: () => true,
        openInTarget,
      });
      const client = createHostDaemonLocalClient(
        `http://localhost:${server.port}`,
      );

      const corsResponse = await fetch(
        `http://localhost:${server.port}/workspace-open-targets?path=/tmp/file.ts`,
        {
          headers: {
            Origin: "https://remote-bb.example.test",
          },
        },
      );
      expect(corsResponse.headers.get("access-control-allow-origin")).toBe(
        "https://remote-bb.example.test",
      );

      const response = await client["open-in-target"].$post({
        json: {
          context: {
            kind: "remote-ssh",
            serverOrigin: "https://remote-bb.example.test/projects/proj_1",
            hostId: "host_remote",
          },
          columnNumber: 4,
          lineNumber: 10,
          path: "/home/me/project/src/file.ts",
          targetId: "vscode",
        },
      });

      expect(response.status).toBe(200);
      expect(openInTarget).toHaveBeenCalledWith({
        context: { kind: "remote-ssh", sshAuthority: "devbox" },
        columnNumber: 4,
        lineNumber: 10,
        path: "/home/me/project/src/file.ts",
        targetId: "vscode",
      });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns setup guidance for remote SSH opens without a mapping", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "bb-client-config-"));
    await writeFile(
      path.join(dataDir, "client.json"),
      JSON.stringify({
        servers: {
          "https://remote-bb.example.test": {
            hosts: {},
          },
        },
      }),
      "utf8",
    );

    try {
      server = await startLocalApiServer({
        dataDir,
        hostId: "host-1",
        localApiConfig: createLocalApiConfig(),
        serverUrl: "http://server.test",
        serverPort: 3334,
        devAppPort: 5173,
        getConnected: () => true,
      });
      const client = createHostDaemonLocalClient(
        `http://localhost:${server.port}`,
      );

      const response = await client["open-in-target"].$post({
        json: {
          context: {
            kind: "remote-ssh",
            serverOrigin: "https://remote-bb.example.test",
            hostId: "host_missing",
          },
          columnNumber: null,
          lineNumber: null,
          path: "/home/me/project",
          targetId: "vscode",
        },
      });

      expect(response.status).toBe(400);
      expect(await response.text()).toContain(
        "bb-app client ssh-target set https://remote-bb.example.test <ssh-target>",
      );
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("translates workspace opener errors to bad requests", async () => {
    const openInTarget = vi.fn(async () => {
      throw new WorkspaceOpenTargetError({
        code: "target_unavailable",
        message: "Workspace open target is unavailable: VS Code",
      });
    });
    server = await startLocalApiServer({
      hostId: "host-1",
      localApiConfig: createLocalApiConfig(),
      serverUrl: "http://server.test",
      serverPort: 3334,
      devAppPort: 5173,
      getConnected: () => true,
      openInTarget,
    });
    const client = createHostDaemonLocalClient(
      `http://localhost:${server.port}`,
    );

    const response = await client["open-in-target"].$post({
      json: {
        context: { kind: "local" },
        columnNumber: null,
        lineNumber: null,
        path: "/tmp/workspace",
        targetId: "vscode",
      },
    });

    expect(response.status).toBe(400);
    expect(openInTarget).toHaveBeenCalledWith({
      context: { kind: "local" },
      columnNumber: null,
      lineNumber: null,
      path: "/tmp/workspace",
      targetId: "vscode",
    });
  });
});
