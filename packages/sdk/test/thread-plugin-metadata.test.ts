import { describe, expect, it } from "vitest";
import { createBbSdk } from "../src/core.js";
import { createHttpTransport } from "../src/transport-http.js";

describe("thread plugin metadata transport", () => {
  it("serializes exact GET query and PATCH body", async () => {
    const requests: { url: string; method?: string; body?: string }[] = [];
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => { requests.push({ url: String(input), method: init?.method, body: init?.body as string }); return Response.json({ ok: true }); };
    const sdk = createBbSdk({ transport: createHttpTransport({ baseUrl: "http://bb.test", fetch, runtime: "node" }) });
    await sdk.threads.getPluginMetadata({ threadId: "t", pluginId: "p" });
    await sdk.threads.updatePluginMetadata({ threadId: "t", pluginId: "p", set: { nested: { value: 1 } }, remove: ["old"] });
    expect(requests[0]).toMatchObject({ url: "http://bb.test/api/v1/threads/t/plugin-metadata?pluginId=p", method: "GET" });
    expect(JSON.parse(requests[1].body!)).toEqual({ pluginId: "p", set: { nested: { value: 1 } }, remove: ["old"] });
  });
});
