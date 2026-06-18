import { describe, expect, it } from "vitest";
import type {
  OwnershipChangeOperationAction,
  SystemThreadInterruptedReason,
  SystemThreadProvisioningStatus,
  ThreadEventRow,
} from "@bb/domain";
import { decodeThreadEventRow } from "../src/index.js";
import {
  finalizeOperationMessage,
  interruptOperationMessage,
  parseOperationMessage,
} from "../src/parse-operation-message.js";
import type { EventProjectionOperationMessage } from "../src/event-projection-types.js";
import { createTimelineEventFactory } from "./timeline-test-harness.js";

const THREAD_ID = "thr_fixauth";
const THREAD_NAME = "Fix auth bug";

function factory() {
  return createTimelineEventFactory({ threadId: THREAD_ID });
}

function operationTitleFor(row: ThreadEventRow, threadName: string): string {
  const { event, meta } = decodeThreadEventRow(row);
  const message = parseOperationMessage(event, meta, { threadName });
  if (message === null || message.kind !== "operation") {
    throw new Error(`expected operation message, got ${message?.kind ?? null}`);
  }
  return message.title;
}

function provisioningTitle(
  status: SystemThreadProvisioningStatus,
  threadName: string,
): string {
  const row = factory().threadProvisioning({ status, entries: [] });
  return operationTitleFor(row, threadName);
}

function interruptedTitle(
  reason: SystemThreadInterruptedReason,
  threadName: string,
): string {
  const row = factory().systemThreadInterrupted({ reason });
  return operationTitleFor(row, threadName);
}

function ownershipTitle(
  action: OwnershipChangeOperationAction,
  parents: {
    nextParentThreadTitle: string | null;
    previousParentThreadTitle: string | null;
  },
  threadName: string,
): string {
  const row = factory().systemOperation({
    operation: "ownership_change",
    status: "completed",
    message: "",
    metadata: {
      action,
      nextParentThreadId: parents.nextParentThreadTitle ? "thr_parent" : null,
      nextParentThreadTitle: parents.nextParentThreadTitle,
      previousParentThreadId: parents.previousParentThreadTitle
        ? "thr_prev"
        : null,
      previousParentThreadTitle: parents.previousParentThreadTitle,
    },
  });
  return operationTitleFor(row, threadName);
}

describe("parseOperationMessage operation titles", () => {
  describe("thread-provisioning", () => {
    it("keeps self-scoped lifecycle titles free of the current thread name", () => {
      expect(provisioningTitle("active", THREAD_NAME)).toBe(
        "Provisioning thread",
      );
      expect(provisioningTitle("completed", THREAD_NAME)).toBe(
        "Provisioned thread",
      );
      expect(provisioningTitle("failed", THREAD_NAME)).toBe(
        "Provisioning thread failed",
      );
      expect(provisioningTitle("cancelled", THREAD_NAME)).toBe(
        "Provisioning thread interrupted",
      );
    });

    it("does not depend on whether the thread is named", () => {
      expect(provisioningTitle("active", "")).toBe("Provisioning thread");
      expect(provisioningTitle("completed", "")).toBe("Provisioned thread");
    });
  });

  describe("thread-interrupted", () => {
    it("does not name or link back to the current thread", () => {
      expect(interruptedTitle("manual-stop", THREAD_NAME)).toBe(
        "Stopped manually",
      );
      expect(interruptedTitle("host-daemon-restarted", THREAD_NAME)).toBe(
        "Stopped — host daemon restarted",
      );
    });
  });

  describe("ownership-change", () => {
    it("links the thread to its new/previous parent by action", () => {
      expect(
        ownershipTitle(
          "assign",
          { nextParentThreadTitle: "Release manager", previousParentThreadTitle: null },
          THREAD_NAME,
        ),
      ).toBe("Fix auth bug assigned to Release manager");
      expect(
        ownershipTitle(
          "release",
          { nextParentThreadTitle: null, previousParentThreadTitle: "Release manager" },
          THREAD_NAME,
        ),
      ).toBe("Fix auth bug released from Release manager");
      expect(
        ownershipTitle(
          "transfer",
          {
            nextParentThreadTitle: "Frontend parent",
            previousParentThreadTitle: "Release manager",
          },
          THREAD_NAME,
        ),
      ).toBe("Fix auth bug transferred to Frontend parent");
    });

    it("falls back to 'parent' when the parent thread title is null", () => {
      expect(
        ownershipTitle(
          "assign",
          { nextParentThreadTitle: null, previousParentThreadTitle: null },
          THREAD_NAME,
        ),
      ).toBe("Fix auth bug assigned to parent");
    });
  });

  describe("post-hoc overrides stay scoped to the current thread", () => {
    function pendingProvisioning(): EventProjectionOperationMessage {
      const row = factory().threadProvisioning({
        status: "active",
        entries: [],
      });
      const { event, meta } = decodeThreadEventRow(row);
      const message = parseOperationMessage(event, meta, {
        threadName: THREAD_NAME,
      });
      if (message === null || message.kind !== "operation") {
        throw new Error("expected operation message");
      }
      return message;
    }

    it("interruptOperationMessage does not add the current thread name", () => {
      const message = pendingProvisioning();
      interruptOperationMessage(message);
      expect(message.title).toBe("Provisioning thread interrupted");
    });

    it("finalizeOperationMessage on error does not add the current thread name", () => {
      const message = pendingProvisioning();
      finalizeOperationMessage(message, {
        threadStatus: "error",
        threadName: THREAD_NAME,
      });
      expect(message.title).toBe("Provisioning thread failed");
    });
  });
});
