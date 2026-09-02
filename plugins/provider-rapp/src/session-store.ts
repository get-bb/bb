import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  canonicalString,
  createSessionEgg,
  hashValue,
  mintKeylessRappid,
  parseSessionEgg,
  serializeSessionEgg,
  type RappTranscriptEntry,
} from "./rapp1.js";
import type { RappGrail } from "./vocabulary.js";

const MAX_SAFE_INTEGER = 2 ** 53 - 1;
const HEX64_PATTERN = /^[0-9a-f]{64}$/u;
const INSUFFICIENT_CAPACITY_MESSAGE = [
  "This RAPP thread does not have enough durable session capacity for another response.",
  "Start a new thread before sending more messages.",
].join(" ");

const identityRecordSchema = z
  .object({
    rappid: z.string().min(1),
    uuidAnchor: z.string().uuid(),
  })
  .strict();

const sessionHeadV1Schema = z
  .object({
    schema: z.literal("bb/provider-rapp-session-head/1"),
    provider_thread_id: z.string().min(1),
    egg_address: z.string().regex(HEX64_PATTERN),
    turn_counter: z.number().int().nonnegative().max(MAX_SAFE_INTEGER),
  })
  .strict();

const sessionHeadV2Schema = z
  .object({
    schema: z.literal("bb/provider-rapp-session-head/2"),
    provider_thread_id: z.string().min(1),
    egg_address: z.string().regex(HEX64_PATTERN),
    delivery_address: z.string().regex(HEX64_PATTERN).nullable(),
    turn_counter: z.number().int().nonnegative().max(MAX_SAFE_INTEGER),
  })
  .strict();

const sessionHeadSchema = z.discriminatedUnion("schema", [
  sessionHeadV1Schema,
  sessionHeadV2Schema,
]);

const deliveryJournalV1Schema = z
  .object({
    schema: z.literal("bb/provider-rapp-delivery/1"),
    provider_thread_id: z.string().min(1),
    egg_address: z.string().regex(HEX64_PATTERN),
    turn_counter: z.number().int().nonnegative().max(MAX_SAFE_INTEGER),
    provider_turn_id: z.string().min(1),
    agent_item_id: z.string().min(1).nullable(),
    message_item_id: z.string().min(1),
    response: z.string().min(1),
    agent_logs: z.array(z.string()),
    grail: z.enum(["consumer", "business"]),
    endpoint: z.string().min(1),
    selected_model: z.string().min(1),
    requested_model: z.string().min(1).nullable(),
    actual_model: z.string().min(1).nullable(),
  })
  .strict();

const deliveryJournalV2Schema = z
  .object({
    schema: z.literal("bb/provider-rapp-delivery/2"),
    provider_thread_id: z.string().min(1),
    egg_address: z.string().regex(HEX64_PATTERN),
    turn_counter: z.number().int().nonnegative().max(MAX_SAFE_INTEGER),
    provider_turn_id: z.string().min(1),
    agent_item_id: z.string().min(1).nullable(),
    message_item_id: z.string().min(1),
    response: z.string().min(1),
    agent_logs: z.array(z.string()),
    grail: z.enum(["consumer", "business"]),
    endpoint: z.string().min(1),
    selected_model: z.string().min(1),
    requested_model: z.string().min(1).nullable(),
    actual_model: z.string().min(1).nullable(),
    phase: z.enum(["ready", "emitted"]),
  })
  .strict();

const deliveryJournalSchema = z.discriminatedUnion("schema", [
  deliveryJournalV1Schema,
  deliveryJournalV2Schema,
]);

export interface RappPendingTurn {
  idempotencyKey: string;
  userInput: string;
  conversationHistory: RappTranscriptEntry[];
}

export interface RappDeliveryDraft {
  providerTurnId: string;
  agentItemId: string | null;
  messageItemId: string;
  response: string;
  agentLogs: string[];
  grail: RappGrail;
  endpoint: string;
  selectedModel: string;
  requestedModel: string | null;
  actualModel: string | null;
}

export interface RappPendingDelivery extends RappDeliveryDraft {
  eggAddress: string;
  phase: "ready" | "emitted";
}

export interface RappSessionSnapshot {
  providerThreadId: string;
  remoteSessionId: string | null;
  turnCounter: number;
  transcript: RappTranscriptEntry[];
  pendingTurn: RappPendingTurn | null;
}

export interface SavedRappSession {
  snapshot: RappSessionSnapshot;
  rappid: string;
  eggAddress: string;
  pendingDelivery: RappPendingDelivery | null;
  deliveryAddress: string | null;
}

function cloneTranscript(
  transcript: readonly RappTranscriptEntry[],
): RappTranscriptEntry[] {
  return transcript.map((entry) => ({ ...entry }));
}

function clonePendingTurn(
  pendingTurn: RappPendingTurn | null,
): RappPendingTurn | null {
  if (pendingTurn === null) {
    return null;
  }
  return {
    ...pendingTurn,
    conversationHistory: cloneTranscript(pendingTurn.conversationHistory),
  };
}

function cloneSnapshot(snapshot: RappSessionSnapshot): RappSessionSnapshot {
  return {
    ...snapshot,
    transcript: cloneTranscript(snapshot.transcript),
    pendingTurn: clonePendingTurn(snapshot.pendingTurn),
  };
}

function clonePendingDelivery(
  pendingDelivery: RappPendingDelivery | null,
): RappPendingDelivery | null {
  return pendingDelivery === null
    ? null
    : {
        ...pendingDelivery,
        agentLogs: [...pendingDelivery.agentLogs],
      };
}

function cloneSavedSession(saved: SavedRappSession): SavedRappSession {
  return {
    ...saved,
    snapshot: cloneSnapshot(saved.snapshot),
    pendingDelivery: clonePendingDelivery(saved.pendingDelivery),
  };
}

function sessionRuntime(snapshot: RappSessionSnapshot) {
  return {
    provider: "bb/provider-rapp" as const,
    provider_thread_id: snapshot.providerThreadId,
    remote_session_id: snapshot.remoteSessionId,
    turn_counter: snapshot.turnCounter,
    pending_turn:
      snapshot.pendingTurn === null
        ? null
        : {
            idempotency_key: snapshot.pendingTurn.idempotencyKey,
            user_input: snapshot.pendingTurn.userInput,
            conversation_history: cloneTranscript(
              snapshot.pendingTurn.conversationHistory,
            ),
          },
  };
}

function serializeSnapshotEgg(
  rappid: string,
  snapshot: RappSessionSnapshot,
  createdUtc: string,
): string {
  return serializeSessionEgg(
    createSessionEgg({
      rappid,
      createdUtc,
      runtime: sessionRuntime(snapshot),
      transcript: snapshot.transcript,
    }),
  );
}

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const code: unknown = Reflect.get(error, "code");
  return typeof code === "string" ? code : null;
}

function removeFileIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }
}

function syncDirectory(path: string): void {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, "r");
    fsyncSync(descriptor);
  } catch (error) {
    if (
      !["EBADF", "EINVAL", "EISDIR", "ENOSYS", "ENOTSUP", "EPERM"].includes(
        errorCode(error) ?? "",
      )
    ) {
      throw error;
    }
  } finally {
    if (descriptor !== null) {
      closeSync(descriptor);
    }
  }
}

function writeDurableFile(path: string, content: string): void {
  const descriptor = openSync(path, "wx", 0o600);
  try {
    writeFileSync(descriptor, content, { encoding: "utf8" });
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function atomicWrite(path: string, content: string): void {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeDurableFile(temporaryPath, content);
    renameSync(temporaryPath, path);
    syncDirectory(dirname(path));
  } finally {
    removeFileIfPresent(temporaryPath);
  }
}

function atomicCreate(path: string, content: string): boolean {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeDurableFile(temporaryPath, content);
    try {
      linkSync(temporaryPath, path);
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        return false;
      }
      throw error;
    }
    unlinkSync(temporaryPath);
    syncDirectory(dirname(path));
    return true;
  } finally {
    removeFileIfPresent(temporaryPath);
  }
}

function parseCanonicalState<T>(
  bytes: Uint8Array,
  schema: z.ZodType<T>,
  label: string,
): T {
  const text = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(bytes);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Invalid ${label} JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const parsed = schema.parse(json);
  if (
    !Buffer.from(bytes).equals(Buffer.from(canonicalString(parsed), "utf8"))
  ) {
    throw new Error(`${label} is not canonical JSON`);
  }
  return parsed;
}

function directoryHasEntries(path: string): boolean {
  return readdirSync(path).length > 0;
}

export class RappSessionStore {
  private readonly snapshots = new Map<string, SavedRappSession>();
  private readonly dataDir: string | null;
  private readonly sessionsDir: string | null;
  private readonly objectsDir: string | null;
  private readonly rappid: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir ?? null;
    this.sessionsDir =
      this.dataDir === null ? null : join(this.dataDir, "sessions");
    this.objectsDir =
      this.dataDir === null ? null : join(this.dataDir, "objects");
    if (this.sessionsDir !== null && this.objectsDir !== null) {
      mkdirSync(this.sessionsDir, { recursive: true });
      mkdirSync(this.objectsDir, { recursive: true });
    }
    this.rappid = this.loadOrCreateIdentity();
  }

  create(providerThreadId: string): SavedRappSession {
    const existing = this.load(providerThreadId);
    if (existing !== null) {
      throw new Error(`RAPP session already exists: ${providerThreadId}`);
    }
    return this.save(
      {
        providerThreadId,
        remoteSessionId: null,
        turnCounter: 0,
        transcript: [],
        pendingTurn: null,
      },
      null,
    );
  }

  load(providerThreadId: string): SavedRappSession | null {
    const cached = this.snapshots.get(providerThreadId);
    if (cached !== undefined) {
      return cloneSavedSession(cached);
    }
    const path = this.sessionPath(providerThreadId);
    if (path === null || !existsSync(path)) {
      return null;
    }
    const head = parseCanonicalState(
      readFileSync(path),
      sessionHeadSchema,
      "RAPP session head",
    );
    if (head.provider_thread_id !== providerThreadId) {
      throw new Error("RAPP session head provider thread identity mismatch");
    }
    const objectPath = this.objectPath(head.egg_address);
    if (objectPath === null || !existsSync(objectPath)) {
      throw new Error("RAPP session head points to a missing egg object");
    }
    const parsed = parseSessionEgg(readFileSync(objectPath), this.rappid);
    if (parsed.eggAddress !== head.egg_address) {
      throw new Error("RAPP session egg address does not match its head");
    }
    if (parsed.runtime.provider_thread_id !== providerThreadId) {
      throw new Error("RAPP session egg provider thread identity mismatch");
    }
    if (parsed.runtime.turn_counter !== head.turn_counter) {
      throw new Error("RAPP session head turn counter does not match its egg");
    }
    let pendingDelivery: RappPendingDelivery | null = null;
    let deliveryAddress: string | null = null;
    if (
      head.schema === "bb/provider-rapp-session-head/2" &&
      head.delivery_address !== null
    ) {
      const deliveryPath = this.objectPath(head.delivery_address);
      if (deliveryPath === null || !existsSync(deliveryPath)) {
        throw new Error(
          "RAPP session head points to a missing delivery object",
        );
      }
      const delivery = parseCanonicalState(
        readFileSync(deliveryPath),
        deliveryJournalSchema,
        "RAPP delivery journal",
      );
      if (
        hashValue("bb/provider-rapp-delivery", delivery) !==
        head.delivery_address
      ) {
        throw new Error(
          "RAPP delivery journal address does not match its head",
        );
      }
      if (delivery.provider_thread_id !== providerThreadId) {
        throw new Error(
          "RAPP delivery journal provider thread identity mismatch",
        );
      }
      if (
        delivery.egg_address !== head.egg_address ||
        delivery.turn_counter !== head.turn_counter
      ) {
        throw new Error(
          "RAPP delivery journal does not match its completed session egg",
        );
      }
      const finalEntry = parsed.egg.payload.transcript.at(-1);
      if (
        finalEntry?.role !== "assistant" ||
        finalEntry.content !== delivery.response
      ) {
        throw new Error(
          "RAPP delivery journal response does not match its completed transcript",
        );
      }
      pendingDelivery = {
        providerTurnId: delivery.provider_turn_id,
        agentItemId: delivery.agent_item_id,
        messageItemId: delivery.message_item_id,
        response: delivery.response,
        agentLogs: [...delivery.agent_logs],
        grail: delivery.grail,
        endpoint: delivery.endpoint,
        selectedModel: delivery.selected_model,
        requestedModel: delivery.requested_model,
        actualModel: delivery.actual_model,
        eggAddress: delivery.egg_address,
        phase:
          delivery.schema === "bb/provider-rapp-delivery/1"
            ? "ready"
            : delivery.phase,
      };
      deliveryAddress = head.delivery_address;
    }
    const saved: SavedRappSession = {
      snapshot: {
        providerThreadId,
        remoteSessionId: parsed.runtime.remote_session_id,
        turnCounter: parsed.runtime.turn_counter,
        transcript: cloneTranscript(parsed.egg.payload.transcript),
        pendingTurn:
          parsed.runtime.pending_turn === null
            ? null
            : {
                idempotencyKey: parsed.runtime.pending_turn.idempotency_key,
                userInput: parsed.runtime.pending_turn.user_input,
                conversationHistory: cloneTranscript(
                  parsed.runtime.pending_turn.conversation_history,
                ),
              },
      },
      rappid: this.rappid,
      eggAddress: parsed.eggAddress,
      pendingDelivery,
      deliveryAddress,
    };
    this.snapshots.set(providerThreadId, saved);
    return cloneSavedSession(saved);
  }

  assertCanCommitCompletion(
    snapshot: RappSessionSnapshot,
    userInput: string,
    maximumResponseBytes: number,
  ): void {
    if (
      !Number.isSafeInteger(maximumResponseBytes) ||
      maximumResponseBytes < 1
    ) {
      throw new Error("RAPP response capacity must be a positive integer");
    }
    const responseReserve = "x".repeat(maximumResponseBytes);
    const sessionIdReserve = "\\".repeat(
      Math.floor(maximumResponseBytes / 2),
    );
    const completion = {
      ...snapshot,
      pendingTurn: null,
      transcript: [
        ...cloneTranscript(snapshot.transcript),
        { role: "user" as const, content: userInput },
        { role: "assistant" as const, content: responseReserve },
      ],
    };
    for (const remoteSessionId of [
      snapshot.remoteSessionId,
      sessionIdReserve,
    ]) {
      try {
        serializeSnapshotEgg(
          this.rappid,
          { ...completion, remoteSessionId },
          "9999-12-31T23:59:59.999Z",
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("exceeds 1 MiB")
        ) {
          throw new Error(INSUFFICIENT_CAPACITY_MESSAGE);
        }
        throw error;
      }
    }
  }

  save(
    snapshot: RappSessionSnapshot,
    delivery: RappDeliveryDraft | null,
  ): SavedRappSession {
    const serialized = serializeSnapshotEgg(
      this.rappid,
      snapshot,
      new Date().toISOString(),
    );
    const parsed = parseSessionEgg(Buffer.from(serialized), this.rappid);
    const deliveryRecord =
      delivery === null
        ? null
        : {
            schema: "bb/provider-rapp-delivery/2" as const,
            provider_thread_id: snapshot.providerThreadId,
            egg_address: parsed.eggAddress,
            turn_counter: snapshot.turnCounter,
            provider_turn_id: delivery.providerTurnId,
            agent_item_id: delivery.agentItemId,
            message_item_id: delivery.messageItemId,
            response: delivery.response,
            agent_logs: [...delivery.agentLogs],
            grail: delivery.grail,
            endpoint: delivery.endpoint,
            selected_model: delivery.selectedModel,
            requested_model: delivery.requestedModel,
            actual_model: delivery.actualModel,
            phase: "ready" as const,
          };
    const deliverySerialized =
      deliveryRecord === null ? null : canonicalString(deliveryRecord);
    const deliveryAddress =
      deliveryRecord === null
        ? null
        : hashValue("bb/provider-rapp-delivery", deliveryRecord);
    const pendingDelivery: RappPendingDelivery | null =
      delivery === null
        ? null
        : {
            ...delivery,
            agentLogs: [...delivery.agentLogs],
            eggAddress: parsed.eggAddress,
            phase: "ready",
          };
    const saved: SavedRappSession = {
      snapshot: cloneSnapshot(snapshot),
      rappid: this.rappid,
      eggAddress: parsed.eggAddress,
      pendingDelivery,
      deliveryAddress,
    };
    const path = this.sessionPath(snapshot.providerThreadId);
    if (path !== null) {
      if (existsSync(path)) {
        const currentHead = parseCanonicalState(
          readFileSync(path),
          sessionHeadSchema,
          "RAPP session head",
        );
        if (currentHead.provider_thread_id !== snapshot.providerThreadId) {
          throw new Error(
            "RAPP session head provider thread identity mismatch",
          );
        }
        if (snapshot.turnCounter < currentHead.turn_counter) {
          throw new Error("RAPP session save would roll back the turn counter");
        }
      }
      this.writeObject(parsed.eggAddress, serialized, "RAPP session object");
      if (deliveryAddress !== null && deliverySerialized !== null) {
        this.writeObject(
          deliveryAddress,
          deliverySerialized,
          "RAPP delivery journal object",
        );
      }
      atomicWrite(
        path,
        canonicalString({
          schema: "bb/provider-rapp-session-head/2",
          provider_thread_id: snapshot.providerThreadId,
          egg_address: parsed.eggAddress,
          delivery_address: deliveryAddress,
          turn_counter: snapshot.turnCounter,
        }),
      );
    }
    this.snapshots.set(snapshot.providerThreadId, saved);
    return cloneSavedSession(saved);
  }

  markDeliveryEmitted(
    providerThreadId: string,
    expectedDeliveryAddress: string,
  ): SavedRappSession {
    const current = this.load(providerThreadId);
    if (
      current === null ||
      current.deliveryAddress !== expectedDeliveryAddress ||
      current.pendingDelivery === null
    ) {
      throw new Error("RAPP delivery journal emission mismatch");
    }
    if (current.pendingDelivery.phase === "emitted") {
      return current;
    }
    const delivery = current.pendingDelivery;
    const deliveryRecord = {
      schema: "bb/provider-rapp-delivery/2" as const,
      provider_thread_id: providerThreadId,
      egg_address: current.eggAddress,
      turn_counter: current.snapshot.turnCounter,
      provider_turn_id: delivery.providerTurnId,
      agent_item_id: delivery.agentItemId,
      message_item_id: delivery.messageItemId,
      response: delivery.response,
      agent_logs: [...delivery.agentLogs],
      grail: delivery.grail,
      endpoint: delivery.endpoint,
      selected_model: delivery.selectedModel,
      requested_model: delivery.requestedModel,
      actual_model: delivery.actualModel,
      phase: "emitted" as const,
    };
    const serialized = canonicalString(deliveryRecord);
    const deliveryAddress = hashValue(
      "bb/provider-rapp-delivery",
      deliveryRecord,
    );
    const path = this.sessionPath(providerThreadId);
    if (path !== null) {
      const head = parseCanonicalState(
        readFileSync(path),
        sessionHeadSchema,
        "RAPP session head",
      );
      if (
        head.schema !== "bb/provider-rapp-session-head/2" ||
        head.provider_thread_id !== providerThreadId ||
        head.egg_address !== current.eggAddress ||
        head.turn_counter !== current.snapshot.turnCounter ||
        head.delivery_address !== expectedDeliveryAddress
      ) {
        throw new Error("RAPP delivery journal emission mismatch");
      }
      this.writeObject(
        deliveryAddress,
        serialized,
        "RAPP delivery journal object",
      );
      atomicWrite(
        path,
        canonicalString({
          schema: "bb/provider-rapp-session-head/2",
          provider_thread_id: providerThreadId,
          egg_address: current.eggAddress,
          delivery_address: deliveryAddress,
          turn_counter: current.snapshot.turnCounter,
        }),
      );
    }
    const emitted: SavedRappSession = {
      ...current,
      pendingDelivery: {
        ...delivery,
        agentLogs: [...delivery.agentLogs],
        phase: "emitted",
      },
      deliveryAddress,
    };
    this.snapshots.set(providerThreadId, emitted);
    return cloneSavedSession(emitted);
  }

  acknowledgeDelivery(
    providerThreadId: string,
    expectedDeliveryAddress: string,
  ): SavedRappSession {
    const current = this.load(providerThreadId);
    if (current === null) {
      throw new Error(`Unknown RAPP session: ${providerThreadId}`);
    }
    if (
      current.deliveryAddress !== expectedDeliveryAddress ||
      current.pendingDelivery === null
    ) {
      throw new Error("RAPP delivery journal acknowledgement mismatch");
    }
    const path = this.sessionPath(providerThreadId);
    if (path !== null) {
      const head = parseCanonicalState(
        readFileSync(path),
        sessionHeadSchema,
        "RAPP session head",
      );
      if (
        head.schema !== "bb/provider-rapp-session-head/2" ||
        head.provider_thread_id !== providerThreadId ||
        head.egg_address !== current.eggAddress ||
        head.turn_counter !== current.snapshot.turnCounter ||
        head.delivery_address !== expectedDeliveryAddress
      ) {
        throw new Error("RAPP delivery journal acknowledgement mismatch");
      }
      atomicWrite(
        path,
        canonicalString({
          schema: "bb/provider-rapp-session-head/2",
          provider_thread_id: providerThreadId,
          egg_address: current.eggAddress,
          delivery_address: null,
          turn_counter: current.snapshot.turnCounter,
        }),
      );
    }
    const acknowledged: SavedRappSession = {
      ...current,
      pendingDelivery: null,
      deliveryAddress: null,
    };
    this.snapshots.set(providerThreadId, acknowledged);
    return cloneSavedSession(acknowledged);
  }

  delete(providerThreadId: string): void {
    const path = this.sessionPath(providerThreadId);
    if (path !== null && existsSync(path)) {
      unlinkSync(path);
      syncDirectory(dirname(path));
    }
    this.snapshots.delete(providerThreadId);
  }

  private writeObject(
    address: string,
    serialized: string,
    label: string,
  ): void {
    const objectPath = this.objectPath(address);
    if (objectPath === null) {
      throw new Error("RAPP session object directory is unavailable");
    }
    const expected = Buffer.from(serialized, "utf8");
    if (existsSync(objectPath)) {
      if (!readFileSync(objectPath).equals(expected)) {
        throw new Error(`${label} address contains different bytes`);
      }
      return;
    }
    if (!atomicCreate(objectPath, serialized)) {
      if (!readFileSync(objectPath).equals(expected)) {
        throw new Error(`${label} address contains different bytes`);
      }
    }
  }

  private loadOrCreateIdentity(): string {
    if (
      this.dataDir === null ||
      this.sessionsDir === null ||
      this.objectsDir === null
    ) {
      return mintKeylessRappid("get-bb", "provider-rapp").rappid;
    }
    mkdirSync(this.dataDir, { recursive: true });
    const path = join(this.dataDir, "identity.json");
    if (existsSync(path)) {
      return this.loadIdentity(path);
    }
    if (
      directoryHasEntries(this.sessionsDir) ||
      directoryHasEntries(this.objectsDir)
    ) {
      throw new Error(
        "RAPP bridge identity is missing while persisted session state exists",
      );
    }
    const identity = mintKeylessRappid("get-bb", "provider-rapp");
    if (!atomicCreate(path, canonicalString(identity))) {
      return this.loadIdentity(path);
    }
    return identity.rappid;
  }

  private loadIdentity(path: string): string {
    const parsed = identityRecordSchema.parse(
      JSON.parse(readFileSync(path, "utf8")),
    );
    const expected = mintKeylessRappid(
      "get-bb",
      "provider-rapp",
      parsed.uuidAnchor,
    );
    if (expected.rappid !== parsed.rappid) {
      throw new Error("RAPP bridge identity record failed verification");
    }
    return parsed.rappid;
  }

  private sessionPath(providerThreadId: string): string | null {
    if (this.sessionsDir === null) {
      return null;
    }
    const name = createHash("sha256")
      .update(providerThreadId, "utf8")
      .digest("hex");
    return join(this.sessionsDir, `${name}.json`);
  }

  private objectPath(eggAddress: string): string | null {
    if (this.objectsDir === null) {
      return null;
    }
    return join(this.objectsDir, `${eggAddress}.json`);
  }
}
