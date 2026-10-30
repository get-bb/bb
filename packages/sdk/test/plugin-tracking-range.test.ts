import { describe, expect, it } from "vitest";
import { createBbSdk } from "../src/core.js";
import { BbHttpError } from "../src/response.js";
import { createHttpTransport } from "../src/transport-http.js";

const result = {
  applied: false,
  previousRange: "^0.1.0",
  range: ">=0.1.0 <1.0.0",
  openEnded: false,
  check: {
    id: "notes",
    outcome: "update-available",
    installed: {
      version: "a".repeat(40),
      label: "0.1.0",
      display: "repo@v0.1.0",
    },
    candidate: {
      version: "b".repeat(40),
      label: "0.2.0",
      display: "repo@v0.2.0",
    },
  },
};

function server(response: () => Response) {
  const requests: { method: string; path: string; body: unknown }[] = [];
  const sdk = createBbSdk({
    transport: createHttpTransport({
      baseUrl: "http://bb.test",
      runtime: "node",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push({
          method: request.method,
          path: new URL(request.url).pathname,
          body: await request.json(),
        });
        return response();
      },
    }),
  });
  return { sdk, requests };
}

describe("plugin tracking range", () => {
  it("posts the range and dry-run flag and returns the parsed result", async () => {
    const { sdk, requests } = server(() => Response.json(result));

    await expect(
      sdk.plugins.experimental_setTrackingRange({
        pluginId: "notes",
        range: ">=0.1.0 <1.0.0",
        dryRun: true,
      }),
    ).resolves.toEqual(result);
    await sdk.plugins.experimental_setTrackingRange({
      pluginId: "notes",
      range: "^0.2.0",
    });

    expect(requests).toEqual([
      {
        method: "POST",
        path: "/api/v1/plugins/notes/tracking-range",
        body: { range: ">=0.1.0 <1.0.0", dryRun: true },
      },
      {
        method: "POST",
        path: "/api/v1/plugins/notes/tracking-range",
        body: { range: "^0.2.0" },
      },
    ]);
  });

  it("surfaces the server's refusal", async () => {
    const { sdk } = server(() =>
      Response.json(
        {
          error:
            '"1.2.3" names a version, not a range; use a range like ^1.2.3',
        },
        { status: 422 },
      ),
    );

    const refusal = sdk.plugins.experimental_setTrackingRange({
      pluginId: "notes",
      range: "1.2.3",
    });
    await expect(refusal).rejects.toBeInstanceOf(BbHttpError);
    await expect(refusal).rejects.toThrow("use a range like ^1.2.3");
  });

  it("refuses an empty range without a request", async () => {
    const { sdk, requests } = server(() => Response.json(result));

    await expect(
      sdk.plugins.experimental_setTrackingRange({
        pluginId: "notes",
        range: "",
      }),
    ).rejects.toThrow();
    expect(requests).toEqual([]);
  });
});
