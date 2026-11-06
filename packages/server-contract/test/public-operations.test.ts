import { emptyBody, jsonBody } from "@bb/operations";
import { describe, expect, it } from "vitest";
import {
  publicApiRoutes,
  publicOperation,
  routeInputFromRequest,
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
    expect(routeRequestFromInput(route, input)).toEqual({ json: [] });
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
      routeRequestFromInput(route, { id: "thr_path", title: "Renamed" }),
    ).toEqual({ param: { id: "thr_path" }, json: { title: "Renamed" } });
  });

  it("declares kinds per operation, including POST reads", () => {
    expect(publicOperation("threads.ancestors").kind).toBe("read");
    expect(publicOperation("files.read").kind).toBe("read");
    expect(publicOperation("threads.read").kind).toBe("write");
    expect(publicOperation("threads.list").kind).toBe("read");
  });

  it("checks outputs against the route's schema", () => {
    const remove = publicOperation("threads.delete");
    expect(remove.checkOutput?.({ ok: true })).toBeNull();
    expect(remove.checkOutput?.({ ok: false })).toMatch(/^ok: /);
    const exported = publicOperation("server.export");
    expect(exported.checkOutput?.(emptyBody(200))).toBeNull();
    expect(exported.checkOutput?.(new Uint8Array(1))).toMatch(
      /^expected an operation body/,
    );
    expect(
      remove.checkOutput?.(jsonBody({ ok: true }, { status: 202 })),
    ).toBeNull();
  });
});
