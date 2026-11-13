import { Hono } from "hono";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  defineRoute,
  jsonRequest,
  jsonResponse,
  mountRoute,
  queryRequest,
  type RouteCallInput,
  type RouteOperationInput,
  type RouteParams,
} from "../src/index.js";

const update = defineRoute({
  path: "/items/:id",
  method: "patch",
  request: jsonRequest(
    z.object({ name: z.string(), pinned: z.boolean().default(false) }),
  ),
  response: jsonResponse<{ id: string; pinned: boolean }>({ status: 201 }),
});

const search = defineRoute({
  path: "/items",
  method: "get",
  request: queryRequest(z.object({ q: z.string().min(1) })),
  response: jsonResponse<{ q: string }>(),
});

describe("route types", () => {
  it("reads parameter names from the path, including multi-segment ones", () => {
    expectTypeOf<
      RouteParams<"/threads/:id/files/:filePath{.+}">
    >().toEqualTypeOf<{ id: string; filePath: string }>();
    expectTypeOf<RouteParams<"/system/config">>().toEqualTypeOf<{}>();
  });

  it("types callers with the schema's input and the server with its output", () => {
    expectTypeOf<RouteCallInput<typeof update>>().toEqualTypeOf<
      { id: string } & { name: string; pinned?: boolean | undefined }
    >();
    expectTypeOf<RouteOperationInput<typeof update>>().toEqualTypeOf<
      { id: string } & { name: string; pinned: boolean }
    >();
  });
});

describe("mountRoute", () => {
  function app() {
    const hono = new Hono();
    hono.onError((error, context) =>
      context.json({ message: error.message }, 400),
    );
    const options = { invalidRequest: (message: string) => new Error(message) };
    mountRoute(
      hono,
      update,
      (context, body) => ({
        id: context.req.param("id"),
        pinned: body.pinned,
      }),
      options,
    );
    mountRoute(hono, search, (_context, query) => ({ q: query.q }), options);
    return hono;
  }

  it("parses the body or query with the route's schema and answers with its status", async () => {
    const patched = await app().request("/items/it_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });
    expect(patched.status).toBe(201);
    expect(await patched.json()).toEqual({ id: "it_1", pinned: false });
    const found = await app().request("/items?q=needle");
    expect(await found.json()).toEqual({ q: "needle" });
  });

  it("turns unparsable or invalid input into the caller's invalid-request error", async () => {
    const notJson = await app().request("/items/it_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(await notJson.json()).toEqual({
      message: "Invalid JSON request body",
    });
    const missing = await app().request("/items");
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ message: "Required" });
  });
});
