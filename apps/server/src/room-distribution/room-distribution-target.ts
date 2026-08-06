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
const BINDING_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * Conservative opaque cursor grammar for URL-safe raw query values.
 * Do not decode or reserialize; validate the exact characters after `cursor=`.
 */
const CURSOR_PATTERN = /^[A-Za-z0-9._~:%+-]{1,512}$/u;

const OPERATIONS = ["bootstrap", "commands", "events", "subscribe"] as const;

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
};

export type RoomDistributionSubscribeTarget = {
  readonly bindingId: string;
  readonly operation: "subscribe";
  readonly method: "GET";
  readonly transport: "websocket";
  readonly cursor: string | null;
};

export type RoomDistributionTargetDescriptor =
  | RoomDistributionBootstrapTarget
  | RoomDistributionCommandsTarget
  | RoomDistributionEventsTarget
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

function parseCursorQuery(query: string): string {
  // Exactly one field: cursor=<raw>. No extra keys, duplicates, or empty value.
  if (!query.startsWith("cursor=")) {
    reject();
  }
  if (query.includes("&")) {
    reject();
  }
  const raw = query.slice("cursor=".length);
  if (!CURSOR_PATTERN.test(raw)) {
    reject();
  }
  return raw;
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
      const cursor = query === null ? null : parseCursorQuery(query);
      return Object.freeze({
        bindingId,
        operation: "events",
        method: "GET",
        transport: "http",
        cursor,
      });
    }
    case "subscribe": {
      if (method !== "GET" || transport !== "websocket") {
        reject();
      }
      const cursor = query === null ? null : parseCursorQuery(query);
      return Object.freeze({
        bindingId,
        operation: "subscribe",
        method: "GET",
        transport: "websocket",
        cursor,
      });
    }
    default: {
      const _exhaustive: never = operation;
      void _exhaustive;
      reject();
    }
  }
}
