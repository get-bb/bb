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
  mintKeylessRappid,
  parseSessionEgg,
  serializeSessionEgg,
  type RappTranscriptEntry,
} from "./rapp1.js";

const MAX_SAFE_INTEGER = 2 ** 53 - 1;
const HEX64_PATTERN = /^[0-9a-f]{64}$/u;

const identityRecordSchema = z
  .object({
    rappid: z.string().min(1),
    uuidAnchor: z.string().uuid(),
  })
  .strict();

const sessionHeadSchema = z
  .object({
    schema: z.literal("bb/provider-rapp-session-head/1"),
    provider_thread_id: z.string().min(1),
    egg_address: z.string().regex(HEX64_PATTERN),
    turn_counter: z.number().int().nonnegative().max(MAX_SAFE_INTEGER),
  })
  .strict();

export interface RappPendingTurn {
  idempotencyKey: string;
  userInput: string;
  conversationHistory: RappTranscriptEntry[];
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
    return this.save({
      providerThreadId,
      remoteSessionId: null,
      turnCounter: 0,
      transcript: [],
      pendingTurn: null,
    });
  }

  load(providerThreadId: string): SavedRappSession | null {
    const cached = this.snapshots.get(providerThreadId);
    if (cached !== undefined) {
      return {
        ...cached,
        snapshot: cloneSnapshot(cached.snapshot),
      };
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
    };
    this.snapshots.set(providerThreadId, saved);
    return {
      ...saved,
      snapshot: cloneSnapshot(saved.snapshot),
    };
  }

  save(snapshot: RappSessionSnapshot): SavedRappSession {
    const egg = createSessionEgg({
      rappid: this.rappid,
      createdUtc: new Date().toISOString(),
      runtime: {
        provider: "bb/provider-rapp",
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
      },
      transcript: snapshot.transcript,
    });
    const serialized = serializeSessionEgg(egg);
    const parsed = parseSessionEgg(Buffer.from(serialized), this.rappid);
    const saved: SavedRappSession = {
      snapshot: cloneSnapshot(snapshot),
      rappid: this.rappid,
      eggAddress: parsed.eggAddress,
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
      const objectPath = this.objectPath(parsed.eggAddress);
      if (objectPath === null) {
        throw new Error("RAPP session object directory is unavailable");
      }
      if (existsSync(objectPath)) {
        if (!readFileSync(objectPath).equals(Buffer.from(serialized, "utf8"))) {
          throw new Error(
            "RAPP session object address contains different bytes",
          );
        }
      } else if (!atomicCreate(objectPath, serialized)) {
        if (!readFileSync(objectPath).equals(Buffer.from(serialized, "utf8"))) {
          throw new Error(
            "RAPP session object address contains different bytes",
          );
        }
      }
      atomicWrite(
        path,
        canonicalString({
          schema: "bb/provider-rapp-session-head/1",
          provider_thread_id: snapshot.providerThreadId,
          egg_address: parsed.eggAddress,
          turn_counter: snapshot.turnCounter,
        }),
      );
    }
    this.snapshots.set(snapshot.providerThreadId, saved);
    return {
      ...saved,
      snapshot: cloneSnapshot(saved.snapshot),
    };
  }

  delete(providerThreadId: string): void {
    const path = this.sessionPath(providerThreadId);
    if (path !== null && existsSync(path)) {
      unlinkSync(path);
      syncDirectory(dirname(path));
    }
    this.snapshots.delete(providerThreadId);
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
