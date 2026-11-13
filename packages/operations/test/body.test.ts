import { describe, expect, it } from "vitest";
import {
  bytesBody,
  emptyBody,
  isOperationBody,
  jsonBody,
  operationBodyFromResponse,
  operationBodyResponse,
  readOperationBody,
  streamBody,
} from "../src/index.js";

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new Response(text).body ?? new ReadableStream();
}

describe("operation bodies", () => {
  it("recognizes bodies structurally, including spread copies, and nothing else", () => {
    const body = bytesBody(new Uint8Array([1]), {
      contentType: "image/png",
      headers: { "Cache-Control": "no-store", "Content-Type": "ignored" },
    });
    expect(body.headers).toEqual({ "cache-control": "no-store" });
    expect(isOperationBody(body)).toBe(true);
    expect(isOperationBody({ ...body, headers: { "x-a": "1" } })).toBe(true);
    expect(isOperationBody({ ...body, bytes: "not bytes" })).toBe(false);
    expect(isOperationBody({ body: "bytes", status: 200 })).toBe(false);
    expect(isOperationBody({ ok: true, body: "stream" })).toBe(false);
    expect(isOperationBody(new Response("x"))).toBe(false);
  });

  it("serializes status, content type, headers and a fresh content length", async () => {
    const rewritten = {
      ...bytesBody(new TextEncoder().encode("hi"), {
        headers: { "content-length": "99" },
      }),
      contentType: "text/plain",
    };
    const response = operationBodyResponse(rewritten);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(response.headers.get("content-length")).toBe("2");
    expect(await response.text()).toBe("hi");
  });

  it("sends no body for null-body statuses and keeps a HEAD length", async () => {
    const notModified = operationBodyResponse(
      emptyBody(304, { headers: { etag: '"a"' } }),
    );
    expect(notModified.status).toBe(304);
    expect(notModified.body).toBeNull();
    expect(notModified.headers.get("etag")).toBe('"a"');
    const head = operationBodyResponse(
      emptyBody(200, { headers: { "content-length": "42" } }),
    );
    expect(head.headers.get("content-length")).toBe("42");
    const noContent = operationBodyResponse(
      streamBody(streamOf("dropped"), { status: 204 }),
    );
    expect(noContent.body).toBeNull();
  });

  it("encodes JSON with its status and decodes a response back into a stream body", async () => {
    const accepted = operationBodyResponse(
      jsonBody({ job: { id: "j1" } }, { status: 202 }),
    );
    expect(accepted.status).toBe(202);
    expect(accepted.headers.get("content-type")).toBe("application/json");
    const decoded = operationBodyFromResponse(accepted);
    expect(decoded).toMatchObject({
      body: "stream",
      status: 202,
      contentType: "application/json",
    });
    expect(
      JSON.parse(new TextDecoder().decode(await readOperationBody(decoded))),
    ).toEqual({ job: { id: "j1" } });
    expect(
      operationBodyFromResponse(new Response(null, { status: 204 })),
    ).toMatchObject({ body: "bytes", status: 204, bytes: new Uint8Array(0) });
  });
});
