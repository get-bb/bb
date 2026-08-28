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

type ChangedOption = StrictChangedOption | LenientChangedOption;

const changedEntities = [
  "thread",
  "project",
  "environment",
  "host",
  "system",
] as const;

function changedOptionEntity(option: ChangedOption): string {
  for (const entity of changedEntities) {
    if (option.safeParse({ type: "changed", entity, changes: [] }).success) {
      return entity;
    }
  }
  throw new Error("The changed schema has no known entity");
}

function changedOptionFields(option: ChangedOption): string[] {
  return [...option.keyof().options].sort();
}

function strictOptionsByEntity(): Map<string, StrictChangedOption> {
  const options = new Map<string, StrictChangedOption>();
  for (const option of changedMessageSchema.options) {
    options.set(changedOptionEntity(option), option);
  }
  return options;
}

function lenientOptionsByEntity(): Map<string, LenientChangedOption> {
  const options = new Map<string, LenientChangedOption>();
  for (const option of changedMessageLenientSchema.options) {
    options.set(changedOptionEntity(option), option);
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
      expect(changedOptionFields(lenientOption), entity).toEqual(
        changedOptionFields(strictOption),
      );
    }
  });

  it.each(maximalChangedMessages)(
    "lenient parse preserves a maximal strict $entity message",
    (message) => {
      expect(changedMessageSchema.parse(message)).toEqual(message);
      expect(changedMessageLenientSchema.parse(message)).toEqual(message);
    },
  );

  it("drops a status change a stale client cannot parse but keeps the message", () => {
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
        changedOptionFields(strictOption),
      );
    }
    expect(Object.keys(maximalThreadMetadata).sort()).toEqual(
      [...threadChangeMetadataSchema.keyof().options].sort(),
    );
  });
});
