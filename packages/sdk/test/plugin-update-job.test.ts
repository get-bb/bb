import { describe, expect, it } from "vitest";
import { createBbSdk } from "../src/core.js";
import { createHttpTransport } from "../src/transport-http.js";

const base = { id: "update-1", pluginId: "notes", displayName: "Notes" };
const result = {
  applied: true,
  from: { version: "1.0.0", display: "1.0.0" },
  to: { version: "1.1.0", display: "1.1.0" },
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
