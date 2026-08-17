import { describe, expect, it, vi } from "vitest";

import { RoomDistributionUnavailableError } from "../../src/room-distribution/room-distribution-port.js";
import {
  deriveWorkTogetherRoomSubagentAttentionV1,
  deriveWorkTogetherRoomSubagentCapabilitiesV1,
  deriveWorkTogetherRoomSubagentLifecycleV1,
  projectWorkTogetherRoomSubagentPublicContract,
  type ProjectWorkTogetherRoomSubagentPublicContractInputV1,
  type RoomSubagentLifecycleV1,
  type RoomSubagentV1,
  type WorkTogetherRoomSubagentPublicAttachmentInputV1,
  type WorkTogetherRoomSubagentPublicThreadFactsV1,
} from "../../src/room-distribution/work-together-room-subagent-public-contract.js";
import type { WorkTogetherRoomCommandAuthorityV1 } from "../../src/room-distribution/work-together-room-command-authority.js";

const BINDING_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DIRECT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NESTED_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PRIVATE_THREAD_ID = "thr_private_subagent_001";
const NESTED_PRIVATE_THREAD_ID = "thr_private_subagent_002";
const ENVIRONMENT_ID = "env_private_test_001";
const PROJECT_ID = "prj_private_test_001";
const OWNER: WorkTogetherRoomCommandAuthorityV1 = Object.freeze({
  isTaskAssignee: true,
  role: "owner",
});
const MEMBER: WorkTogetherRoomCommandAuthorityV1 = Object.freeze({
  isTaskAssignee: false,
  role: "member",
});
const SUBAGENT_KEYS = [
  "schemaVersion",
  "id",
  "parent",
  "label",
  "summary",
  "lifecycle",
  "attention",
  "capabilities",
] as const;
const FORBIDDEN_KEYS = [
  "parentId",
  "run",
  "cursor",
  "stream",
  "child",
  "subagent",
];

function attachmentId(index: number): string {
  return `dddddddd-dddd-4ddd-8ddd-${index.toString(16).padStart(12, "0")}`;
}

function threadFacts(
  overrides: Partial<WorkTogetherRoomSubagentPublicThreadFactsV1> = {},
): WorkTogetherRoomSubagentPublicThreadFactsV1 {
  return {
    archivedAt: null,
    attention: "none",
    latestPublicAssistantExcerpt: null,
    latestRootTurnOutcome: null,
    privateThreadId: PRIVATE_THREAD_ID,
    status: "idle",
    title: "Review the patch",
    titleFallback: "Untitled subagent",
    ...overrides,
  };
}

function attachment(
  overrides: Partial<WorkTogetherRoomSubagentPublicAttachmentInputV1> &
    Pick<WorkTogetherRoomSubagentPublicAttachmentInputV1, "id">,
): WorkTogetherRoomSubagentPublicAttachmentInputV1 {
  return {
    parent: { kind: "primary" },
    thread: threadFacts(),
    ...overrides,
  };
}

function input(
  overrides: Partial<ProjectWorkTogetherRoomSubagentPublicContractInputV1> = {},
): ProjectWorkTogetherRoomSubagentPublicContractInputV1 {
  return {
    attachments: [attachment({ id: DIRECT_ID })],
    authority: OWNER,
    bindingId: BINDING_ID,
    environmentId: ENVIRONMENT_ID,
    projectId: PROJECT_ID,
    ...overrides,
  };
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (value === null || typeof value !== "object") return keys;
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, keys);
    return keys;
  }
  for (const [key, subagent] of Object.entries(value)) {
    keys.add(key);
    collectKeys(subagent, keys);
  }
  return keys;
}

function assertExactSubagentShape(subagent: RoomSubagentV1): void {
  expect(Object.keys(subagent)).toEqual([...SUBAGENT_KEYS]);
  expect(Object.keys(subagent.parent)).toEqual(["kind", "id"]);
  expect(Object.keys(subagent.attention)).toEqual(["kind"]);
}

describe("Work Together Room subagent public contract", () => {
  it("projects one direct and one nested attachment as the exact RoomSubagentV1 DTO", () => {
    const subagents = projectWorkTogetherRoomSubagentPublicContract(
      input({
        attachments: [
          attachment({
            id: DIRECT_ID,
            thread: threadFacts({
              attention: "question",
              latestPublicAssistantExcerpt: "The tests pass.",
              status: "active",
              title: "Review the patch",
            }),
          }),
          attachment({
            id: NESTED_ID,
            parent: { kind: "subagent", id: DIRECT_ID },
            thread: threadFacts({
              latestRootTurnOutcome: "completed",
              privateThreadId: NESTED_PRIVATE_THREAD_ID,
              status: "idle",
              title: null,
              titleFallback: "Nested fallback title",
            }),
          }),
        ],
      }),
    );

    expect(subagents).toEqual([
      {
        schemaVersion: 1,
        id: DIRECT_ID,
        parent: { kind: "primary", id: BINDING_ID },
        label: "Review the patch",
        summary: "The tests pass.",
        lifecycle: "running",
        attention: { kind: "question" },
        capabilities: [
          "message.send",
          "message.steer",
          "agent.interrupt",
          "interaction.answer",
        ],
      },
      {
        schemaVersion: 1,
        id: NESTED_ID,
        parent: { kind: "subagent", id: DIRECT_ID },
        label: "Nested fallback title",
        summary: null,
        lifecycle: "completed",
        attention: { kind: "none" },
        capabilities: ["message.send"],
      },
    ]);
    for (const subagent of subagents) assertExactSubagentShape(subagent);
    const wire = JSON.stringify(subagents);
    expect(wire).not.toContain(PRIVATE_THREAD_ID);
    expect(wire).not.toContain(NESTED_PRIVATE_THREAD_ID);
    expect(wire).not.toContain(ENVIRONMENT_ID);
    expect(wire).not.toContain(PROJECT_ID);
  });

  it("derives every lifecycle from thread plus latest root-turn facts", () => {
    const cases: readonly {
      lifecycle: RoomSubagentLifecycleV1;
      thread: Partial<WorkTogetherRoomSubagentPublicThreadFactsV1>;
    }[] = [
      { lifecycle: "created", thread: { status: "idle" } },
      { lifecycle: "starting", thread: { status: "starting" } },
      { lifecycle: "running", thread: { status: "active" } },
      { lifecycle: "stopping", thread: { status: "stopping" } },
      { lifecycle: "failed", thread: { status: "error" } },
      {
        lifecycle: "failed",
        thread: { latestRootTurnOutcome: "failed", status: "idle" },
      },
      {
        lifecycle: "completed",
        thread: { latestRootTurnOutcome: "completed", status: "idle" },
      },
      {
        lifecycle: "interrupted",
        thread: { latestRootTurnOutcome: "interrupted", status: "idle" },
      },
      {
        lifecycle: "archived",
        thread: { archivedAt: 1, status: "idle" },
      },
    ];
    for (const [index, testCase] of cases.entries()) {
      const subagents = projectWorkTogetherRoomSubagentPublicContract(
        input({
          attachments: [
            attachment({
              id: attachmentId(index),
              thread: threadFacts(testCase.thread),
            }),
          ],
        }),
      );
      expect(subagents[0]?.lifecycle).toBe(testCase.lifecycle);
      expect(
        deriveWorkTogetherRoomSubagentLifecycleV1(threadFacts(testCase.thread)),
      ).toBe(testCase.lifecycle);
    }
  });

  it("accepts question and approval attention only on live execution states", () => {
    const question = projectWorkTogetherRoomSubagentPublicContract(
      input({
        attachments: [
          attachment({
            id: DIRECT_ID,
            thread: threadFacts({ attention: "question", status: "starting" }),
          }),
        ],
      }),
    );
    const approval = projectWorkTogetherRoomSubagentPublicContract(
      input({
        attachments: [
          attachment({
            id: DIRECT_ID,
            thread: threadFacts({ attention: "approval", status: "stopping" }),
          }),
        ],
      }),
    );
    expect(question[0]?.attention).toEqual({ kind: "question" });
    expect(approval[0]?.attention).toEqual({ kind: "approval" });
    expect(() =>
      projectWorkTogetherRoomSubagentPublicContract(
        input({
          attachments: [
            attachment({
              id: DIRECT_ID,
              thread: threadFacts({
                attention: "question",
                latestRootTurnOutcome: "completed",
                status: "idle",
              }),
            }),
          ],
        }),
      ),
    ).toThrow(RoomDistributionUnavailableError);
    expect(() =>
      deriveWorkTogetherRoomSubagentAttentionV1(["question", "approval"]),
    ).toThrow(RoomDistributionUnavailableError);
    expect(() =>
      deriveWorkTogetherRoomSubagentAttentionV1(["question", "question"]),
    ).toThrow(RoomDistributionUnavailableError);
    expect(deriveWorkTogetherRoomSubagentAttentionV1([])).toBe("none");
    expect(deriveWorkTogetherRoomSubagentAttentionV1(["approval"])).toBe(
      "approval",
    );
  });

  it("derives canonical capabilities from lifecycle, interaction, and principal authority", () => {
    expect(
      deriveWorkTogetherRoomSubagentCapabilitiesV1({
        attention: "none",
        authority: OWNER,
        lifecycle: "created",
      }),
    ).toEqual(["message.send"]);
    expect(
      deriveWorkTogetherRoomSubagentCapabilitiesV1({
        attention: "none",
        authority: OWNER,
        lifecycle: "starting",
      }),
    ).toEqual(["agent.interrupt"]);
    expect(
      deriveWorkTogetherRoomSubagentCapabilitiesV1({
        attention: "question",
        authority: OWNER,
        lifecycle: "running",
      }),
    ).toEqual([
      "message.send",
      "message.steer",
      "agent.interrupt",
      "interaction.answer",
    ]);
    expect(
      deriveWorkTogetherRoomSubagentCapabilitiesV1({
        attention: "approval",
        authority: OWNER,
        lifecycle: "running",
      }),
    ).toEqual([
      "message.send",
      "message.steer",
      "agent.interrupt",
      "interaction.approve",
    ]);
    expect(
      deriveWorkTogetherRoomSubagentCapabilitiesV1({
        attention: "question",
        authority: MEMBER,
        lifecycle: "running",
      }),
    ).toEqual(["message.send", "message.steer", "interaction.answer"]);
    expect(
      deriveWorkTogetherRoomSubagentCapabilitiesV1({
        attention: "approval",
        authority: MEMBER,
        lifecycle: "running",
      }),
    ).toEqual(["message.send", "message.steer"]);
    expect(
      deriveWorkTogetherRoomSubagentCapabilitiesV1({
        attention: "none",
        authority: OWNER,
        lifecycle: "failed",
      }),
    ).toEqual([]);
    const failedIdle = projectWorkTogetherRoomSubagentPublicContract(
      input({
        attachments: [
          attachment({
            id: DIRECT_ID,
            thread: threadFacts({
              latestRootTurnOutcome: "failed",
              status: "idle",
            }),
          }),
        ],
      }),
    );
    expect(failedIdle[0]?.lifecycle).toBe("failed");
    expect(failedIdle[0]?.capabilities).toEqual([]);
  });

  it("uses title fallback and a whitespace-collapsed already-public assistant excerpt", () => {
    const subagents = projectWorkTogetherRoomSubagentPublicContract(
      input({
        attachments: [
          attachment({
            id: DIRECT_ID,
            thread: threadFacts({
              latestPublicAssistantExcerpt: "  Hello   \n  world  ",
              title: null,
              titleFallback: "Draft subagent",
            }),
          }),
        ],
      }),
    );
    expect(subagents[0]).toMatchObject({
      label: "Draft subagent",
      summary: "Hello world",
    });
  });

  it("sanitizes NFC, control, blank, oversize, and private-ID adversarial strings", () => {
    const nfc = projectWorkTogetherRoomSubagentPublicContract(
      input({
        attachments: [
          attachment({
            id: DIRECT_ID,
            thread: threadFacts({
              latestPublicAssistantExcerpt: "cafe\u0301",
              title: "e\u0301tude",
            }),
          }),
        ],
      }),
    );
    expect(nfc[0]).toMatchObject({ label: "étude", summary: "café" });

    const unsafe = projectWorkTogetherRoomSubagentPublicContract(
      input({
        attachments: [
          attachment({
            id: DIRECT_ID,
            thread: threadFacts({
              latestPublicAssistantExcerpt: "secret\u0000tail",
              title: "   ",
              titleFallback: "x".repeat(161),
            }),
          }),
        ],
      }),
    );
    expect(unsafe[0]).toMatchObject({
      label: "Untitled subagent",
      summary: null,
    });
    expect(JSON.stringify(unsafe)).not.toContain("secret");

    const scrubbed = projectWorkTogetherRoomSubagentPublicContract(
      input({
        attachments: [
          attachment({
            id: DIRECT_ID,
            thread: threadFacts({
              latestPublicAssistantExcerpt: `${PRIVATE_THREAD_ID} ${ENVIRONMENT_ID} ${PROJECT_ID}`,
              title: `${PRIVATE_THREAD_ID} work`,
            }),
          }),
        ],
      }),
    );
    expect(scrubbed[0]).toMatchObject({
      label: `${DIRECT_ID} work`,
      summary: `${DIRECT_ID} ${BINDING_ID}:environment ${BINDING_ID}:project`,
    });
    const wire = JSON.stringify(scrubbed);
    expect(wire).not.toContain(PRIVATE_THREAD_ID);
    expect(wire).not.toContain(ENVIRONMENT_ID);
    expect(wire).not.toContain(PROJECT_ID);
  });

  it("fails closed on duplicate, orphan, cycle, depth-five, 65, and byte overflow", () => {
    expect(() =>
      projectWorkTogetherRoomSubagentPublicContract(
        input({
          attachments: [
            attachment({ id: DIRECT_ID }),
            attachment({ id: DIRECT_ID }),
          ],
        }),
      ),
    ).toThrow(RoomDistributionUnavailableError);

    expect(() =>
      projectWorkTogetherRoomSubagentPublicContract(
        input({
          attachments: [
            attachment({
              id: NESTED_ID,
              parent: { kind: "subagent", id: DIRECT_ID },
            }),
          ],
        }),
      ),
    ).toThrow(RoomDistributionUnavailableError);

    expect(() =>
      projectWorkTogetherRoomSubagentPublicContract(
        input({
          attachments: [
            attachment({
              id: DIRECT_ID,
              parent: { kind: "subagent", id: NESTED_ID },
            }),
            attachment({
              id: NESTED_ID,
              parent: { kind: "subagent", id: DIRECT_ID },
            }),
          ],
        }),
      ),
    ).toThrow(RoomDistributionUnavailableError);

    const depthChain: WorkTogetherRoomSubagentPublicAttachmentInputV1[] = [
      attachment({ id: attachmentId(0) }),
    ];
    for (let depth = 1; depth <= 4; depth += 1) {
      depthChain.push(
        attachment({
          id: attachmentId(depth),
          parent: { kind: "subagent", id: attachmentId(depth - 1) },
        }),
      );
    }
    expect(() =>
      projectWorkTogetherRoomSubagentPublicContract(
        input({ attachments: depthChain }),
      ),
    ).toThrow(RoomDistributionUnavailableError);
    expect(
      projectWorkTogetherRoomSubagentPublicContract(
        input({ attachments: depthChain.slice(0, 4) }),
      ),
    ).toHaveLength(4);

    expect(() =>
      projectWorkTogetherRoomSubagentPublicContract(
        input({
          attachments: Array.from({ length: 65 }, (_, index) =>
            attachment({ id: attachmentId(index) }),
          ),
        }),
      ),
    ).toThrow(RoomDistributionUnavailableError);
    expect(
      projectWorkTogetherRoomSubagentPublicContract(
        input({
          attachments: Array.from({ length: 64 }, (_, index) =>
            attachment({ id: attachmentId(index) }),
          ),
        }),
      ),
    ).toHaveLength(64);

    const stringify = vi
      .spyOn(JSON, "stringify")
      .mockReturnValue("x".repeat(131_073));
    try {
      expect(() =>
        projectWorkTogetherRoomSubagentPublicContract(input()),
      ).toThrow(RoomDistributionUnavailableError);
    } finally {
      stringify.mockRestore();
    }
  });

  it("preserves authority-received order and emits the exact unavailable object", () => {
    const later = attachmentId(2);
    const earlier = attachmentId(1);
    const ordered = projectWorkTogetherRoomSubagentPublicContract(
      input({
        attachments: [attachment({ id: later }), attachment({ id: earlier })],
      }),
    );
    expect(ordered.map((subagent) => subagent.id)).toEqual([later, earlier]);

    const missing = projectWorkTogetherRoomSubagentPublicContract(
      input({
        attachments: [
          attachment({
            id: DIRECT_ID,
            thread: null,
          }),
        ],
      }),
    );
    expect(missing).toEqual([
      {
        schemaVersion: 1,
        id: DIRECT_ID,
        parent: { kind: "primary", id: BINDING_ID },
        label: "Untitled subagent",
        summary: null,
        lifecycle: "unavailable",
        attention: { kind: "none" },
        capabilities: [],
      },
    ]);
    assertExactSubagentShape(missing[0]!);
  });

  it("scans exact keys and omits current partial fields and raw private IDs", () => {
    const subagents = projectWorkTogetherRoomSubagentPublicContract(
      input({
        attachments: [
          attachment({
            id: DIRECT_ID,
            thread: threadFacts({
              attention: "approval",
              latestPublicAssistantExcerpt: "Ready.",
              status: "active",
              title: `${PRIVATE_THREAD_ID} ${ENVIRONMENT_ID} ${PROJECT_ID}`,
            }),
          }),
          attachment({
            id: NESTED_ID,
            parent: { kind: "subagent", id: DIRECT_ID },
            thread: null,
          }),
        ],
      }),
    );
    expect(JSON.stringify(subagents)).toEqual(
      JSON.stringify([
        {
          schemaVersion: 1,
          id: DIRECT_ID,
          parent: { kind: "primary", id: BINDING_ID },
          label: `${DIRECT_ID} ${BINDING_ID}:environment ${BINDING_ID}:project`,
          summary: "Ready.",
          lifecycle: "running",
          attention: { kind: "approval" },
          capabilities: [
            "message.send",
            "message.steer",
            "agent.interrupt",
            "interaction.approve",
          ],
        },
        {
          schemaVersion: 1,
          id: NESTED_ID,
          parent: { kind: "subagent", id: DIRECT_ID },
          label: "Untitled subagent",
          summary: null,
          lifecycle: "unavailable",
          attention: { kind: "none" },
          capabilities: [],
        },
      ]),
    );
    const keys = collectKeys(subagents);
    expect([...keys].sort()).toEqual(
      [
        "attention",
        "capabilities",
        "id",
        "kind",
        "label",
        "lifecycle",
        "parent",
        "schemaVersion",
        "summary",
      ].sort(),
    );
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.has(forbidden)).toBe(false);
    }
    const wire = JSON.stringify(subagents);
    expect(wire).not.toContain(PRIVATE_THREAD_ID);
    expect(wire).not.toContain(ENVIRONMENT_ID);
    expect(wire).not.toContain(PROJECT_ID);
    expect(wire).not.toContain('"parentId"');
    expect(wire).not.toContain('"run"');
    expect(wire).not.toContain('"cursor"');
    expect(wire).not.toContain('"stream"');
    expect(wire).not.toContain('"child"');
  });
});
