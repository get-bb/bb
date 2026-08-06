import { z } from "zod";
import { actorStampSchema, type ActorStamp } from "./actor-stamp.js";
import { principalKindValues } from "./principal.js";
import {
  clientTurnRequestIdSchema,
  type ClientTurnRequestId,
} from "./protocol-ids.js";

export const threadCommandKindValues = [
  "message.send",
  "message.steer",
  "thread.interrupt",
] as const;
export const threadCommandKindSchema = z.enum(threadCommandKindValues);
export type ThreadCommandKind = z.infer<typeof threadCommandKindSchema>;

export const THREAD_COMMAND_REQUEST_FINGERPRINT_PREFIX = "sha256:";
export const THREAD_COMMAND_REQUEST_FINGERPRINT_HEX_LENGTH = 64;

export const threadCommandRequestFingerprintSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u)
  .brand<"ThreadCommandRequestFingerprint">();
export type ThreadCommandRequestFingerprint = z.infer<
  typeof threadCommandRequestFingerprintSchema
>;

export const threadCommandAdmissionDispositionValues = [
  "started",
  "queued",
  "steered",
  "interrupted",
] as const;
export const threadCommandAdmissionDispositionSchema = z.enum(
  threadCommandAdmissionDispositionValues,
);
export type ThreadCommandAdmissionDisposition = z.infer<
  typeof threadCommandAdmissionDispositionSchema
>;

export const threadCommandAdmissionQueuedMessageIdSchema = z
  .string()
  .regex(/^qmsg_[23456789abcdefghijkmnpqrstuvwxyz]{10}$/u);

export const threadCommandAdmissionEventSequenceSchema = z
  .number()
  .int()
  .positive();

const threadCommandStartedResultSchema = z
  .object({
    disposition: z.literal("started"),
    eventSequence: threadCommandAdmissionEventSequenceSchema,
  })
  .strict();

const threadCommandQueuedResultSchema = z
  .object({
    disposition: z.literal("queued"),
    queuedMessageId: threadCommandAdmissionQueuedMessageIdSchema,
  })
  .strict();

const threadCommandSteeredResultSchema = z
  .object({
    disposition: z.literal("steered"),
    eventSequence: threadCommandAdmissionEventSequenceSchema,
    expectedTurnId: z.string().min(1),
  })
  .strict();

const threadCommandInterruptedResultSchema = z
  .object({
    disposition: z.literal("interrupted"),
    eventSequence: threadCommandAdmissionEventSequenceSchema,
    expectedTurnId: z.string().min(1),
  })
  .strict();

export const threadCommandAdmissionResultSchema = z.discriminatedUnion(
  "disposition",
  [
    threadCommandStartedResultSchema,
    threadCommandQueuedResultSchema,
    threadCommandSteeredResultSchema,
    threadCommandInterruptedResultSchema,
  ],
);
export type ThreadCommandAdmissionResult = z.infer<
  typeof threadCommandAdmissionResultSchema
>;

export const threadCommandAdmissionCommandResultSchema = z.discriminatedUnion(
  "commandKind",
  [
    z
      .object({
        commandKind: z.literal("message.send"),
        result: z.discriminatedUnion("disposition", [
          threadCommandStartedResultSchema,
          threadCommandQueuedResultSchema,
        ]),
      })
      .strict(),
    z
      .object({
        commandKind: z.literal("message.steer"),
        result: threadCommandSteeredResultSchema,
      })
      .strict(),
    z
      .object({
        commandKind: z.literal("thread.interrupt"),
        result: threadCommandInterruptedResultSchema,
      })
      .strict(),
  ],
);

export const threadCommandAdmissionIdentitySchema = z
  .object({
    threadId: z.string().min(1),
    requestId: clientTurnRequestIdSchema,
    commandKind: threadCommandKindSchema,
    requestFingerprint: threadCommandRequestFingerprintSchema,
    actorPrincipalId: z.string().min(1),
    actorPrincipalKind: z.enum(principalKindValues),
  })
  .strict();
export type ThreadCommandAdmissionIdentity = z.infer<
  typeof threadCommandAdmissionIdentitySchema
>;

const persistedThreadCommandAdmissionBaseSchema = z
  .object({
    threadId: z.string().min(1),
    requestId: clientTurnRequestIdSchema,
    commandKind: threadCommandKindSchema,
    requestFingerprint: threadCommandRequestFingerprintSchema,
    admissionSequence: z.number().int().positive(),
    actor: actorStampSchema,
    result: threadCommandAdmissionResultSchema,
    createdAt: z.number().int().nonnegative(),
    completedAt: z.number().int().nonnegative(),
  })
  .strict();

export const persistedThreadCommandAdmissionSchema =
  persistedThreadCommandAdmissionBaseSchema.superRefine(
    (admission, context) => {
      const parsed = threadCommandAdmissionCommandResultSchema.safeParse({
        commandKind: admission.commandKind,
        result: admission.result,
      });
      if (!parsed.success) {
        context.addIssue({
          code: "custom",
          message: `Result disposition ${admission.result.disposition} is invalid for ${admission.commandKind}`,
          path: ["result", "disposition"],
        });
      }
    },
  );
export type PersistedThreadCommandAdmission = z.infer<
  typeof persistedThreadCommandAdmissionSchema
>;

export function parseThreadCommandRequestFingerprint(
  value: unknown,
): ThreadCommandRequestFingerprint {
  return threadCommandRequestFingerprintSchema.parse(value);
}

export function parseThreadCommandAdmissionResult(
  value: unknown,
): ThreadCommandAdmissionResult {
  return threadCommandAdmissionResultSchema.parse(value);
}

export function parseThreadCommandAdmissionResultForKind(
  commandKind: ThreadCommandKind,
  value: unknown,
): ThreadCommandAdmissionResult {
  return threadCommandAdmissionCommandResultSchema.parse({
    commandKind,
    result: value,
  }).result;
}

export function parsePersistedThreadCommandAdmission(
  value: unknown,
): PersistedThreadCommandAdmission {
  return persistedThreadCommandAdmissionSchema.parse(value);
}

export function threadCommandAdmissionIdentitiesEqual(
  a: ThreadCommandAdmissionIdentity,
  b: ThreadCommandAdmissionIdentity,
): boolean {
  return (
    a.threadId === b.threadId &&
    a.requestId === b.requestId &&
    a.commandKind === b.commandKind &&
    a.requestFingerprint === b.requestFingerprint &&
    a.actorPrincipalId === b.actorPrincipalId &&
    a.actorPrincipalKind === b.actorPrincipalKind
  );
}

export function threadCommandAdmissionIdentityFromActor(args: {
  threadId: string;
  requestId: ClientTurnRequestId;
  commandKind: ThreadCommandKind;
  requestFingerprint: ThreadCommandRequestFingerprint;
  actor: ActorStamp;
}): ThreadCommandAdmissionIdentity {
  return threadCommandAdmissionIdentitySchema.parse({
    threadId: args.threadId,
    requestId: args.requestId,
    commandKind: args.commandKind,
    requestFingerprint: args.requestFingerprint,
    actorPrincipalId: args.actor.principalId,
    actorPrincipalKind: args.actor.principalKind,
  });
}
