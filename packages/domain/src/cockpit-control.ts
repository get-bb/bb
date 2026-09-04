import { z } from "zod";

const OWNER_REF_PREFIX = "cvr1.";

export const cockpitActionKindValues = [
  "steer",
  "pause",
  "resume",
  "take_over",
  "answer",
  "approve",
  "deny",
  "mfa",
  "passkey",
  "device_approval",
  "legal_attestation",
] as const;
export const cockpitActionKindSchema = z.enum(cockpitActionKindValues);
export type CockpitActionKind = z.infer<typeof cockpitActionKindSchema>;

export const cockpitEffectClassSchema = z.enum([
  "read",
  "reversible_write",
  "write",
  "approval",
  "human_gate",
]);
export type CockpitEffectClass = z.infer<typeof cockpitEffectClassSchema>;

export const cockpitConfirmationClassSchema = z.enum([
  "none",
  "confirm",
  "human_gate",
]);
export type CockpitConfirmationClass = z.infer<
  typeof cockpitConfirmationClassSchema
>;

export const cockpitRecoveryOwnerSchema = z.enum([
  "none",
  "bb-server",
  "human",
]);
export type CockpitRecoveryOwner = z.infer<typeof cockpitRecoveryOwnerSchema>;

export const cockpitErrorCodeSchema = z.enum([
  "unsupported",
  "expired",
  "unauthorized",
  "wrong_host",
  "confirmation_required",
  "human_gate",
  "conflict",
  "invalid_request",
]);
export type CockpitErrorCode = z.infer<typeof cockpitErrorCodeSchema>;

export const cockpitSessionStatusSchema = z.enum([
  "running",
  "paused",
  "error",
]);
export type CockpitSessionStatus = z.infer<typeof cockpitSessionStatusSchema>;

export const cockpitAttentionKindSchema = z.enum(["approval", "question"]);
export type CockpitAttentionKind = z.infer<typeof cockpitAttentionKindSchema>;

export const cockpitOwnerKindSchema = z.enum(["session", "attention"]);
export type CockpitOwnerKind = z.infer<typeof cockpitOwnerKindSchema>;

export const cockpitUserAnswerSchema = z.object({
  selected: z.array(z.string().min(1)),
  freeText: z.string().min(1).optional(),
});
export type CockpitUserAnswer = z.infer<typeof cockpitUserAnswerSchema>;

export const cockpitActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("steer"),
    message: z.string().min(1),
  }),
  z.object({ kind: z.literal("pause") }),
  z.object({ kind: z.literal("resume") }),
  z.object({ kind: z.literal("take_over") }),
  z.object({
    kind: z.literal("answer"),
    answers: z.record(z.string().min(1), cockpitUserAnswerSchema),
  }),
  z.object({ kind: z.literal("approve") }),
  z.object({ kind: z.literal("deny") }),
  z.object({ kind: z.literal("mfa") }),
  z.object({ kind: z.literal("passkey") }),
  z.object({ kind: z.literal("device_approval") }),
  z.object({ kind: z.literal("legal_attestation") }),
]);
export type CockpitAction = z.infer<typeof cockpitActionSchema>;

export const cockpitConfirmationSchema = z.enum(["none", "confirmed"]);
export type CockpitConfirmation = z.infer<typeof cockpitConfirmationSchema>;

export const cockpitOwnerRefSchema = z.string().min(1);
export type CockpitOwnerRef = z.infer<typeof cockpitOwnerRefSchema>;

export const cockpitActionRequestSchema = z.object({
  ownerRef: cockpitOwnerRefSchema,
  action: cockpitActionSchema,
  idempotencyKey: z.string().min(1),
  hostId: z.string().min(1),
  confirmation: cockpitConfirmationSchema,
});
export type CockpitActionRequest = z.infer<typeof cockpitActionRequestSchema>;

export const cockpitErrorSchema = z.object({
  code: cockpitErrorCodeSchema,
  message: z.string().min(1),
});
export type CockpitError = z.infer<typeof cockpitErrorSchema>;

export const cockpitReceiptOutcomeSchema = z.enum([
  "accepted",
  "rejected",
  "replayed",
]);
export type CockpitReceiptOutcome = z.infer<typeof cockpitReceiptOutcomeSchema>;

export const cockpitReceiptSchema = z.object({
  receiptId: z.string().min(1),
  ownerRef: cockpitOwnerRefSchema,
  hostId: z.string().min(1),
  action: cockpitActionSchema,
  outcome: cockpitReceiptOutcomeSchema,
  effectClass: cockpitEffectClassSchema,
  confirmationClass: cockpitConfirmationClassSchema,
  recoveryOwner: cockpitRecoveryOwnerSchema,
  idempotencyKey: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  error: cockpitErrorSchema.nullable(),
});
export type CockpitReceipt = z.infer<typeof cockpitReceiptSchema>;

export const cockpitAgentSchema = z.object({
  ownerRef: cockpitOwnerRefSchema,
  displayName: z.string(),
  providerId: z.string().min(1),
  hostId: z.string().min(1),
  status: cockpitSessionStatusSchema,
  supportedActions: z.array(cockpitActionKindSchema),
});
export type CockpitAgent = z.infer<typeof cockpitAgentSchema>;

export const cockpitSessionSchema = z.object({
  ownerRef: cockpitOwnerRefSchema,
  agentOwnerRef: cockpitOwnerRefSchema,
  displayName: z.string(),
  providerId: z.string().min(1),
  hostId: z.string().min(1),
  status: cockpitSessionStatusSchema,
  supportedActions: z.array(cockpitActionKindSchema),
});
export type CockpitSession = z.infer<typeof cockpitSessionSchema>;

export const cockpitAttentionItemSchema = z.object({
  ownerRef: cockpitOwnerRefSchema,
  sessionOwnerRef: cockpitOwnerRefSchema,
  attentionKind: cockpitAttentionKindSchema,
  hostId: z.string().min(1),
  expiresAt: z.number().int().nonnegative().nullable(),
  supportedActions: z.array(cockpitActionKindSchema),
});
export type CockpitAttentionItem = z.infer<typeof cockpitAttentionItemSchema>;

export const cockpitDiscoveryQuerySchema = z.object({
  hostId: z.string().min(1).nullable(),
});
export type CockpitDiscoveryQuery = z.infer<typeof cockpitDiscoveryQuerySchema>;

export const cockpitDiscoverySchema = z.object({
  hostId: z.string().min(1).nullable(),
  agents: z.array(cockpitAgentSchema),
  sessions: z.array(cockpitSessionSchema),
  attentionItems: z.array(cockpitAttentionItemSchema),
});
export type CockpitDiscovery = z.infer<typeof cockpitDiscoverySchema>;

const ownerRefPayloadSchema = z.object({
  t: cockpitOwnerKindSchema,
  i: z.string().min(1),
  h: z.string().min(1),
});
export type CockpitOwnerRefPayload = z.infer<typeof ownerRefPayloadSchema>;

export class CockpitControlError extends Error {
  readonly code: CockpitErrorCode;

  constructor(code: CockpitErrorCode, message: string) {
    super(message);
    this.name = "CockpitControlError";
    this.code = code;
  }
}

export function cockpitActionPolicy(kind: CockpitActionKind): {
  effectClass: CockpitEffectClass;
  confirmationClass: CockpitConfirmationClass;
  recoveryOwner: CockpitRecoveryOwner;
} {
  switch (kind) {
    case "pause":
    case "resume":
      return {
        effectClass: "reversible_write",
        confirmationClass: "none",
        recoveryOwner: "bb-server",
      };
    case "steer":
      return {
        effectClass: "write",
        confirmationClass: "none",
        recoveryOwner: "bb-server",
      };
    case "take_over":
      return {
        effectClass: "write",
        confirmationClass: "confirm",
        recoveryOwner: "bb-server",
      };
    case "approve":
    case "deny":
    case "answer":
      return {
        effectClass: "approval",
        confirmationClass: "none",
        recoveryOwner: "bb-server",
      };
    case "mfa":
    case "passkey":
    case "device_approval":
    case "legal_attestation":
      return {
        effectClass: "human_gate",
        confirmationClass: "human_gate",
        recoveryOwner: "human",
      };
  }
}

function encodeUtf8Hex(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function decodeUtf8Hex(value: string): string {
  if (value.length % 2 !== 0) {
    throw new Error("invalid hex");
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error("invalid hex");
    }
    bytes[index] = byte;
  }
  return new TextDecoder().decode(bytes);
}

export function encodeCockpitOwnerRef(
  payload: CockpitOwnerRefPayload,
): CockpitOwnerRef {
  return `${OWNER_REF_PREFIX}${encodeUtf8Hex(JSON.stringify(payload))}`;
}

export function decodeCockpitOwnerRef(
  ownerRef: string,
): CockpitOwnerRefPayload {
  if (!ownerRef.startsWith(OWNER_REF_PREFIX)) {
    throw new CockpitControlError(
      "unauthorized",
      "Owner reference is not a cockpit-control handle",
    );
  }
  const encoded = ownerRef.slice(OWNER_REF_PREFIX.length);
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeUtf8Hex(encoded)) as unknown;
  } catch {
    throw new CockpitControlError(
      "unauthorized",
      "Owner reference is not a cockpit-control handle",
    );
  }
  const payload = ownerRefPayloadSchema.safeParse(parsed);
  if (!payload.success) {
    throw new CockpitControlError(
      "unauthorized",
      "Owner reference is not a cockpit-control handle",
    );
  }
  return payload.data;
}

export interface CockpitInventorySession {
  id: string;
  hostId: string;
  displayName: string;
  providerId: string;
  status: CockpitSessionStatus;
}

export interface CockpitInventoryAttention {
  id: string;
  sessionId: string;
  hostId: string;
  attentionKind: CockpitAttentionKind;
  expiresAt: number | null;
}

export interface CockpitInventory {
  sessions: readonly CockpitInventorySession[];
  attentionItems: readonly CockpitInventoryAttention[];
}

export interface CockpitReceiptStore {
  get(idempotencyKey: string): CockpitReceipt | null;
  put(idempotencyKey: string, receipt: CockpitReceipt): void;
}

export interface CockpitControlPorts {
  now(): number;
  createReceiptId(): string;
  receipts: CockpitReceiptStore;
  listInventory(): CockpitInventory | Promise<CockpitInventory>;
  pause(sessionId: string): Promise<void>;
  resume(sessionId: string): Promise<void>;
  steer(sessionId: string, message: string): Promise<void>;
  takeOver(sessionId: string): Promise<void>;
  approve(attentionId: string): Promise<void>;
  deny(attentionId: string): Promise<void>;
  answer(
    attentionId: string,
    answers: Record<string, CockpitUserAnswer>,
  ): Promise<void>;
}

export interface CockpitControl {
  discover(query: CockpitDiscoveryQuery): Promise<CockpitDiscovery>;
  act(request: CockpitActionRequest): Promise<CockpitReceipt>;
}

export function createMemoryCockpitReceiptStore(): CockpitReceiptStore {
  const receipts = new Map<string, CockpitReceipt>();
  return {
    get(idempotencyKey) {
      return receipts.get(idempotencyKey) ?? null;
    },
    put(idempotencyKey, receipt) {
      receipts.set(idempotencyKey, receipt);
    },
  };
}

function sessionActions(
  status: CockpitSessionStatus,
): CockpitActionKind[] {
  switch (status) {
    case "running":
      return ["steer", "pause", "take_over"];
    case "paused":
      return ["steer", "resume"];
    case "error":
      return ["resume"];
  }
}

function attentionActions(
  kind: CockpitAttentionKind,
): CockpitActionKind[] {
  switch (kind) {
    case "approval":
      return ["approve", "deny"];
    case "question":
      return ["answer"];
  }
}

function actionFingerprint(request: CockpitActionRequest): string {
  return JSON.stringify({
    ownerRef: request.ownerRef,
    action: request.action,
    hostId: request.hostId,
  });
}

function receiptFingerprint(receipt: CockpitReceipt): string {
  return JSON.stringify({
    ownerRef: receipt.ownerRef,
    action: receipt.action,
    hostId: receipt.hostId,
  });
}

function toCockpitError(error: unknown): CockpitError {
  if (error instanceof CockpitControlError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error && error.message.length > 0) {
    return { code: "invalid_request", message: error.message };
  }
  return { code: "invalid_request", message: "Cockpit-control action failed" };
}

function rejectReceipt(args: {
  request: CockpitActionRequest;
  ports: CockpitControlPorts;
  error: CockpitError;
}): CockpitReceipt {
  const policy = cockpitActionPolicy(args.request.action.kind);
  return {
    receiptId: args.ports.createReceiptId(),
    ownerRef: args.request.ownerRef,
    hostId: args.request.hostId,
    action: args.request.action,
    outcome: "rejected",
    effectClass: policy.effectClass,
    confirmationClass: policy.confirmationClass,
    recoveryOwner: policy.recoveryOwner,
    idempotencyKey: args.request.idempotencyKey,
    createdAt: args.ports.now(),
    error: args.error,
  };
}

export function createCockpitControl(
  ports: CockpitControlPorts,
): CockpitControl {
  async function loadDiscovery(
    hostId: string | null,
  ): Promise<CockpitDiscovery> {
    const inventory = await ports.listInventory();
    const now = ports.now();
    const sessions = inventory.sessions.filter(
      (session) => hostId === null || session.hostId === hostId,
    );
    const attentionItems = inventory.attentionItems.filter((item) => {
      if (hostId !== null && item.hostId !== hostId) {
        return false;
      }
      return item.expiresAt === null || item.expiresAt > now;
    });
    const sessionById = new Map(
      sessions.map((session) => [session.id, session]),
    );

    const publishedSessions = sessions.map((session) => {
      const ownerRef = encodeCockpitOwnerRef({
        t: "session",
        i: session.id,
        h: session.hostId,
      });
      const supportedActions = sessionActions(session.status);
      return {
        ownerRef,
        agentOwnerRef: ownerRef,
        displayName: session.displayName,
        providerId: session.providerId,
        hostId: session.hostId,
        status: session.status,
        supportedActions,
      };
    });

    return {
      hostId,
      agents: publishedSessions.map((session) => ({
        ownerRef: session.ownerRef,
        displayName: session.displayName,
        providerId: session.providerId,
        hostId: session.hostId,
        status: session.status,
        supportedActions: session.supportedActions,
      })),
      sessions: publishedSessions,
      attentionItems: attentionItems.flatMap((item) => {
        const session = sessionById.get(item.sessionId);
        if (session === undefined) {
          return [];
        }
        return [
          {
            ownerRef: encodeCockpitOwnerRef({
              t: "attention",
              i: item.id,
              h: item.hostId,
            }),
            sessionOwnerRef: encodeCockpitOwnerRef({
              t: "session",
              i: session.id,
              h: session.hostId,
            }),
            attentionKind: item.attentionKind,
            hostId: item.hostId,
            expiresAt: item.expiresAt,
            supportedActions: attentionActions(item.attentionKind),
          },
        ];
      }),
    };
  }

  return {
    async discover(query) {
      return loadDiscovery(query.hostId);
    },

    async act(request) {
      const existing = ports.receipts.get(request.idempotencyKey);
      if (existing !== null) {
        if (receiptFingerprint(existing) !== actionFingerprint(request)) {
          return rejectReceipt({
            request,
            ports,
            error: {
              code: "conflict",
              message:
                "Idempotency key was already used for a different cockpit-control action",
            },
          });
        }
        return {
          ...existing,
          outcome: "replayed",
        };
      }

      const policy = cockpitActionPolicy(request.action.kind);
      if (policy.confirmationClass === "human_gate") {
        const receipt = rejectReceipt({
          request,
          ports,
          error: {
            code: "human_gate",
            message:
              "This action is an explicit human gate and cannot be executed by cockpit-control",
          },
        });
        ports.receipts.put(request.idempotencyKey, receipt);
        return receipt;
      }
      if (
        policy.confirmationClass === "confirm" &&
        request.confirmation !== "confirmed"
      ) {
        const receipt = rejectReceipt({
          request,
          ports,
          error: {
            code: "confirmation_required",
            message: "Confirm take_over before executing it",
          },
        });
        ports.receipts.put(request.idempotencyKey, receipt);
        return receipt;
      }

      let decoded: CockpitOwnerRefPayload;
      try {
        decoded = decodeCockpitOwnerRef(request.ownerRef);
      } catch (error) {
        const receipt = rejectReceipt({
          request,
          ports,
          error: toCockpitError(error),
        });
        ports.receipts.put(request.idempotencyKey, receipt);
        return receipt;
      }

      if (decoded.h !== request.hostId) {
        const receipt = rejectReceipt({
          request,
          ports,
          error: {
            code: "wrong_host",
            message: "Owner is bound to a different execution host",
          },
        });
        ports.receipts.put(request.idempotencyKey, receipt);
        return receipt;
      }

      const discovery = await loadDiscovery(request.hostId);
      const now = ports.now();

      try {
        if (decoded.t === "session") {
          const session = discovery.sessions.find(
            (entry) => entry.ownerRef === request.ownerRef,
          );
          if (session === undefined) {
            throw new CockpitControlError(
              "expired",
              "Session is no longer available for cockpit-control",
            );
          }
          if (!session.supportedActions.includes(request.action.kind)) {
            throw new CockpitControlError(
              "unsupported",
              `Session does not support ${request.action.kind}`,
            );
          }
          switch (request.action.kind) {
            case "pause":
              await ports.pause(decoded.i);
              break;
            case "resume":
              await ports.resume(decoded.i);
              break;
            case "steer":
              await ports.steer(decoded.i, request.action.message);
              break;
            case "take_over":
              await ports.takeOver(decoded.i);
              break;
            default:
              throw new CockpitControlError(
                "unsupported",
                `Session does not support ${request.action.kind}`,
              );
          }
        } else {
          const item = discovery.attentionItems.find(
            (entry) => entry.ownerRef === request.ownerRef,
          );
          if (
            item === undefined ||
            (item.expiresAt !== null && item.expiresAt <= now)
          ) {
            throw new CockpitControlError(
              "expired",
              "Attention item is no longer available for cockpit-control",
            );
          }
          if (!item.supportedActions.includes(request.action.kind)) {
            throw new CockpitControlError(
              "unsupported",
              `Attention item does not support ${request.action.kind}`,
            );
          }
          switch (request.action.kind) {
            case "approve":
              await ports.approve(decoded.i);
              break;
            case "deny":
              await ports.deny(decoded.i);
              break;
            case "answer":
              await ports.answer(decoded.i, request.action.answers);
              break;
            default:
              throw new CockpitControlError(
                "unsupported",
                `Attention item does not support ${request.action.kind}`,
              );
          }
        }
      } catch (error) {
        const receipt = rejectReceipt({
          request,
          ports,
          error: toCockpitError(error),
        });
        ports.receipts.put(request.idempotencyKey, receipt);
        return receipt;
      }

      const receipt: CockpitReceipt = {
        receiptId: ports.createReceiptId(),
        ownerRef: request.ownerRef,
        hostId: request.hostId,
        action: request.action,
        outcome: "accepted",
        effectClass: policy.effectClass,
        confirmationClass: policy.confirmationClass,
        recoveryOwner: policy.recoveryOwner,
        idempotencyKey: request.idempotencyKey,
        createdAt: ports.now(),
        error: null,
      };
      ports.receipts.put(request.idempotencyKey, receipt);
      return receipt;
    },
  };
}
