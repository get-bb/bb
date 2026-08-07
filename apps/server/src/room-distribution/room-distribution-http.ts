import { bodyLimit } from "hono/body-limit";
import type { Context, Hono } from "hono";

import { issueRoomDistributionAuthorization } from "../auth/room-distribution-authorization.js";
import { ApiError } from "../errors.js";
import {
  authorize,
  readPrincipalRequestTarget,
  requirePrincipal,
} from "../request-context.js";
import {
  RoomDistributionUnavailableError,
  type RoomDistributionContextV1,
  type RoomJsonObject,
  type WorkTogetherRoomDistributionV1,
} from "./room-distribution-port.js";
import {
  InvalidRoomDistributionTargetError,
  parseRoomDistributionTarget,
} from "./room-distribution-target.js";

const COMMAND_BODY_LIMIT_BYTES = 131_072;
const COMMAND_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/iu;
const FORBIDDEN_COMMAND_KEY_TOKENS = new Set([
  "actor",
  "actorid",
  "author",
  "authorid",
  "principal",
  "principalid",
  "userid",
]);
const MAX_COMMAND_NESTING_DEPTH = 32;

function notFound(): never {
  throw new ApiError(404, "not_found", "Not found");
}

function unavailable(): never {
  throw new ApiError(503, "service_unavailable", "Service unavailable", true);
}

function invalidRequest(): never {
  throw new ApiError(400, "invalid_request", "Invalid request");
}

function isRoomJsonObject(value: unknown): value is RoomJsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertCommandValue(value: unknown, depth = 0): void {
  if (depth > MAX_COMMAND_NESTING_DEPTH) invalidRequest();
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalidRequest();
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertCommandValue(item, depth + 1);
    return;
  }
  if (!isRoomJsonObject(value)) invalidRequest();
  for (const [key, item] of Object.entries(value)) {
    const token = key.toLowerCase().replaceAll(/[-_]/gu, "");
    if (FORBIDDEN_COMMAND_KEY_TOKENS.has(token)) invalidRequest();
    assertCommandValue(item, depth + 1);
  }
}

async function readCommand(context: Context): Promise<RoomJsonObject> {
  const contentType = context.req.header("content-type");
  if (!contentType || !COMMAND_CONTENT_TYPE.test(contentType)) {
    throw new ApiError(415, "invalid_request", "Invalid request");
  }
  const body = await context.req.json().catch(() => invalidRequest());
  if (!isRoomJsonObject(body)) invalidRequest();
  assertCommandValue(body);
  return Object.freeze({ ...body });
}

async function createContext(
  honoContext: object,
  bindingId: string,
): Promise<RoomDistributionContextV1> {
  const principal = requirePrincipal(honoContext);
  return Object.freeze({
    bindingId,
    principal,
    authorize: async (
      operation: Parameters<RoomDistributionContextV1["authorize"]>[0],
    ) => {
      const pair = issueRoomDistributionAuthorization({ bindingId, operation });
      return authorize(honoContext, pair.action, pair.resource);
    },
  });
}

async function requireOperation(
  context: RoomDistributionContextV1,
  operation: Parameters<RoomDistributionContextV1["authorize"]>[0],
): Promise<void> {
  const decision = await context.authorize(operation);
  if (!decision.allowed) notFound();
}

async function mapFailure<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof InvalidRoomDistributionTargetError) notFound();
    if (error instanceof RoomDistributionUnavailableError) {
      if (error.kind === "not_found") notFound();
      unavailable();
    }
    unavailable();
  }
}

/** Register the three exact HTTP methods of the closed Room distribution. */
export function registerRoomDistributionHttpRoutes(
  app: Hono,
  distribution: WorkTogetherRoomDistributionV1,
): void {
  app.get("/api/bb-rooms/v1/rooms/:bindingId/bootstrap", async (context) =>
    mapFailure(async () => {
      const target = parseRoomDistributionTarget({
        method: context.req.method,
        target: readPrincipalRequestTarget(context),
        transport: "http",
      });
      if (target.operation !== "bootstrap") notFound();
      const room = await createContext(context, target.bindingId);
      await requireOperation(room, "bootstrap");
      const body = await distribution.bootstrap(room);
      context.header("cache-control", "no-store");
      return context.json(body, 200);
    }),
  );

  app.post(
    "/api/bb-rooms/v1/rooms/:bindingId/commands",
    bodyLimit({
      maxSize: COMMAND_BODY_LIMIT_BYTES,
      onError: (context) => context.json({ code: "body_too_large" }, 413),
    }),
    async (context) =>
      mapFailure(async () => {
        const target = parseRoomDistributionTarget({
          method: context.req.method,
          target: readPrincipalRequestTarget(context),
          transport: "http",
        });
        if (target.operation !== "commands") notFound();
        const room = await createContext(context, target.bindingId);
        await requireOperation(room, "commands");
        const command = await readCommand(context);
        const result = await distribution.execute(room, command);
        context.header("cache-control", "no-store");
        return context.json(result.body, result.status);
      }),
  );

  app.get("/api/bb-rooms/v1/rooms/:bindingId/events", async (context) =>
    mapFailure(async () => {
      const target = parseRoomDistributionTarget({
        method: context.req.method,
        target: readPrincipalRequestTarget(context),
        transport: "http",
      });
      if (target.operation !== "events") notFound();
      const room = await createContext(context, target.bindingId);
      await requireOperation(room, "events");
      const body = await distribution.events(room, {
        childAttachmentId: target.childAttachmentId,
        cursor: target.cursor,
      });
      context.header("cache-control", "no-store");
      return context.json(body, 200);
    }),
  );
}
