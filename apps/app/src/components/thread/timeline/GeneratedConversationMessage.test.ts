import { describe, expect, it } from "vitest";
import type { SystemMessageKind, SystemMessageSubject } from "@bb/domain";
import { systemMessageKindValues } from "@bb/domain";
import type { TimelineTitleLink } from "@bb/thread-view";
import {
  generatedConversationTitle,
  systemMessageIconName,
} from "./GeneratedConversationMessage.js";

const threadSubject: SystemMessageSubject = {
  kind: "thread",
  threadId: "thr_child",
  threadName: "Fix auth bug",
};

interface SystemTitleArgs {
  systemMessageKind: SystemMessageKind;
  systemMessageSubject: SystemMessageSubject | null;
}

// The component always supplies the `agent`-only props; the `system` path
// ignores them, so anchor them to inert values for these system-title cases.
function systemTitle({ systemMessageKind, systemMessageSubject }: SystemTitleArgs) {
  return generatedConversationTitle({
    childOrigin: null,
    sourceKind: "system",
    sourceName: "BB",
    sourceThreadId: null,
    sourceIsSideChat: false,
    systemMessageKind,
    systemMessageSubject,
  });
}

function threadLink(threadId: string): TimelineTitleLink {
  return { kind: "thread", threadId };
}

describe("generatedConversationTitle — system source", () => {
  const threadSubjectCases: ReadonlyArray<{
    kind: SystemMessageKind;
    plain: string;
    verb: string;
  }> = [
    { kind: "ownership-assigned", plain: "Fix auth bug assigned to you", verb: "assigned to you" },
    { kind: "ownership-removed", plain: "Fix auth bug unassigned", verb: "unassigned" },
    { kind: "child-needs-attention", plain: "Fix auth bug needs attention", verb: "needs attention" },
    { kind: "child-completed", plain: "Fix auth bug finished", verb: "finished" },
    { kind: "child-failed", plain: "Fix auth bug failed", verb: "failed" },
    { kind: "child-interrupted", plain: "Fix auth bug was interrupted", verb: "was interrupted" },
  ];

  it.each(threadSubjectCases)(
    "$kind links the thread name and appends the verb",
    ({ kind, plain, verb }) => {
      const title = systemTitle({
        systemMessageKind: kind,
        systemMessageSubject: threadSubject,
      });

      expect(title.plain).toBe(plain);
      expect(title.segments).toHaveLength(2);

      const [nameSegment, verbSegment] = title.segments;
      expect(nameSegment.text).toBe("Fix auth bug");
      expect(nameSegment.em).toBe(true);
      expect(nameSegment.link).toEqual(threadLink("thr_child"));

      expect(verbSegment.text).toBe(verb);
      expect(verbSegment.em).toBe(false);
      expect(verbSegment.link).toBeUndefined();
    },
  );

  it("renders the batch form with the count and no link", () => {
    const title = systemTitle({
      systemMessageKind: "child-outcome-batch",
      systemMessageSubject: { kind: "thread-batch", count: 3 },
    });

    expect(title.plain).toBe("3 threads updated");
    expect(title.segments).toHaveLength(1);
    expect(title.segments[0]?.text).toBe("3 threads updated");
    expect(title.segments[0]?.link).toBeUndefined();
  });

  it("falls back to the generic System Message title for unlabeled rows", () => {
    const title = systemTitle({
      systemMessageKind: "unlabeled",
      systemMessageSubject: null,
    });

    expect(title.plain).toBe("System Message");
    expect(title.segments).toHaveLength(1);
    expect(title.segments[0]?.text).toBe("System Message");
    expect(title.segments[0]?.link).toBeUndefined();
  });

  it("falls back to System Message when the subject shape mismatches the kind", () => {
    // Defensive: a `thread`-expecting kind handed a non-thread subject must not
    // throw — it degrades to the generic title.
    const title = systemTitle({
      systemMessageKind: "child-completed",
      systemMessageSubject: { kind: "thread-batch", count: 2 },
    });

    expect(title.plain).toBe("System Message");
  });
});

describe("generatedConversationTitle — agent source", () => {
  it("links the sender thread name (reference pattern, unchanged)", () => {
    const title = generatedConversationTitle({
      childOrigin: null,
      sourceKind: "agent",
      sourceName: "Worker 2",
      sourceThreadId: "thr_sender",
      sourceIsSideChat: false,
      systemMessageKind: "unlabeled",
      systemMessageSubject: null,
    });

    expect(title.plain).toBe("Message from Worker 2");
    expect(title.segments).toHaveLength(2);
    expect(title.segments[1]?.text).toBe("Worker 2");
    expect(title.segments[1]?.link).toEqual(threadLink("thr_sender"));
  });
});


describe("systemMessageIconName", () => {
  // Exhaustive by construction: a `Record<SystemMessageKind, …>` makes TS error
  // if a kind is added without an icon decision, and the loop asserts each
  // kind maps to exactly this glyph (so an accidental icon swap fails review).
  const EXPECTED: Record<SystemMessageKind, string> = {
    "ownership-assigned": "UserRoundPlus",
    "ownership-removed": "UserRound",
    "child-needs-attention": "AlertTriangle",
    "child-completed": "CircleCheck",
    "child-failed": "CircleX",
    "child-interrupted": "AlertCircle",
    "child-outcome-batch": "ListTodo",
    unlabeled: "Info",
  };

  it("maps every system-message kind to its icon", () => {
    for (const kind of systemMessageKindValues) {
      expect(systemMessageIconName(kind)).toBe(EXPECTED[kind]);
    }
  });
});
