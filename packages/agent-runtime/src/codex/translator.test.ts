import { describe, expect, it } from "vitest";
import { turnScope } from "@bb/domain";
import type { ServerNotification as CodexServerNotification } from "./generated/codex-app-server/schema/ServerNotification.js";
import type { Turn } from "./generated/codex-app-server/schema/v2/Turn.js";
import { createCodexEventTranslator } from "./translator.js";

/**
 * Codex translation invariants, driven directly against
 * `createCodexEventTranslator` with app-server events.
 *
 * These four historical fixes live in this module, which both the legacy
 * adapter and the canonical bridge share, but were pinned only by
 * codex/adapter.test.ts — deleted when the legacy adapter graduates. The
 * adapter is a passthrough over `translator.translateEvent`, so the cases move
 * with their assertions intact; the two places the surfaces differ are called
 * out where they matter.
 */

function codexEvent<M extends CodexServerNotification["method"]>(
  method: M,
  params: Extract<CodexServerNotification, { method: M }>["params"],
) {
  return { jsonrpc: "2.0" as const, method, params };
}

function codexTurn(args: {
  id: string;
  status: Turn["status"];
  error: Turn["error"];
}): Turn {
  return {
    id: args.id,
    items: [],
    itemsView: "full",
    status: args.status,
    error: args.error,
    startedAt: 0,
    completedAt: null,
    durationMs: null,
  };
}

function createTranslator() {
  return createCodexEventTranslator({ additionalWorkspaceWriteRoots: [] });
}

// ---------------------------------------------------------------------------
// Command output capture across event reordering (8e7cc5d2e, #1400)
// ---------------------------------------------------------------------------

describe("codex command output capture across reordering", () => {
  const shellCallOpener = codexEvent("rawResponseItem/completed", {
    threadId: "t1",
    turnId: "turn-1",
    item: {
      type: "function_call",
      name: "exec_command",
      arguments: '{"cmd":"echo hi"}',
      call_id: "cmd-1",
    },
  });

  function completedCommand(aggregatedOutput: string) {
    return codexEvent("item/completed", {
      threadId: "t1",
      turnId: "turn-1",
      completedAtMs: 0,
      item: {
        type: "commandExecution",
        id: "cmd-1",
        command: "echo hi",
        cwd: "/tmp",
        processId: null,
        source: "agent",
        status: "completed",
        commandActions: [],
        aggregatedOutput,
        exitCode: 0,
        durationMs: 150,
      },
    });
  }

  // Codex truncates the aggregated output it puts on the completed item, but
  // the full text arrives separately on the raw shell record — and it can
  // arrive *after* the completion. Emitting the completion immediately
  // published the truncated output permanently, since an item completes once.
  it("defers a completed command until the later raw shell result arrives", () => {
    const translator = createTranslator();
    translator.translateEvent(shellCallOpener);

    expect(translator.translateEvent(completedCommand("OUT-2\nOUT-3\n"))).toEqual(
      [],
    );

    expect(
      translator.translateEvent(
        codexEvent("rawResponseItem/completed", {
          threadId: "t1",
          turnId: "turn-1",
          item: {
            type: "function_call_output",
            call_id: "cmd-1",
            output: "Output:\nOUT-1\nOUT-2\nOUT-3\n",
          },
        }),
      ),
    ).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        threadId: "t1",
        providerThreadId: "t1",
        scope: turnScope("turn-1"),
        item: expect.objectContaining({
          type: "commandExecution",
          id: "cmd-1",
          aggregatedOutput: "OUT-1\nOUT-2\nOUT-3\n",
        }),
      }),
    );
  });

  // The deferral must not be able to swallow a command: if the raw record
  // never lands, the turn boundary releases what the provider did report.
  it("releases a deferred command before turn completion when no raw result arrives", () => {
    const translator = createTranslator();
    translator.translateEvent(shellCallOpener);
    expect(
      translator.translateEvent(completedCommand("provider output\n")),
    ).toEqual([]);

    const completedEvents = translator.translateEvent(
      codexEvent("turn/completed", {
        threadId: "t1",
        turn: codexTurn({ id: "turn-1", status: "completed", error: null }),
      }),
    );

    // Order matters: the item must settle inside the turn it belongs to.
    expect(completedEvents.map((event) => event.type)).toEqual([
      "item/completed",
      "turn/completed",
    ]);
    expect(completedEvents[0]).toMatchObject({
      item: { id: "cmd-1", aggregatedOutput: "provider output\n" },
    });
  });
});

// ---------------------------------------------------------------------------
// Subagent activity correlation to the parent tool call (009dcbd4f, #1361)
// ---------------------------------------------------------------------------

describe("codex subagent activity correlation", () => {
  function subAgentActivity(args: {
    id: string;
    kind: "started" | "interacted";
  }) {
    return {
      jsonrpc: "2.0" as const,
      method: "item/completed",
      params: {
        threadId: "root-provider-thread",
        turnId: "parent-turn",
        item: {
          type: "subAgentActivity",
          id: args.id,
          kind: args.kind,
          agentThreadId: "agent-thread-1",
          agentPath: "/root/lifecycle_child",
        },
      },
    };
  }

  function childTurnStarted(id: string) {
    return codexEvent("turn/started", {
      threadId: "root-provider-thread",
      turn: codexTurn({ id, status: "inProgress", error: null }),
    });
  }

  function childTurnCompleted(id: string) {
    return codexEvent("turn/completed", {
      threadId: "root-provider-thread",
      turn: codexTurn({ id, status: "completed", error: null }),
    });
  }

  // A subagent that finished and is then interacted with again runs its new
  // turns on the same provider thread. Without re-arming the association on
  // `interacted`, those turns detached from the spawning tool call and the
  // resumed work rendered as top-level activity in the parent thread.
  it("re-arms the parent link when a completed subagent is interacted with again", () => {
    const translator = createTranslator();
    translator.translateEvent(
      subAgentActivity({ id: "subagent-call-1", kind: "started" }),
    );

    expect(translator.translateEvent(childTurnStarted("child-turn-1"))).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        scope: turnScope("child-turn-1"),
        parentToolCallId: "subagent-call-1",
      }),
    );
    translator.translateEvent(childTurnCompleted("child-turn-1"));

    // The interaction itself is bookkeeping, not a timeline item.
    expect(
      translator.translateEvent(
        subAgentActivity({ id: "interaction-1", kind: "interacted" }),
      ),
    ).toEqual([]);

    expect(translator.translateEvent(childTurnStarted("child-turn-2"))).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        scope: turnScope("child-turn-2"),
        parentToolCallId: "subagent-call-1",
      }),
    );

    // Re-arming must not re-complete the spawning tool call: the delegation
    // item stays open across the resumed turn.
    const resumedTurnCompleted = translator.translateEvent(
      childTurnCompleted("child-turn-2"),
    );
    expect(resumedTurnCompleted).toEqual([
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope("child-turn-2"),
      }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Accepted-turn correlation via turn/started (68d80092f, current semantics)
// ---------------------------------------------------------------------------

describe("codex accepted-input correlation", () => {
  // Codex has no per-turn request id: the ack has to be correlated to the
  // provider's next turn/started on that thread. `prepareTurnStart` queues the
  // client request id before dispatch precisely because codex emits
  // turn/started before the turn/start response settles.
  //
  // (The steer ack is NOT translator-owned — both the adapter and the bridge
  // build it from the accepted command via buildAcceptedUserMessageEvent —
  // so only the queued-turn half moves here.)
  it("acks a queued turn on turn/started and suppresses the later echo", () => {
    const translator = createTranslator();
    expect(
      translator.prepareTurnStart({
        clientRequestId: "creq_23456789ag",
        providerThreadId: "provider-thread-1",
      }),
    ).not.toBeNull();

    expect(
      translator.translateEvent(
        codexEvent("turn/started", {
          threadId: "provider-thread-1",
          turn: codexTurn({ id: "turn-1", status: "inProgress", error: null }),
        }),
      ),
    ).toEqual([
      {
        type: "turn/started",
        threadId: "provider-thread-1",
        providerThreadId: "provider-thread-1",
        scope: turnScope("turn-1"),
      },
      {
        type: "turn/input/accepted",
        threadId: "provider-thread-1",
        providerThreadId: "provider-thread-1",
        scope: turnScope("turn-1"),
        clientRequestId: "creq_23456789ag",
      },
    ]);

    // bb already owns the user message it sent; the provider's echo of it
    // would render a duplicate.
    expect(
      translator.translateEvent(
        codexEvent("item/completed", {
          threadId: "provider-thread-1",
          turnId: "turn-1",
          completedAtMs: 0,
          item: {
            type: "userMessage",
            id: "provider-user-1",
            clientId: null,
            content: [{ type: "text", text: "normal turn", text_elements: [] }],
          },
        }),
      ),
    ).toMatchObject([]);
  });

  // A dispatch that never reached the provider must not leave a queued id that
  // the *next* turn — possibly a different one — would claim.
  it("drops the queued ack when the dispatch is rolled back", () => {
    const translator = createTranslator();
    const prepared = translator.prepareTurnStart({
      clientRequestId: "creq_23456789ag",
      providerThreadId: "provider-thread-1",
    });
    if (!prepared) {
      throw new Error("Expected prepared turn/start state");
    }
    prepared.rollback();

    expect(
      translator.translateEvent(
        codexEvent("turn/started", {
          threadId: "provider-thread-1",
          turn: codexTurn({ id: "turn-1", status: "inProgress", error: null }),
        }),
      ),
    ).toEqual([
      {
        type: "turn/started",
        threadId: "provider-thread-1",
        providerThreadId: "provider-thread-1",
        scope: turnScope("turn-1"),
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Delegation-turn nesting (2da7eb652, #315)
// ---------------------------------------------------------------------------

describe("codex delegation-turn nesting", () => {
  // Same-provider delegation runs the child's turns on the parent's own
  // provider thread. The link is per-turn: it must cover the delegated turn
  // and everything inside it, and must not leak onto the user's next turn on
  // that same thread — which is what made an ordinary follow-up render nested
  // under a finished spawnAgent call.
  it("does not inherit a delegation link onto a later human turn", () => {
    const translator = createTranslator();
    const providerThreadId = "root-provider-thread";
    const parentToolCallId = "call_MV1jTrxEd9bsYdEXQo1PhVOs";

    translator.translateEvent(
      codexEvent("turn/started", {
        threadId: providerThreadId,
        turn: codexTurn({ id: "parent-turn", status: "inProgress", error: null }),
      }),
    );
    translator.translateEvent(
      codexEvent("item/started", {
        threadId: providerThreadId,
        turnId: "parent-turn",
        startedAtMs: 0,
        item: {
          type: "collabAgentToolCall",
          id: parentToolCallId,
          tool: "spawnAgent",
          status: "inProgress",
          senderThreadId: providerThreadId,
          receiverThreadIds: [],
          prompt: "Run the child command",
          model: null,
          reasoningEffort: null,
          agentsStates: {},
        },
      }),
    );
    translator.translateEvent(
      codexEvent("item/completed", {
        threadId: providerThreadId,
        turnId: "parent-turn",
        completedAtMs: 0,
        item: {
          type: "collabAgentToolCall",
          id: parentToolCallId,
          tool: "spawnAgent",
          status: "completed",
          senderThreadId: providerThreadId,
          receiverThreadIds: ["child-provider-thread"],
          prompt: "Run the child command",
          model: "gpt-5.5",
          reasoningEffort: "medium",
          agentsStates: {
            "child-provider-thread": { status: "pendingInit", message: null },
          },
        },
      }),
    );
    translator.translateEvent(
      codexEvent("turn/completed", {
        threadId: providerThreadId,
        turn: codexTurn({ id: "parent-turn", status: "completed", error: null }),
      }),
    );

    expect(
      translator.translateEvent(
        codexEvent("turn/started", {
          threadId: providerThreadId,
          turn: codexTurn({ id: "child-turn", status: "inProgress", error: null }),
        }),
      ),
    ).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        parentToolCallId,
        scope: turnScope("child-turn"),
      }),
    );

    expect(
      translator.translateEvent(
        codexEvent("item/started", {
          threadId: providerThreadId,
          turnId: "child-turn",
          startedAtMs: 0,
          item: {
            type: "commandExecution",
            id: "child-command",
            command: "/bin/zsh -lc 'sleep 20; echo CHILD_REAL_PROVIDER_DONE'",
            cwd: "/tmp",
            processId: null,
            source: "agent",
            status: "inProgress",
            commandActions: [],
            aggregatedOutput: null,
            exitCode: null,
            durationMs: null,
          },
        }),
      ),
    ).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        item: expect.objectContaining({
          type: "commandExecution",
          id: "child-command",
          parentToolCallId,
        }),
      }),
    );

    translator.prepareTurnStart({
      clientRequestId: "creq_followup",
      providerThreadId,
    });

    const followUpTurnStarted = translator
      .translateEvent(
        codexEvent("turn/started", {
          threadId: providerThreadId,
          turn: codexTurn({
            id: "follow-up-turn",
            status: "inProgress",
            error: null,
          }),
        }),
      )
      .find((event) => event.type === "turn/started");
    expect(followUpTurnStarted).toEqual(
      expect.objectContaining({
        type: "turn/started",
        scope: turnScope("follow-up-turn"),
      }),
    );
    expect(followUpTurnStarted).not.toHaveProperty("parentToolCallId");

    const followUpAssistant = translator
      .translateEvent(
        codexEvent("item/completed", {
          threadId: providerThreadId,
          turnId: "follow-up-turn",
          completedAtMs: 0,
          item: {
            type: "agentMessage",
            id: "follow-up-assistant",
            text: "follow-up done",
            phase: null,
            memoryCitation: null,
          },
        }),
      )
      .find(
        (event) =>
          event.type === "item/completed" && event.item.type === "agentMessage",
      );
    expect(followUpAssistant).toEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "agentMessage",
          id: "follow-up-assistant",
        }),
      }),
    );
    expect(followUpAssistant).not.toHaveProperty("item.parentToolCallId");

    // The delegated turn keeps its link even though a newer turn has opened.
    expect(
      translator.translateEvent(
        codexEvent("item/commandExecution/outputDelta", {
          threadId: providerThreadId,
          turnId: "child-turn",
          itemId: "child-command",
          delta: "CHILD_REAL_PROVIDER_DONE\n",
        }),
      ),
    ).toContainEqual(
      expect.objectContaining({
        type: "item/commandExecution/outputDelta",
        parentToolCallId,
        scope: turnScope("child-turn"),
      }),
    );
  });
});
