import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { z } from "zod";
import type { Endpoint } from "../src/endpoint.js";
import {
  defineRoute,
  jsonResponse,
  jsonRequest,
  noRequest,
  textResponse,
  optionalQueryRequest,
  typedRoutes,
  type ApiSchemaFromRouteDescriptors,
} from "../src/index.js";

type TestSchema = {
  "/search": {
    $get: Endpoint<{ query: { q: string } }, { q: string }>;
  };
  "/ping": {
    $get: Endpoint<{}, { ok: true }>;
  };
};

const testRoutes = {
  search: defineRoute({
    path: "/search",
    method: "get",
    request: optionalQueryRequest<Record<never, never>, { q: string }>(
      z.object({ q: z.string().min(1) }),
    ),
    response: jsonResponse<{ q: string }>(),
  }),
};

type DescriptorTestSchema = ApiSchemaFromRouteDescriptors<typeof testRoutes>;

function createApp() {
  const app = new Hono();
  app.onError((error, context) => {
    return context.json({ message: error.message }, 400);
  });
  return app;
}

describe("typedRoutes", () => {
  it("parses GET query inputs instead of requiring a JSON body", async () => {
    const app = createApp();
    const { get } = typedRoutes<TestSchema>(app, {
      onValidationError: (message) => new Error(message),
    });

    get("/search", z.object({ q: z.string().min(1) }), (context, query) =>
      context.json({ q: query.q }),
    );

    const success = await app.request("/search?q=needle");
    expect(success.status).toBe(200);
    expect(await success.json()).toEqual({ q: "needle" });

    const missingQuery = await app.request("/search", { method: "GET" });
    expect(missingQuery.status).toBe(400);
    expect(await missingQuery.json()).toEqual({ message: "Required" });
  });

  it("supports GET handlers with no query schema", async () => {
    const app = createApp();
    const { get } = typedRoutes<TestSchema>(app, {
      onValidationError: (message) => new Error(message),
    });

    get("/ping", (context) => context.json({ ok: true }));

    const response = await app.request("/ping");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("registers descriptor routes with their request schema", async () => {
    const app = createApp();
    const { get } = typedRoutes<DescriptorTestSchema>(app, {
      onValidationError: (message) => new Error(message),
    });

    get(testRoutes.search, (context, query) => context.json({ q: query.q }));

    const success = await app.request("/search?q=needle");
    expect(success.status).toBe(200);
    expect(await success.json()).toEqual({ q: "needle" });

    const missingQuery = await app.request("/search", { method: "GET" });
    expect(missingQuery.status).toBe(400);
    expect(await missingQuery.json()).toEqual({ message: "Required" });
  });
});

describe("contract invalidations", () => {
  it("publishes tags from parsed input and successful JSON output without changing the body", async () => {
    const route = defineRoute({
      path: "/items/:id",
      method: "put",
      request: jsonRequest(z.object({ value: z.coerce.number() })),
      response: [
        jsonResponse<{ value: number }>(),
        jsonResponse<{ error: string }>({ status: 409 }),
      ],
      invalidates: ({ params, input }, output) => [
        `item:${params.id}:${input.value}:${output.value}`,
      ],
    });
    const publish = vi.fn();
    const app = createApp();
    const { put } = typedRoutes<ApiSchemaFromRouteDescriptors<typeof route>>(
      app,
      { invalidateTags: publish },
    );
    put(route, (context, input) =>
      input.value < 0
        ? context.json({ error: "conflict" }, 409)
        : context.json({ value: input.value + 1 }),
    );
    for (const [value, status] of [
      ["4", 200],
      ["-1", 409],
      ["invalid", 400],
    ] as const) {
      const response = await app.request("/items/a", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value }),
      });
      expect(response.status).toBe(status);
      if (status === 200) {
        expect(await response.json()).toEqual({ value: 5 });
      }
    }
    expect(publish).toHaveBeenCalledExactlyOnceWith(["item:a:4:5"]);
  });

  it("requires a publisher for declared writes and skips non-JSON responses", async () => {
    const route = defineRoute({
      path: "/write",
      method: "post",
      request: noRequest(),
      response: textResponse<string>(),
      invalidates: () => ["item"],
    });
    const app = createApp();
    type Schema = ApiSchemaFromRouteDescriptors<typeof route>;
    expect(() =>
      typedRoutes<Schema>(app).post(route, (c) => c.text("ok")),
    ).toThrow("no invalidateTags option");
    const publish = vi.fn();
    typedRoutes<Schema>(app, { invalidateTags: publish }).post(route, (c) =>
      c.text("ok"),
    );
    const response = await app.request("/write", { method: "POST" });
    expect(await response.text()).toBe("ok");
    expect(publish).not.toHaveBeenCalled();
  });
});
