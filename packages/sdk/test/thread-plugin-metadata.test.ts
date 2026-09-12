import type { JsonObject } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { createBbSdk } from "../src/core.js";
import type { FetchImplementation } from "../src/response.js";
import { createHttpTransport } from "../src/transport-http.js";

interface RecordedRequest {
  url: string;
  method: string | undefined;
  body: unknown;
}

function createRecordingSdk() {
  const requests: RecordedRequest[] = [];
  const fetch = vi.fn<FetchImplementation>(async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return Response.json({ ok: true });
  });
  const sdk = createBbSdk({
    transport: createHttpTransport({
      baseUrl: "http://bb.test",
      fetch,
      runtime: "node",
    }),
  });
  return { fetch, requests, sdk };
}

describe("thread plugin metadata transport", () => {
  it("serializes the exact GET query and PATCH body", async () => {
    const { requests, sdk } = createRecordingSdk();

    await sdk.threads.getPluginMetadata({ threadId: "t", pluginId: "p" });
    await sdk.threads.updatePluginMetadata({
      threadId: "t",
      pluginId: "p",
      set: { nested: { value: 1 } },
      remove: ["old"],
    });

    expect(requests).toEqual([
      {
        url: "http://bb.test/api/v1/threads/t/plugin-metadata?pluginId=p",
        method: "GET",
        body: undefined,
      },
      {
        url: "http://bb.test/api/v1/threads/t/plugin-metadata",
        method: "PATCH",
        body: { pluginId: "p", set: { nested: { value: 1 } }, remove: ["old"] },
      },
    ]);
  });

  it("rejects a cyclic set through the returned promise without a request", async () => {
    const { fetch, sdk } = createRecordingSdk();
    const cyclic: JsonObject = {};
    cyclic.self = cyclic;

    const error = await sdk.threads
      .updatePluginMetadata({ threadId: "t", pluginId: "p", set: cyclic })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).toHaveProperty("message", "pluginMetadata contains a cycle");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a NaN set through the returned promise without a request", async () => {
    const { fetch, sdk } = createRecordingSdk();

    await expect(
      sdk.threads.updatePluginMetadata({
        threadId: "t",
        pluginId: "p",
        set: { count: Number.NaN },
      }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
