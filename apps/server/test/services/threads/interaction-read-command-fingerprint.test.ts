import { describe, expect, it } from "vitest";
import {
  BRANCH_PUBLISH_REQUEST_FINGERPRINT_FORMAT_VERSION,
  fingerprintBranchPublishRequest,
  fingerprintInteractionAnswerRequest,
  fingerprintInteractionApproveRequest,
  fingerprintReadMarkRequest,
  INTERACTION_ANSWER_REQUEST_FINGERPRINT_FORMAT_VERSION,
  INTERACTION_APPROVE_REQUEST_FINGERPRINT_FORMAT_VERSION,
  READ_MARK_REQUEST_FINGERPRINT_FORMAT_VERSION,
} from "../../../src/services/threads/message-send-fingerprint.js";

describe("fingerprintInteractionAnswerRequest", () => {
  it("is stable across object key insertion order", () => {
    const left = fingerprintInteractionAnswerRequest({
      resolution: {
        answers: {
          q1: { selected: ["staging"], freeText: "go staging" },
          q2: { selected: ["yes"] },
        },
        kind: "user_answer",
      },
      interactionId: "pi_answer_1",
    });
    const right = fingerprintInteractionAnswerRequest({
      interactionId: "pi_answer_1",
      resolution: {
        kind: "user_answer",
        answers: {
          q2: { selected: ["yes"] },
          q1: { freeText: "go staging", selected: ["staging"] },
        },
      },
    });

    expect(left).toBe(right);
    expect(left).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("conflicts when interactionId or resolution changes", () => {
    const base = fingerprintInteractionAnswerRequest({
      interactionId: "pi_answer_1",
      resolution: {
        kind: "user_answer",
        answers: { q1: { selected: ["staging"] } },
      },
    });
    expect(
      fingerprintInteractionAnswerRequest({
        interactionId: "pi_answer_2",
        resolution: {
          kind: "user_answer",
          answers: { q1: { selected: ["staging"] } },
        },
      }),
    ).not.toBe(base);
    expect(
      fingerprintInteractionAnswerRequest({
        interactionId: "pi_answer_1",
        resolution: {
          kind: "user_answer",
          answers: { q1: { selected: ["prod"] } },
        },
      }),
    ).not.toBe(base);
  });

  it("embeds command kind and format version in the digest", () => {
    expect(INTERACTION_ANSWER_REQUEST_FINGERPRINT_FORMAT_VERSION).toBe(1);
    const withAnswer = fingerprintInteractionAnswerRequest({
      interactionId: "pi_answer_1",
      resolution: {
        kind: "user_answer",
        answers: { q1: { selected: ["a"] } },
      },
    });
    expect(
      fingerprintInteractionApproveRequest({
        interactionId: "pi_answer_1",
        resolution: { decision: "allow_once", grantedPermissions: null },
      }),
    ).not.toBe(withAnswer);
  });
});

describe("fingerprintInteractionApproveRequest", () => {
  it("is stable across object key insertion order", () => {
    const left = fingerprintInteractionApproveRequest({
      resolution: {
        grantedPermissions: {
          network: { enabled: true },
          fileSystem: null,
        },
        decision: "allow_for_session",
      },
      interactionId: "pi_approve_1",
    });
    const right = fingerprintInteractionApproveRequest({
      interactionId: "pi_approve_1",
      resolution: {
        decision: "allow_for_session",
        grantedPermissions: {
          fileSystem: null,
          network: { enabled: true },
        },
      },
    });

    expect(left).toBe(right);
    expect(left).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("conflicts when interactionId or decision changes", () => {
    const base = fingerprintInteractionApproveRequest({
      interactionId: "pi_approve_1",
      resolution: { decision: "allow_once", grantedPermissions: null },
    });
    expect(
      fingerprintInteractionApproveRequest({
        interactionId: "pi_approve_2",
        resolution: { decision: "allow_once", grantedPermissions: null },
      }),
    ).not.toBe(base);
    expect(
      fingerprintInteractionApproveRequest({
        interactionId: "pi_approve_1",
        resolution: { decision: "deny" },
      }),
    ).not.toBe(base);
    expect(INTERACTION_APPROVE_REQUEST_FINGERPRINT_FORMAT_VERSION).toBe(1);
  });
});

describe("fingerprintReadMarkRequest", () => {
  it("is stable across object key insertion order and includes eventCursor", () => {
    const left = fingerprintReadMarkRequest({
      eventCursor: "evt_cursor_42",
    });
    const right = fingerprintReadMarkRequest({
      eventCursor: "evt_cursor_42",
    });

    expect(left).toBe(right);
    expect(left).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(READ_MARK_REQUEST_FINGERPRINT_FORMAT_VERSION).toBe(1);
  });

  it("conflicts when eventCursor changes", () => {
    const base = fingerprintReadMarkRequest({ eventCursor: "evt_1" });
    expect(fingerprintReadMarkRequest({ eventCursor: "evt_2" })).not.toBe(
      base,
    );
  });

  it("rejects empty eventCursor", () => {
    expect(() => fingerprintReadMarkRequest({ eventCursor: "" })).toThrow(
      /eventCursor/u,
    );
  });
});

describe("fingerprintBranchPublishRequest", () => {
  it("is stable for empty optional fields and key order", () => {
    const emptyLeft = fingerprintBranchPublishRequest({});
    const emptyRight = fingerprintBranchPublishRequest();
    expect(emptyLeft).toBe(emptyRight);
    expect(emptyLeft).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(BRANCH_PUBLISH_REQUEST_FINGERPRINT_FORMAT_VERSION).toBe(1);

    const withFieldsLeft = fingerprintBranchPublishRequest({
      body: "body",
      title: "title",
    });
    const withFieldsRight = fingerprintBranchPublishRequest({
      title: "title",
      body: "body",
    });
    expect(withFieldsLeft).toBe(withFieldsRight);
    expect(withFieldsLeft).not.toBe(emptyLeft);
  });

  it("conflicts when title or body changes", () => {
    const base = fingerprintBranchPublishRequest({ title: "a" });
    expect(fingerprintBranchPublishRequest({ title: "b" })).not.toBe(base);
    expect(
      fingerprintBranchPublishRequest({ title: "a", body: "x" }),
    ).not.toBe(base);
  });
});
