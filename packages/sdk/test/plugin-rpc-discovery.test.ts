import { expect, it } from "vitest";
import { z } from "zod";
import { createBbSdk } from "../src/core.js";
import { createHttpTransport } from "../src/transport-http.js";

it("discovers published methods with filters and calls using a copied response schema", async () => {
  const requests: string[] = [];
  const sdk = createBbSdk({
    transport: createHttpTransport({
      baseUrl: "http://bb.test",
      runtime: "node",
      fetch: async (input) => {
        const url = String(input);
        requests.push(url);
        return Response.json(
          url.includes("/rpc?")
            ? [
                {
                  pluginId: "pool",
                  displayName: "Pool",
                  method: "usage.v1.get",
                  registrationDescription: "Shared accounts",
                  methodDescription: null,
                  inputSchema: { type: "null" },
                  outputSchema: { type: "object" },
                },
              ]
            : { ok: true, result: { percent: 42 } },
        );
      },
    }),
  });
  const [source] = await sdk.plugins.experimental_discoverRpc({
    pluginId: "pool",
    method: "usage.v1.get",
  });
  expect(source?.registrationDescription).toBe("Shared accounts");
  expect(requests[0]).toContain("pluginId=pool&method=usage.v1.get");
  await expect(
    sdk.plugins.callRpc({
      pluginId: "pool",
      method: "usage.v1.get",
      input: null,
      outputSchema: z.object({ percent: z.number() }),
    }),
  ).resolves.toEqual({ percent: 42 });
  await expect(
    sdk.plugins.callRpc({
      pluginId: "pool",
      method: "usage.v1.get",
      input: null,
      outputSchema: z.object({ percent: z.string() }),
    }),
  ).rejects.toThrow();
});
