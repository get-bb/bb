import { describe, expect, it } from "vitest";
import { createBbSdk } from "../src/core.js";
import {
  PluginRollbackUnsupportedError,
  PluginUpdateExpectedVersionUnsupportedError,
} from "../src/areas/plugins.js";
import { createHttpTransport } from "../src/transport-http.js";

const base = { id: "update-1", pluginId: "notes", displayName: "Notes" };
const result = {
  applied: true,
  from: { version: "1.0.0", label: "1.0.0", display: "1.0.0" },
  to: { version: "1.1.0", label: "1.1.0", display: "1.1.0" },
  outcome: "updated",
};

function server(final: object) {
  const requests: Request[] = [];
  const sdk = createBbSdk({
    transport: createHttpTransport({
      baseUrl: "http://bb.test",
      runtime: "node",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        const start = request.method === "POST";
        return new Response(
          JSON.stringify({
            job: {
              ...base,
              ...(start ? { state: "running", phase: "checking" } : final),
            },
          }),
          { status: start ? 202 : 200 },
        );
      },
    }),
  });
  return { sdk, requests };
}

function rejectingServer(error: string) {
  return createBbSdk({
    transport: createHttpTransport({
      baseUrl: "http://bb.test",
      runtime: "node",
      fetch: async () =>
        new Response(JSON.stringify({ error }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    }),
  });
}

describe("background plugin updates", () => {
  it.each([
    result,
    {
      ...result,
      applied: false,
      outcome: "rolled-back",
      detail: "restored previous version",
    },
  ])(
    "waits for the job and preserves the $outcome result",
    async (expected) => {
      const { sdk, requests } = server({
        state: "completed",
        result: expected,
      });
      await expect(
        sdk.plugins.applyUpdate({ pluginId: "notes" }),
      ).resolves.toEqual(expected);
      expect(
        requests.map((request) => [
          request.method,
          new URL(request.url).pathname,
        ]),
      ).toEqual([
        ["POST", "/api/v1/plugins/notes/update"],
        ["GET", "/api/v1/plugins/update-jobs/update-1"],
      ]);
      expect(requests[0]?.headers.get("prefer")).toBe("respond-async");
    },
  );

  it("returns immediately for callers that want to follow the job themselves", async () => {
    const { sdk, requests } = server({
      state: "failed",
      error: "source unavailable",
    });
    await expect(
      sdk.plugins.experimental_startUpdate({ pluginId: "notes" }),
    ).resolves.toMatchObject({ state: "running", phase: "checking" });
    expect(requests).toHaveLength(1);
  });

  it("sends the reviewed version so the server can refuse a different release", async () => {
    const { sdk, requests } = server({ state: "completed", result });
    await sdk.plugins.applyUpdate({
      pluginId: "notes",
      expectedVersion: "1.1.0",
    });
    await sdk.plugins.experimental_startUpdate({
      pluginId: "notes",
      expectedVersion: "1.1.0",
    });
    await sdk.plugins.experimental_startUpdate({ pluginId: "notes" });
    const bodies = await Promise.all(
      requests
        .filter((request) => request.method === "POST")
        .map((request) => request.json()),
    );
    expect(bodies).toEqual([
      { expectedVersion: "1.1.0" },
      { expectedVersion: "1.1.0" },
      {},
    ]);
  });

  it.each(["applyUpdate", "experimental_startUpdate"] as const)(
    "explains that a server predating reviewed-release updates cannot honor %s's expectedVersion",
    async (method) => {
      const sdk = rejectingServer("expected an empty JSON object");
      const error: unknown = await sdk.plugins[method]({
        pluginId: "notes",
        expectedVersion: "1.1.0",
      }).catch((rejection: unknown) => rejection);
      expect(error).toBeInstanceOf(PluginUpdateExpectedVersionUnsupportedError);
      expect(error).toMatchObject({
        pluginId: "notes",
        expectedVersion: "1.1.0",
        message:
          'Update not started; this BB server predates reviewed-release updates and cannot honor expectedVersion "1.1.0". Upgrade the BB server, or retry without expectedVersion',
      });
    },
  );

  it("keeps other rejected update requests as the server reported them", async () => {
    const sdk = rejectingServer('expected { "expectedVersion"?: string }');
    await expect(
      sdk.plugins.applyUpdate({ pluginId: "notes", expectedVersion: "1.1.0" }),
    ).rejects.toThrow('HTTP 400: expected { "expectedVersion"?: string }');
  });

  it("reports a failed job instead of a successful update", async () => {
    const { sdk } = server({ state: "failed", error: "source unavailable" });
    await expect(
      sdk.plugins.applyUpdate({ pluginId: "notes" }),
    ).rejects.toThrow("source unavailable");
  });

  it("retains compatibility with servers returning the completed result", async () => {
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        runtime: "node",
        fetch: async () => new Response(JSON.stringify(result)),
      }),
    });
    await expect(
      sdk.plugins.applyUpdate({ pluginId: "notes" }),
    ).resolves.toEqual(result);
  });
});

describe("plugin rollback", () => {
  const reverted = {
    applied: true,
    from: { version: "1.1.0", label: "1.1.0", display: "1.1.0" },
    to: { version: "1.0.0", label: "1.0.0", display: "1.0.0" },
    outcome: "reverted",
  };

  it("starts a rollback job bound to the reviewed version and waits for its result", async () => {
    const { sdk, requests } = server({
      kind: "rollback",
      state: "completed",
      result: reverted,
    });
    await expect(
      sdk.plugins.experimental_rollbackUpdate({
        pluginId: "notes",
        expectedVersion: "1.0.0",
      }),
    ).resolves.toEqual(reverted);
    expect(
      requests.map((request) => [
        request.method,
        new URL(request.url).pathname,
      ]),
    ).toEqual([
      ["POST", "/api/v1/plugins/notes/rollback"],
      ["GET", "/api/v1/plugins/update-jobs/update-1"],
    ]);
    expect(requests[0]?.headers.get("prefer")).toBe("respond-async");
    await expect(requests[0]?.json()).resolves.toEqual({
      expectedVersion: "1.0.0",
    });
  });

  it("returns the started job for callers that follow it themselves", async () => {
    const { sdk, requests } = server({
      state: "failed",
      error: "no rollback point",
    });
    await expect(
      sdk.plugins.experimental_startRollbackUpdate({ pluginId: "notes" }),
    ).resolves.toMatchObject({ id: "update-1", state: "running" });
    expect(requests).toHaveLength(1);
    await expect(requests[0]?.json()).resolves.toEqual({});
  });

  it("reports a refused rollback as an error", async () => {
    const { sdk } = server({
      kind: "rollback",
      state: "failed",
      error: 'plugin "notes" has no rollback point',
    });
    await expect(
      sdk.plugins.experimental_rollbackUpdate({ pluginId: "notes" }),
    ).rejects.toThrow('plugin "notes" has no rollback point');
  });

  it.each([
    "experimental_getRollbackPoint",
    "experimental_startRollbackUpdate",
  ] as const)(
    "reports a server without the rollback route as predating rollback from %s",
    async (member) => {
      const sdk = createBbSdk({
        transport: createHttpTransport({
          baseUrl: "http://bb.test",
          runtime: "node",
          fetch: async () => new Response("404 Not Found", { status: 404 }),
        }),
      });
      const error: unknown = await sdk.plugins[member]({
        pluginId: "notes",
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(PluginRollbackUnsupportedError);
      expect(error).toMatchObject({
        pluginId: "notes",
        message:
          "Rollback not started; this BB server predates plugin rollback. Upgrade the BB server to roll back an update",
      });
    },
  );
});
