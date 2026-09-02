import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

const MAX_CANONICAL_BYTES = 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_SAFE_INTEGER = 2 ** 53 - 1;
const LABEL_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const RAPPID_PATTERN =
  /^rappid:@([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9]+(?:-[a-z0-9]+)*):([0-9a-f]{64})$/u;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:(?:[0-5]\d)\.\d{3}Z$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const rappTranscriptEntrySchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
  })
  .strict();
export type RappTranscriptEntry = z.infer<typeof rappTranscriptEntrySchema>;

const pendingTurnRuntimeSchema = z
  .object({
    idempotency_key: z.string().min(1),
    user_input: z.string().min(1),
    conversation_history: z.array(rappTranscriptEntrySchema),
  })
  .strict();
export type RappPendingTurnRuntime = z.infer<typeof pendingTurnRuntimeSchema>;

const sessionRuntimeSchema = z
  .object({
    provider: z.literal("bb/provider-rapp"),
    provider_thread_id: z.string().min(1),
    remote_session_id: z.string().min(1).nullable(),
    turn_counter: z.number().int().nonnegative().max(MAX_SAFE_INTEGER),
    pending_turn: pendingTurnRuntimeSchema.nullable(),
  })
  .strict();
export type RappSessionRuntime = z.infer<typeof sessionRuntimeSchema>;

function isValidRappid(value: string): boolean {
  const match = RAPPID_PATTERN.exec(value);
  return (
    match !== null &&
    (match[1]?.length ?? 0) <= 39 &&
    (match[2]?.length ?? 0) <= 100
  );
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isValidFixedUtc(value: string): boolean {
  const match = UTC_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59) {
    return false;
  }
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day >= 1 && day <= (daysInMonth[month - 1] ?? 0);
}

const sessionEggSchema = z
  .object({
    schema: z.literal("rapp/1-egg"),
    variant: z.literal("session"),
    rappid: z.string().refine(isValidRappid, "Invalid RAPP/1 rappid"),
    created_utc: z
      .string()
      .refine(isValidFixedUtc, "Invalid RAPP/1 fixed UTC timestamp"),
    contents: z.tuple([]),
    payload: z
      .object({
        runtime: z.string(),
        transcript: z.array(rappTranscriptEntrySchema),
      })
      .strict(),
    sig: z.null(),
  })
  .strict();
export type RappSessionEgg = z.infer<typeof sessionEggSchema>;

function validateString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error("RAPP/1 strings must not contain unpaired surrogates");
      }
      index += 1;
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error("RAPP/1 strings must not contain unpaired surrogates");
    }
  }
}

function encodeCanonical(value: unknown, depth: number): string {
  if (depth > MAX_DEPTH) {
    throw new Error(`RAPP/1 JSON nesting exceeds ${MAX_DEPTH}`);
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("RAPP/1 numbers must be finite");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    validateString(value);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        throw new Error("RAPP/1 arrays must not be sparse");
      }
      items.push(encodeCanonical(value[index], depth + 1));
    }
    return `[${items.join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("RAPP/1 values must be plain JSON objects");
    }
    const members = Object.keys(value)
      .sort()
      .map((key) => {
        validateString(key);
        const member: unknown = Reflect.get(value, key);
        return `${JSON.stringify(key)}:${encodeCanonical(member, depth + 1)}`;
      });
    return `{${members.join(",")}}`;
  }
  throw new Error(`RAPP/1 value is not I-JSON: ${typeof value}`);
}

export function canonicalString(value: unknown): string {
  const encoded = encodeCanonical(value, 1);
  if (Buffer.byteLength(encoded, "utf8") > MAX_CANONICAL_BYTES) {
    throw new Error("RAPP/1 canonical form exceeds 1 MiB");
  }
  return encoded;
}

export function hashValue(space: string, value: unknown): string {
  return createHash("sha256")
    .update(space, "ascii")
    .update("\n", "ascii")
    .update(canonicalString(value), "utf8")
    .digest("hex");
}

export function hashBytes(space: string, value: Uint8Array): string {
  return createHash("sha256")
    .update(space, "ascii")
    .update("\n", "ascii")
    .update(value)
    .digest("hex");
}

function validateIdentityLabel(value: string, maximum: number): void {
  if (
    value.length < 1 ||
    value.length > maximum ||
    !LABEL_PATTERN.test(value)
  ) {
    throw new Error(`Invalid RAPP/1 identity label: ${value}`);
  }
}

export function mintKeylessRappid(
  owner: string,
  slug: string,
  uuidAnchor: string = randomUUID(),
): { rappid: string; uuidAnchor: string } {
  validateIdentityLabel(owner, 39);
  validateIdentityLabel(slug, 100);
  if (!UUID_PATTERN.test(uuidAnchor)) {
    throw new Error("RAPP/1 keyless identity requires an RFC 9562 UUIDv4");
  }
  const bytes = Buffer.from(uuidAnchor.replaceAll("-", ""), "hex");
  const tail = hashBytes("rapp/1:rappid", bytes);
  return {
    rappid: `rappid:@${owner}/${slug}:${tail}`,
    uuidAnchor,
  };
}

export function createSessionEgg(args: {
  rappid: string;
  createdUtc: string;
  runtime: RappSessionRuntime;
  transcript: readonly RappTranscriptEntry[];
}): RappSessionEgg {
  const egg = {
    schema: "rapp/1-egg",
    variant: "session",
    rappid: args.rappid,
    created_utc: args.createdUtc,
    contents: [],
    payload: {
      runtime: canonicalString(args.runtime),
      transcript: args.transcript.map((entry) => ({ ...entry })),
    },
    sig: null,
  };
  return sessionEggSchema.parse(egg);
}

export function sessionEggAddress(egg: RappSessionEgg): string {
  return hashValue("rapp/1:egg-manifest", {
    schema: egg.schema,
    variant: egg.variant,
    rappid: egg.rappid,
    created_utc: egg.created_utc,
    contents: egg.contents,
    payload: egg.payload,
  });
}

export function serializeSessionEgg(egg: RappSessionEgg): string {
  return canonicalString(sessionEggSchema.parse(egg));
}

export function parseSessionEgg(
  bytes: Uint8Array,
  expectedRappid?: string,
): {
  egg: RappSessionEgg;
  runtime: RappSessionRuntime;
  eggAddress: string;
} {
  if (bytes.byteLength > MAX_CANONICAL_BYTES) {
    throw new Error("RAPP/1 session egg exceeds 1 MiB");
  }
  const text = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(bytes);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Invalid RAPP/1 session egg JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const egg = sessionEggSchema.parse(parsedJson);
  const serialized = serializeSessionEgg(egg);
  if (!Buffer.from(bytes).equals(Buffer.from(serialized, "utf8"))) {
    throw new Error("RAPP/1 session egg is not canonical JSON");
  }
  if (expectedRappid !== undefined && egg.rappid !== expectedRappid) {
    throw new Error("RAPP/1 session egg identity does not match this bridge");
  }
  let runtimeJson: unknown;
  try {
    runtimeJson = JSON.parse(egg.payload.runtime);
  } catch (error) {
    throw new Error(
      `Invalid RAPP/1 session runtime: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const runtime = sessionRuntimeSchema.parse(runtimeJson);
  if (canonicalString(runtime) !== egg.payload.runtime) {
    throw new Error("RAPP/1 session runtime is not canonical JSON");
  }
  return {
    egg,
    runtime,
    eggAddress: sessionEggAddress(egg),
  };
}
