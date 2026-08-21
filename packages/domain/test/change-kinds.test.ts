import { describe, expect, it } from "vitest";
import {
  changedMessageLenientSchema,
  changedMessageSchema,
  ENVIRONMENT_CHANGE_KINDS,
  HOST_CHANGE_KINDS,
  PROJECT_CHANGE_KINDS,
  SYSTEM_CHANGE_KINDS,
  THREAD_CHANGE_KINDS,
  threadChangeMetadataSchema,
  type ChangedMessage,
  type ThreadChangeMetadata,
} from "../src/change-kinds.js";
import { threadEventTypeValues } from "../src/provider-event.js";

type StrictChangedOption = (typeof changedMessageSchema.options)[number];
type LenientChangedOption =
  (typeof changedMessageLenientSchema.options)[number];

function strictOptionsByEntity(): Map<string, StrictChangedOption> {
  const options = new Map<string, StrictChangedOption>();
  for (const option of changedMessageSchema.options) {
    options.set(option.shape.entity.value, option);
  }
  return options;
}

function lenientOptionsByEntity(): Map<string, LenientChangedOption> {
  const options = new Map<string, LenientChangedOption>();
  for (const option of changedMessageLenientSchema.options) {
    options.set(option.shape.entity.value, option);
  }
  return options;
}

const maximalThreadMetadata: ThreadChangeMetadata = {
  backgroundActivityChanged: true,
  eventTypes: [...threadEventTypeValues],
  hasPendingInteraction: true,
  projectId: "proj_1",
  statusChange: {
    status: "active",
    runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
    activity: {
      activeBackgroundAgentCount: 1,
      activeBackgroundCommandCount: 1,
      activeGoalCount: 1,
      activePlanModeCount: 1,
      activeWorkflowCount: 1,
    },
    latestAttentionAt: 1_000,
    updatedAt: 2_000,
  },
};

/**
 * One message per entity populating every declared field with every declared
 * change kind. The "fixtures stay maximal" test below forces this list to be
 * updated whenever a strict schema grows a field, so the lenient round-trip
 * can never silently skip a new field.
 */
const maximalChangedMessages: ChangedMessage[] = [
  {
    type: "changed",
    entity: "thread",
    id: "thr_1",
    metadata: maximalThreadMetadata,
    changes: [...THREAD_CHANGE_KINDS],
  },
  {
    type: "changed",
    entity: "project",
    id: "proj_1",
    changes: [...PROJECT_CHANGE_KINDS],
  },
  {
    type: "changed",
    entity: "environment",
    id: "env_1",
    changes: [...ENVIRONMENT_CHANGE_KINDS],
  },
  {
    type: "changed",
    entity: "host",
    id: "host_1",
    changes: [...HOST_CHANGE_KINDS],
  },
  {
    type: "changed",
    entity: "system",
    changes: [...SYSTEM_CHANGE_KINDS],
  },
];

/**
 * Drift guard between the strict outgoing schemas and the hand-maintained
 * lenient inbound twins: a field added to a strict schema but not its lenient
 * counterpart would be silently stripped from every inbound message (zod
 * objects strip unknown keys by default), with no compile or runtime error.
 */
describe("lenient changed-message schema parity", () => {
  it("declares the same entities and field sets as the strict schemas", () => {
    const strictOptions = strictOptionsByEntity();
    const lenientOptions = lenientOptionsByEntity();

    expect([...lenientOptions.keys()].sort()).toEqual(
      [...strictOptions.keys()].sort(),
    );
    for (const [entity, strictOption] of strictOptions) {
      const lenientOption = lenientOptions.get(entity);
      if (!lenientOption) {
        throw new Error(`Missing lenient schema for entity ${entity}`);
      }
      expect(Object.keys(lenientOption.shape).sort(), entity).toEqual(
        Object.keys(strictOption.shape).sort(),
      );
    }
  });

  it.each(maximalChangedMessages)(
    "lenient parse preserves a maximal strict $entity message",
    (message) => {
      // The fixture is valid strict output...
      expect(changedMessageSchema.parse(message)).toEqual(message);
      // ...and the lenient parse must not strip or rewrite any of it.
      expect(changedMessageLenientSchema.parse(message)).toEqual(message);
    },
  );

  it("drops a status change a stale client cannot parse but keeps the message", () => {
    // A newer server may ship a runtime display status this client does not
    // know. The client must still learn that the status changed (and refetch)
    // rather than lose the whole notification.
    const parsed = changedMessageLenientSchema.parse({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      metadata: {
        projectId: "proj_1",
        statusChange: {
          status: "active",
          runtime: {
            displayStatus: "teleporting",
            hostReconnectGraceExpiresAt: null,
          },
          activity: {
            activeBackgroundAgentCount: 0,
            activeBackgroundCommandCount: 0,
            activeGoalCount: 0,
            activePlanModeCount: 0,
            activeWorkflowCount: 0,
          },
          latestAttentionAt: 1_000,
          updatedAt: 2_000,
        },
      },
      changes: ["status-changed"],
    });
    expect(parsed).toEqual({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      metadata: { projectId: "proj_1" },
      changes: ["status-changed"],
    });
  });

  it("keeps the maximal fixtures covering every declared strict field", () => {
    const strictOptions = strictOptionsByEntity();
    expect(maximalChangedMessages.map((message) => message.entity)).toEqual([
      ...strictOptions.keys(),
    ]);
    for (const message of maximalChangedMessages) {
      const strictOption = strictOptions.get(message.entity);
      if (!strictOption) {
        throw new Error(`Missing strict schema for entity ${message.entity}`);
      }
      expect(Object.keys(message).sort(), message.entity).toEqual(
        Object.keys(strictOption.shape).sort(),
      );
    }
    expect(Object.keys(maximalThreadMetadata).sort()).toEqual(
      Object.keys(threadChangeMetadataSchema.shape).sort(),
    );
  });
});
