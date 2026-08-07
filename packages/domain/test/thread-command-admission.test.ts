import { describe, expect, it } from "vitest";
import {
  parsePersistedThreadCommandAdmission,
  parseThreadCommandAdmissionReference,
  parseThreadCommandAdmissionResultForKind,
  parseThreadCommandAdmissionResult,
  threadCommandRequestFingerprintSchema,
  threadCommandAdmissionIdentitiesEqual,
  threadCommandAdmissionResultSchema,
} from "../src/thread-command-admission.js";
import { encodeClientTurnRequestIdNumber } from "../src/protocol-ids.js";
import { turnRequestEventDataSchema } from "../src/thread-events.js";

const FINGERPRINT_A = threadCommandRequestFingerprintSchema.parse(
  `sha256:${"a".repeat(64)}`,
);
const FINGERPRINT_B = threadCommandRequestFingerprintSchema.parse(
  `sha256:${"b".repeat(64)}`,
);

describe("thread command admission schemas", () => {
  it("accepts each terminal result disposition with typed pointers", () => {
    expect(
      threadCommandAdmissionResultSchema.parse({
        disposition: "started",
        eventSequence: 1,
      }),
    ).toEqual({ disposition: "started", eventSequence: 1 });

    expect(
      threadCommandAdmissionResultSchema.parse({
        disposition: "queued",
        queuedMessageId: "qmsg_23456789ab",
      }),
    ).toEqual({
      disposition: "queued",
      queuedMessageId: "qmsg_23456789ab",
    });

    expect(
      threadCommandAdmissionResultSchema.parse({
        disposition: "steered",
        eventSequence: 2,
        expectedTurnId: "turn_123",
      }),
    ).toEqual({
      disposition: "steered",
      eventSequence: 2,
      expectedTurnId: "turn_123",
    });

    expect(
      threadCommandAdmissionResultSchema.parse({
        disposition: "interrupted",
        eventSequence: 3,
        expectedTurnId: "turn_123",
      }),
    ).toEqual({
      disposition: "interrupted",
      eventSequence: 3,
      expectedTurnId: "turn_123",
    });

    expect(
      threadCommandAdmissionResultSchema.parse({
        disposition: "answered",
        interactionId: "pi_answer_1",
      }),
    ).toEqual({
      disposition: "answered",
      interactionId: "pi_answer_1",
    });

    expect(
      threadCommandAdmissionResultSchema.parse({
        disposition: "approved",
        interactionId: "pi_approve_1",
      }),
    ).toEqual({
      disposition: "approved",
      interactionId: "pi_approve_1",
    });

    expect(
      threadCommandAdmissionResultSchema.parse({
        disposition: "marked",
        readCursor: "evt_cursor_1",
      }),
    ).toEqual({
      disposition: "marked",
      readCursor: "evt_cursor_1",
    });
  });

  it("rejects malformed fingerprints and mixed pointer shapes", () => {
    expect(
      threadCommandRequestFingerprintSchema.safeParse("sha256:ABC").success,
    ).toBe(false);
    expect(
      threadCommandAdmissionResultSchema.safeParse({
        disposition: "started",
        queuedMessageId: "qmsg_23456789ab",
      }).success,
    ).toBe(false);
    expect(
      threadCommandAdmissionResultSchema.safeParse({
        disposition: "queued",
        eventSequence: 1,
      }).success,
    ).toBe(false);
    expect(
      threadCommandAdmissionResultSchema.safeParse({
        disposition: "steered",
        eventSequence: 1,
        expectedTurnId: null,
      }).success,
    ).toBe(false);
    expect(
      threadCommandAdmissionResultSchema.safeParse({
        disposition: "interrupted",
        eventSequence: 1,
      }).success,
    ).toBe(false);
    expect(
      threadCommandAdmissionResultSchema.safeParse({
        disposition: "answered",
        readCursor: "evt_cursor_1",
      }).success,
    ).toBe(false);
    expect(
      threadCommandAdmissionResultSchema.safeParse({
        disposition: "approved",
        interactionId: "pi_1",
        eventSequence: 1,
      }).success,
    ).toBe(false);
    expect(
      threadCommandAdmissionResultSchema.safeParse({
        disposition: "marked",
        interactionId: "pi_1",
      }).success,
    ).toBe(false);
    expect(
      threadCommandAdmissionResultSchema.safeParse({
        disposition: "marked",
        readCursor: "",
      }).success,
    ).toBe(false);
  });

  it("rejects terminal results that do not match the admitted command kind", () => {
    expect(
      parseThreadCommandAdmissionResultForKind("message.send", {
        disposition: "queued",
        queuedMessageId: "qmsg_23456789ab",
      }),
    ).toEqual({
      disposition: "queued",
      queuedMessageId: "qmsg_23456789ab",
    });
    expect(() =>
      parseThreadCommandAdmissionResultForKind("message.send", {
        disposition: "interrupted",
        eventSequence: 1,
        expectedTurnId: "turn_123",
      }),
    ).toThrow();
    expect(
      parseThreadCommandAdmissionResultForKind("interaction.answer", {
        disposition: "answered",
        interactionId: "pi_1",
      }),
    ).toEqual({ disposition: "answered", interactionId: "pi_1" });
    expect(() =>
      parseThreadCommandAdmissionResultForKind("interaction.answer", {
        disposition: "approved",
        interactionId: "pi_1",
      }),
    ).toThrow();
    expect(
      parseThreadCommandAdmissionResultForKind("interaction.approve", {
        disposition: "approved",
        interactionId: "pi_2",
      }),
    ).toEqual({ disposition: "approved", interactionId: "pi_2" });
    expect(() =>
      parseThreadCommandAdmissionResultForKind("interaction.approve", {
        disposition: "answered",
        interactionId: "pi_2",
      }),
    ).toThrow();
    expect(
      parseThreadCommandAdmissionResultForKind("read.mark", {
        disposition: "marked",
        readCursor: "evt_1",
      }),
    ).toEqual({ disposition: "marked", readCursor: "evt_1" });
    expect(() =>
      parseThreadCommandAdmissionResultForKind("read.mark", {
        disposition: "answered",
        interactionId: "pi_3",
      }),
    ).toThrow();
  });

  it("parses persisted admissions with client turn request ids", () => {
    const requestId = encodeClientTurnRequestIdNumber({ value: 42 });
    const admission = {
      threadId: "thr_23456789ab",
      requestId,
      commandKind: "message.send",
      requestFingerprint: FINGERPRINT_A,
      admissionSequence: 1,
      actor: {
        principalId: "human:alice",
        principalKind: "human",
        displayName: "Alice",
      },
      result: {
        disposition: "started",
        eventSequence: 10,
      },
      createdAt: 1_000,
      completedAt: 1_000,
    };

    expect(parseThreadCommandAdmissionResult(admission.result)).toEqual(
      admission.result,
    );
    expect(parsePersistedThreadCommandAdmission(admission)).toEqual(admission);
    expect(() =>
      parsePersistedThreadCommandAdmission({
        ...admission,
        result: {
          disposition: "interrupted",
          eventSequence: 10,
          expectedTurnId: "turn_123",
        },
      }),
    ).toThrow();
  });

  it("parses and rejects incomplete admission references", () => {
    const requestId = encodeClientTurnRequestIdNumber({ value: 7 });
    expect(
      parseThreadCommandAdmissionReference({
        requestId,
        requestFingerprint: FINGERPRINT_A,
        admissionSequence: 3,
      }),
    ).toEqual({
      requestId,
      requestFingerprint: FINGERPRINT_A,
      admissionSequence: 3,
    });
    expect(() =>
      parseThreadCommandAdmissionReference({
        requestId,
        requestFingerprint: FINGERPRINT_A,
      }),
    ).toThrow();
    expect(() =>
      parseThreadCommandAdmissionReference({
        requestId,
        admissionSequence: 1,
      }),
    ).toThrow();
  });

  it("compares admission identity without display names", () => {
    const requestId = encodeClientTurnRequestIdNumber({ value: 1 });
    const base = {
      threadId: "thr_23456789ab",
      requestId,
      commandKind: "message.send" as const,
      requestFingerprint: FINGERPRINT_A,
      actorPrincipalId: "human:alice",
      actorPrincipalKind: "human" as const,
    };

    expect(threadCommandAdmissionIdentitiesEqual(base, base)).toBe(true);
    expect(
      threadCommandAdmissionIdentitiesEqual(base, {
        ...base,
        requestFingerprint: FINGERPRINT_B,
      }),
    ).toBe(false);
    expect(
      threadCommandAdmissionIdentitiesEqual(base, {
        ...base,
        actorPrincipalId: "human:bob",
      }),
    ).toBe(false);
  });

  it("requires admissionSequence and requestFingerprint together on turn requests", () => {
    const requestId = encodeClientTurnRequestIdNumber({ value: 9 });
    const base = {
      direction: "outbound" as const,
      requestId,
      source: "tell" as const,
      initiator: "user" as const,
      senderThreadId: null,
      input: [{ type: "text" as const, text: "hi", mentions: [] }],
      target: { kind: "new-turn" as const },
      request: { method: "turn/start" as const, params: {} },
      execution: {
        model: "gpt-5",
        serviceTier: "default" as const,
        reasoningLevel: "medium" as const,
        permissionMode: "full" as const,
        source: "client/turn/requested" as const,
      },
    };

    expect(
      turnRequestEventDataSchema.parse(base).admissionSequence,
    ).toBeUndefined();
    expect(
      turnRequestEventDataSchema.parse({
        ...base,
        admissionSequence: 2,
        requestFingerprint: FINGERPRINT_A,
      }),
    ).toMatchObject({
      admissionSequence: 2,
      requestFingerprint: FINGERPRINT_A,
    });
    expect(
      turnRequestEventDataSchema.safeParse({
        ...base,
        admissionSequence: 2,
      }).success,
    ).toBe(false);
    expect(
      turnRequestEventDataSchema.safeParse({
        ...base,
        requestFingerprint: FINGERPRINT_A,
      }).success,
    ).toBe(false);
  });
});
