import { describe, expect, it } from "vitest";
import {
  canStartSentMessageEdit,
  shouldDiscardSentMessageEdit,
  type SentMessageEditAvailability,
} from "./sentMessageEdit";

const ELIGIBLE_STATE: SentMessageEditAvailability = {
  activeBackgroundAgentCount: 0,
  activeBackgroundCommandCount: 0,
  activeWorkflowCount: 0,
  archivedAt: null,
  deletedAt: null,
  hasPendingInteraction: false,
  isExperimentEnabled: true,
  isEditSessionActive: false,
  isMutationPending: false,
  isTimelinePending: false,
  queuedMessageCount: 0,
  providerId: "codex",
  runtimeDisplayStatus: "idle",
};

describe("canStartSentMessageEdit", () => {
  it("allows an idle supported-provider thread with no competing activity", () => {
    expect(canStartSentMessageEdit(ELIGIBLE_STATE)).toBe(true);
  });

  it.each([
    ["another provider", { providerId: "opencode" }],
    ["a disabled experiment", { isExperimentEnabled: false }],
    ["an active runtime", { runtimeDisplayStatus: "active" as const }],
    ["an archived thread", { archivedAt: 1 }],
    ["a pending interaction", { hasPendingInteraction: true }],
    ["an active workflow", { activeWorkflowCount: 1 }],
    ["an active background agent", { activeBackgroundAgentCount: 1 }],
    ["an active background command", { activeBackgroundCommandCount: 1 }],
    ["an existing edit session", { isEditSessionActive: true }],
    ["another message mutation", { isMutationPending: true }],
    ["a queued message", { queuedMessageCount: 1 }],
  ])("rejects %s", (_label, override) => {
    expect(canStartSentMessageEdit({ ...ELIGIBLE_STATE, ...override })).toBe(
      false,
    );
  });
});

describe("shouldDiscardSentMessageEdit", () => {
  it("preserves a parked draft while another thread is open", () => {
    expect(
      shouldDiscardSentMessageEdit({
        currentThreadId: "thread-2",
        editThreadId: "thread-1",
        isTimelineLoading: false,
        targetStillPresent: false,
      }),
    ).toBe(false);
  });

  it("waits for the edited thread timeline before deciding the row is gone", () => {
    expect(
      shouldDiscardSentMessageEdit({
        currentThreadId: "thread-1",
        editThreadId: "thread-1",
        isTimelineLoading: true,
        targetStillPresent: false,
      }),
    ).toBe(false);
  });

  it("discards only after the target is absent from the loaded edited thread", () => {
    expect(
      shouldDiscardSentMessageEdit({
        currentThreadId: "thread-1",
        editThreadId: "thread-1",
        isTimelineLoading: false,
        targetStillPresent: false,
      }),
    ).toBe(true);
  });
});
