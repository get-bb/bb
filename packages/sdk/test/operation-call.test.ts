import { describe, expect, it } from "vitest";
import { createOperationCaller } from "../src/operation-call.js";
import { createHttpTransport } from "../src/transport-http.js";

interface Recorded {
  method: string;
  url: string;
  body: unknown;
}

function recorder(respond: () => Response = () => Response.json({ ok: true })) {
  const requests: Recorded[] = [];
  const transport = createHttpTransport({
    baseUrl: "http://bb.test",
    runtime: "node",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const text = await request.text();
      requests.push({
        method: request.method,
        url: request.url,
        body: text.length === 0 ? null : JSON.parse(text),
      });
      return respond();
    },
  });
  return { requests, ...createOperationCaller(transport) };
}

describe("operation caller", () => {
  it("splits a flat input into path params, query and body like the typed client", async () => {
    const { requests, call, send } = recorder();
    await call("projects.branches", {
      id: "proj 1",
      hostId: "host_1",
      query: "main",
    });
    await call("projects.update", { id: "proj_1", name: "Renamed" });
    await send("projects.deleteSource", { id: "proj_1", sourceId: "src_1" });
    await send("plugins.remove", { id: "demo/widget" });
    await call("filePreviews.content", { id: "prev 1", filePath: "a b/c.txt" });
    await call("system.keyboardSettings", {
      overrides: [
        {
          command: "composer.focus",
          shortcut: {
            key: "k",
            mod: true,
            meta: false,
            control: false,
            alt: false,
            shift: false,
          },
        },
      ],
    });
    expect(requests).toEqual([
      {
        method: "GET",
        url: "http://bb.test/api/v1/projects/proj%201/branches?hostId=host_1&query=main",
        body: null,
      },
      {
        method: "PATCH",
        url: "http://bb.test/api/v1/projects/proj_1",
        body: { name: "Renamed" },
      },
      {
        method: "DELETE",
        url: "http://bb.test/api/v1/projects/proj_1/sources/src_1",
        body: null,
      },
      {
        method: "DELETE",
        url: "http://bb.test/api/v1/plugins/demo%2Fwidget",
        body: null,
      },
      {
        method: "GET",
        url: "http://bb.test/api/v1/file-previews/prev%201/a%20b/c.txt",
        body: null,
      },
      {
        method: "PUT",
        url: "http://bb.test/api/v1/settings/keyboard",
        body: [
          {
            command: "composer.focus",
            shortcut: {
              key: "k",
              mod: true,
              meta: false,
              control: false,
              alt: false,
              shift: false,
            },
          },
        ],
      },
    ]);
  });

  it("returns JSON, null for a 204 and a body for a byte route", async () => {
    expect(
      await recorder(() => Response.json({ id: "proj_1" })).call(
        "projects.get",
        { id: "proj_1" },
      ),
    ).toEqual({ id: "proj_1" });
    expect(
      await recorder(() => new Response(null, { status: 204 })).call(
        "threads.eventWait",
        { id: "thr_1", type: "turn.completed" },
      ),
    ).toBeNull();
    const body = await recorder(
      () =>
        new Response("bytes", { headers: { "content-type": "text/plain" } }),
    ).call("server.export", {});
    expect(body).toMatchObject({ body: "stream", contentType: "text/plain" });
  });

  it("raises the server's error like the rest of the SDK", async () => {
    const { call } = recorder(() =>
      Response.json(
        { code: "project_not_found", message: "Project not found" },
        { status: 404 },
      ),
    );
    await expect(call("projects.get", { id: "proj_x" })).rejects.toThrow(
      "Project not found",
    );
  });
});
