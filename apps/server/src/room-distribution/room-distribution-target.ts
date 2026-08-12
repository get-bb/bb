/**
 * Strict parser for internal Work Together Room distribution request targets.
 *
 * Accepts only the closed set of origin-form Room loopback routes after the
 * shared v1 internal target canonicalizer. Errors never echo target, cursor,
 * or binding id.
 */

import { canonicalizeInternalRequestTarget } from "@bb/server-contract";

const PATH_PREFIX = "/api/bb-rooms/v1/rooms/";

/** Canonical lowercase UUID segment (any version), no braces. */
const UUID_FRAGMENT =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const BINDING_ID_PATTERN = new RegExp(`^${UUID_FRAGMENT}$`, "u");

/**
 * Conservative opaque cursor grammar for URL-safe raw query values.
 * Do not decode or reserialize; validate the exact characters after `cursor=`.
 */
const CURSOR_PATTERN = /^[A-Za-z0-9._~:%+-]{1,512}$/u;
const CHILD_QUERY_PATTERN = new RegExp(
  `^child=(${UUID_FRAGMENT})(?:&cursor=([A-Za-z0-9._~:%+-]{1,512}))?$`,
  "u",
);
/** Public older-page cursor: sequence-only `p.<positive integer>`. */
const OLDER_BEFORE_QUERY_PATTERN = /^before=(p\.(?:[1-9][0-9]{0,15}))$/u;

const OPERATIONS = [
  "bootstrap",
  "commands",
  "events",
  "timeline",
  "subscribe",
] as const;

export type RoomDistributionOperation = (typeof OPERATIONS)[number];

export type RoomDistributionTargetInput = {
  readonly method: string;
  readonly transport: string;
  readonly target: string;
};

export type RoomDistributionBootstrapTarget = {
  readonly bindingId: string;
  readonly operation: "bootstrap";
  readonly method: "GET";
  readonly transport: "http";
  readonly cursor: null;
};

export type RoomDistributionCommandsTarget = {
  readonly bindingId: string;
  readonly operation: "commands";
  readonly method: "POST";
  readonly transport: "http";
  readonly cursor: null;
};

export type RoomDistributionEventsTarget = {
  readonly bindingId: string;
  readonly operation: "events";
  readonly method: "GET";
  readonly transport: "http";
  readonly cursor: string | null;
  readonly childAttachmentId: string | null;
};

/**
 * Older sanitized Room page. Requires exactly `before=p.<positive sequence>`.
 * Authorized under the existing events read authority; primary stream only.
 */
export type RoomDistributionTimelineTarget = {
  readonly bindingId: string;
  readonly operation: "timeline";
  readonly method: "GET";
  readonly transport: "http";
  readonly before: string;
};

export type RoomDistributionSubscribeTarget = {
  readonly bindingId: string;
  readonly operation: "subscribe";
  readonly method: "GET";
  readonly transport: "websocket";
  readonly cursor: string | null;
  readonly childAttachmentId: string | null;
};

export type RoomDistributionTargetDescriptor =
  | RoomDistributionBootstrapTarget
  | RoomDistributionCommandsTarget
  | RoomDistributionEventsTarget
  | RoomDistributionTimelineTarget
  | RoomDistributionSubscribeTarget;

/**
 * Generic rejection for any non-accepted Room distribution target.
 * Fixed message and code; never echoes target, cursor, or id.
 */
export class InvalidRoomDistributionTargetError extends Error {
  readonly code = "invalid_room_distribution_target" as const;

  constructor() {
    super("Invalid room distribution target");
    this.name = "InvalidRoomDistributionTargetError";
  }
}

function reject(): never {
  throw new InvalidRoomDistributionTargetError();
}

function isOperation(value: string): value is RoomDistributionOperation {
  return (OPERATIONS as readonly string[]).includes(value);
}

function parseStreamQuery(query: string | null): Readonly<{
  childAttachmentId: string | null;
  cursor: string | null;
}> {
  if (query === null) {
    return Object.freeze({ childAttachmentId: null, cursor: null });
  }
  if (query.startsWith("cursor=")) {
    const raw = query.slice("cursor=".length);
    if (query.includes("&") || !CURSOR_PATTERN.test(raw)) reject();
    return Object.freeze({ childAttachmentId: null, cursor: raw });
  }
  const child = CHILD_QUERY_PATTERN.exec(query);
  if (child === null) reject();
  return Object.freeze({
    childAttachmentId: child[1] ?? null,
    cursor: child[2] ?? null,
  });
}

/**
 * Parse a method + transport + origin-form target into a frozen Room
 * distribution descriptor, or throw {@link InvalidRoomDistributionTargetError}.
 */
export function parseRoomDistributionTarget(
  input: RoomDistributionTargetInput,
): RoomDistributionTargetDescriptor {
  if (input === null || typeof input !== "object") {
    reject();
  }
  const { method, transport, target } = input;
  if (
    typeof method !== "string" ||
    typeof transport !== "string" ||
    typeof target !== "string"
  ) {
    reject();
  }

  let canonical: string;
  try {
    canonical = canonicalizeInternalRequestTarget(target);
  } catch {
    reject();
  }
  if (canonical !== target) {
    reject();
  }

  const queryStart = target.indexOf("?");
  const path = queryStart === -1 ? target : target.slice(0, queryStart);
  const query = queryStart === -1 ? null : target.slice(queryStart + 1);

  if (!path.startsWith(PATH_PREFIX)) {
    reject();
  }

  const remainder = path.slice(PATH_PREFIX.length);
  const slash = remainder.indexOf("/");
  if (slash === -1) {
    reject();
  }

  const bindingId = remainder.slice(0, slash);
  const operation = remainder.slice(slash + 1);

  if (!BINDING_ID_PATTERN.test(bindingId)) {
    reject();
  }
  if (!isOperation(operation)) {
    // Extra segments, trailing slash (empty op or nested), or unknown op.
    reject();
  }

  switch (operation) {
    case "bootstrap": {
      if (method !== "GET" || transport !== "http" || query !== null) {
        reject();
      }
      return Object.freeze({
        bindingId,
        operation: "bootstrap",
        method: "GET",
        transport: "http",
        cursor: null,
      });
    }
    case "commands": {
      if (method !== "POST" || transport !== "http" || query !== null) {
        reject();
      }
      return Object.freeze({
        bindingId,
        operation: "commands",
        method: "POST",
        transport: "http",
        cursor: null,
      });
    }
    case "events": {
      if (method !== "GET" || transport !== "http") {
        reject();
      }
      const stream = parseStreamQuery(query);
      return Object.freeze({
        bindingId,
        operation: "events",
        method: "GET",
        transport: "http",
        ...stream,
      });
    }
    case "timeline": {
      if (method !== "GET" || transport !== "http" || query === null) {
        reject();
      }
      const older = OLDER_BEFORE_QUERY_PATTERN.exec(query);
      if (older === null) {
        reject();
      }
      return Object.freeze({
        bindingId,
        operation: "timeline",
        method: "GET",
        transport: "http",
        before: older[1] ?? reject(),
      });
    }
    case "subscribe": {
      if (method !== "GET" || transport !== "websocket") {
        reject();
      }
      const stream = parseStreamQuery(query);
      return Object.freeze({
        bindingId,
        operation: "subscribe",
        method: "GET",
        transport: "websocket",
        ...stream,
      });
    }
    default: {
      const _exhaustive: never = operation;
      void _exhaustive;
      reject();
    }
  }
}
