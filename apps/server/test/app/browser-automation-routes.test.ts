import { afterEach, describe, expect, it } from "vitest";
import { defaultExperiments } from "@bb/domain";
import { setExperiments } from "@bb/db";
import { seedThreadFixture } from "../helpers/seed.js";
import { BROWSER_REQUEST_MAX_BYTES } from "../../src/routes/browser.js";
import { startTestServer, type RunningTestServer } from "../helpers/test-app.js";

let server: RunningTestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

function request(path: string, init?: RequestInit) {
  if (server === null) throw new Error("test server missing");
  return fetch(new URL(path, server.baseUrl), {
    ...init,
    headers: { "content-type": "application/json", origin: server.baseUrl, ...init?.headers },
  });
}

function chunkedPost(path: string, chunks: Uint8Array[]): Promise<Response> {
  if (server === null) throw new Error("test server missing");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const init: RequestInit & { duplex: "half" } = {
    body: stream,
    duplex: "half",
    headers: { "content-type": "application/json", origin: server.baseUrl },
    method: "POST",
  };
  return fetch(new URL(path, server.baseUrl), init);
}

describe("Browser automation public routes", () => {
  it("gates before dispatch and enforces trusted caller host consistency", async () => {
    server = await startTestServer();
    const { host, thread } = seedThreadFixture(server);
    const body = { callerHostId: host.id, threadId: thread.id, url: "https://example.test" };
    const disabled = await request("/api/v1/browser/targets", { body: JSON.stringify(body), method: "POST" });
    expect(disabled.status).toBe(404);
    expect(await disabled.json()).toMatchObject({ code: "not_found" });

    setExperiments(server.db, { ...defaultExperiments, browserAutomation: true });
    const wrongHost = await request(`/api/v1/browser/targets?threadId=${thread.id}&callerHostId=host_other`);
    expect(wrongHost.status).toBe(403);
    expect(await wrongHost.json()).toMatchObject({ code: "browser_host_mismatch" });

    const list = await request(`/api/v1/browser/targets?threadId=${thread.id}&callerHostId=${host.id}`);
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ targets: [] });

    const noClient = await request("/api/v1/browser/targets", { body: JSON.stringify(body), method: "POST" });
    expect(noClient.status).toBe(503);
    expect(await noClient.json()).toMatchObject({ code: "browser_client_unavailable" });
  });

  it("rejects declared and chunked oversized POST bodies before Browser dispatch", async () => {
    server = await startTestServer();
    setExperiments(server.db, { ...defaultExperiments, browserAutomation: true });
    const oversized = Buffer.alloc(BROWSER_REQUEST_MAX_BYTES + 1, 32);
    const declared = await request("/api/v1/browser/targets", { body: oversized.toString("utf8"), method: "POST" });
    expect(declared.status).toBe(413);
    expect(await declared.json()).toMatchObject({ code: "payload_too_large" });

    const chunked = await chunkedPost("/api/v1/browser/targets/bt_unknown/commands", [
      oversized.subarray(0, 128 * 1024),
      oversized.subarray(128 * 1024),
    ]);
    expect(chunked.status).toBe(413);
    expect(await chunked.json()).toMatchObject({ code: "payload_too_large" });
  });

  it("rejects unknown public command fields strictly", async () => {
    server = await startTestServer();
    const { host, thread } = seedThreadFixture(server);
    setExperiments(server.db, { ...defaultExperiments, browserAutomation: true });
    const response = await request("/api/v1/browser/targets/bt_unknown/commands", {
      body: JSON.stringify({ callerHostId: host.id, threadId: thread.id, command: { kind: "snapshot" }, ignored: true }),
      method: "POST",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_request" });
  });
});
