import { describe, expect, it } from "vitest";
import {
  publicApiRoutes,
  publicOperation,
  routeInputFromRequest,
  listPublicApiRoutes,
  publicRouteIndex,
  routeCallShape,
  routeRequestFromInput,
} from "../src/index.js";

describe("public operations", () => {
  it("parses one flat input of path params and body fields", async () => {
    const send = publicOperation("threads.send");
    const parsed = await send.parse({
      id: "thr_1",
      input: [{ type: "text", text: "hi" }],
      mode: "auto",
    });
    expect(parsed).toMatchObject({ id: "thr_1", mode: "auto" });
    await expect(
      Promise.resolve().then(() => send.parse({ input: [], mode: "auto" })),
    ).rejects.toMatchObject({
      code: "invalid_input",
      message: "Missing path parameter id",
    });
  });

  it("keeps a non-object body under its named field", async () => {
    const route = publicApiRoutes.system.keyboardSettings;
    const input = routeInputFromRequest(route, { param: {}, body: [] });
    expect(input).toEqual({ overrides: [] });
    expect(routeRequestFromInput(routeCallShape(route), input)).toEqual({
      json: [],
    });
  });

  it("rejects a non-object body with the route schema's own message", () => {
    const route = publicApiRoutes.threads.send;
    const viaSchema = route.request.schema.safeParse("nope");
    expect(viaSchema.success).toBe(false);
    expect(() =>
      routeInputFromRequest(route, { param: { id: "thr_1" }, body: "nope" }),
    ).toThrow(
      expect.objectContaining({ code: "invalid_input" }) as unknown as Error,
    );
  });

  it("lets the path param win over a body field of the same name", () => {
    const route = publicApiRoutes.threads.update;
    expect(
      routeInputFromRequest(route, {
        param: { id: "thr_path" },
        body: { title: "Renamed" },
      }),
    ).toEqual({ id: "thr_path", title: "Renamed" });
    expect(
      routeRequestFromInput(routeCallShape(route), {
        id: "thr_path",
        title: "Renamed",
      }),
    ).toEqual({ param: { id: "thr_path" }, json: { title: "Renamed" } });
  });

  it("names each operation by its route key and carries the route's door", () => {
    expect(publicOperation("threads.send").http).toEqual({
      method: "post",
      path: "/threads/:id/send",
      status: 200,
      headers: {},
    });
    expect(publicOperation("system.mobileAppReleases").http.headers).toEqual({
      "cache-control": "no-store",
    });
  });
});

describe("public route index", () => {
  it("matches the route definitions for every operation", () => {
    const routes = listPublicApiRoutes();
    expect(Object.keys(publicRouteIndex).sort()).toEqual(
      routes.map(({ key }) => key).sort(),
    );
    for (const { key, route } of routes) {
      expect(
        publicRouteIndex[key as keyof typeof publicRouteIndex],
        key,
      ).toEqual(routeCallShape(route));
    }
  });
});
