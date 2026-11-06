import {
  defineRoute,
  jsonRequest,
  jsonResponse,
  queryRequest,
} from "@bb/hono-typed-routes";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createPublicOperations,
  publicApiRoutes,
  publicOperationNames,
  publicOperations,
  type OperationNameTable,
} from "../src/index.js";

const { threadSections, ...otherGroups } = publicApiRoutes;
const { list, ...otherSectionRoutes } = threadSections;
const renamedRoutes = {
  ...otherGroups,
  threadSections: { ...otherSectionRoutes, listAll: list },
};
const { "threadSections.list": listName, ...otherNames } = publicOperationNames;
const renamedNames = {
  ...otherNames,
  "threadSections.listAll": listName,
} satisfies OperationNameTable<typeof renamedRoutes>;

// @ts-expect-error
const missingEntry: OperationNameTable<typeof renamedRoutes> =
  publicOperationNames;

const extraEntry = {
  ...publicOperationNames,
  // @ts-expect-error
  "threads.noSuchRoute": "threads.noSuchRoute",
} satisfies OperationNameTable<typeof publicApiRoutes>;

describe("operation names", () => {
  it("names every core route from the frozen table", () => {
    expect(publicOperations().size).toBe(
      Object.keys(publicOperationNames).length,
    );
    expect(missingEntry).toBe(publicOperationNames);
    expect(Object.keys(extraEntry)).toContain("threads.noSuchRoute");
  });

  it("keeps the operation name when a route key is renamed", () => {
    const { operations } = createPublicOperations(renamedRoutes, renamedNames);
    const operation = operations.get("threadSections.list");
    expect(operation?.doors.http).toEqual({
      method: "get",
      path: "/thread-sections",
      status: 200,
    });
    expect(operations.has("threadSections.listAll")).toBe(false);
    expect(operations.size).toBe(publicOperations().size);
  });

  it("fails to load when a route has no name, a name is missing a route, or two routes share a name", () => {
    expect(() => createPublicOperations(renamedRoutes, otherNames)).toThrow(
      "Route threadSections.listAll has no entry in the operation name table",
    );
    expect(() =>
      createPublicOperations(renamedRoutes, {
        ...renamedNames,
        "threadSections.list": listName,
      }),
    ).toThrow(
      "The operation name table names a missing route threadSections.list",
    );
    expect(() =>
      createPublicOperations(renamedRoutes, {
        ...renamedNames,
        "threadSections.listAll": "threadSections.create",
      }),
    ).toThrow(
      "Operation threadSections.create is named by more than one route",
    );
  });
});

describe("path and field name clashes", () => {
  it("rejects a body field that shares a path parameter's name", () => {
    const routes = {
      things: {
        update: defineRoute({
          path: "/things/:id",
          method: "patch",
          request: jsonRequest<{ param: { id: string } }, { id: string }>(
            z.object({ id: z.string(), title: z.string() }),
          ),
          response: jsonResponse<{ ok: true }>(),
        }),
      },
    };
    expect(() =>
      createPublicOperations(routes, { "things.update": "things.update" }),
    ).toThrow(
      'Operation things.update: path parameter "id" and body field "id" share a name, so its flat input would be ambiguous',
    );
  });

  it("rejects a query field that shares a path parameter's name, through unions and optional wrappers", () => {
    const routes = {
      things: {
        get: defineRoute({
          path: "/things/:thingId",
          method: "get",
          request: queryRequest<{ param: { thingId: string } }, object>(
            z.union([
              z.object({ view: z.string() }),
              z.object({ thingId: z.string().optional() }).partial(),
            ]),
          ),
          response: jsonResponse<{ ok: true }>(),
        }),
      },
    };
    expect(() =>
      createPublicOperations(routes, { "things.get": "things.renamedGet" }),
    ).toThrow(
      'Operation things.renamedGet: path parameter "thingId" and query field "thingId" share a name',
    );
  });
});
