import type { TimelineRow } from "@bb/server-contract";
import { fileChangeRow } from "@/test/fixtures/thread-timeline-rows";

export const fileChangeAssistantStream: TimelineRow = fileChangeRow({
  id: "thr_zeb7z9afmw:fileChange:35564",
  threadId: "thr_zeb7z9afmw",
  turnId: "019dd185-ef12-7d50-aa48-47882e9c8aaf",
  sourceSeqStart: 35564,
  sourceSeqEnd: 35564,
  startedAt: 1777337123100,
  createdAt: 1777337123900,
  status: "completed",
  callId: "call_fjGvl1fFJU7cAcw46FcSnbjJ",
  change: {
    path: "/Users/michael/.bb-dev/worktrees/env_33i22gvcqe/bb/packages/core-ui/src/assistant-stream-projection.ts",
    kind: "update",
    movePath: null,
    diff: `@@ -24,3 +24,3 @@
   visibleReasoningMessageKeys: Set<string>;
-  finalizedReasoningMessageKeys: Set<string>;
+  finalizedReasoningKeys: Set<string>;
 }
@@ -131,3 +131,3 @@
     buffers: state.reasoningTextBuffersByKey,
-    finalizedKeys: state.finalizedReasoningMessageKeys,
+    finalizedKeys: state.finalizedReasoningKeys,
     openMessages: state.openReasoningMessagesByKey,`,
    diffStats: { added: 2, removed: 2 },
  },
  stdout: null,
  stderr: null,
  approvalStatus: null,
});

export const fileChangeIndex: TimelineRow = fileChangeRow({
  id: "thr_zeb7z9afmw:fileChange:35573",
  threadId: "thr_zeb7z9afmw",
  turnId: "019dd185-ef12-7d50-aa48-47882e9c8aaf",
  sourceSeqStart: 35573,
  sourceSeqEnd: 35573,
  startedAt: 1777337124000,
  createdAt: 1777337125300,
  status: "completed",
  callId: "call_BXK77XTyviYmWUVNOpPG5nwJ",
  change: {
    path: "/Users/michael/.bb-dev/worktrees/env_33i22gvcqe/bb/packages/core-ui/src/index.ts",
    kind: "update",
    movePath: null,
    diff: `@@ -110,3 +110,2 @@
 export { extractThreadContextWindowUsage } from "./thread-context-window-usage.js";
-export { extractActiveThinking } from "./active-thinking.js";

@@ -126,3 +125,7 @@

-export { toViewMessages, toViewProjection } from "./to-view-messages.js";
+export {
+  toViewMessages,
+  toViewProjection,
+  toViewProjectionEntries,
+} from "./to-view-messages.js";
 export type { ThreadEventWithMeta } from "./to-view-messages.js";`,
    diffStats: { added: 5, removed: 2 },
  },
  stdout: null,
  stderr: null,
  approvalStatus: null,
});

export const fileChangeTimelineService: TimelineRow = fileChangeRow({
  id: "thr_zeb7z9afmw:fileChange:35595",
  threadId: "thr_zeb7z9afmw",
  turnId: "019dd185-ef12-7d50-aa48-47882e9c8aaf",
  sourceSeqStart: 35595,
  sourceSeqEnd: 35595,
  startedAt: 1777337125400,
  createdAt: 1777337127100,
  status: "completed",
  callId: "call_v3QQJnCbGh2ErXIJdCf4hX4N",
  change: {
    path: "/Users/michael/.bb-dev/worktrees/env_33i22gvcqe/bb/apps/server/src/services/threads/timeline.ts",
    kind: "update",
    movePath: null,
    diff: `@@ -6,2 +6,3 @@
   toViewMessages,
+  toViewProjectionEntries,
   toViewProjection,
@@ -256,2 +257,23 @@
     thread.parentThreadId !== null && !options.showAllParentEvents;
+  const contextWindowUsageRows = listContextWindowUsageRows(db, {
+    threadId: thread.id,
+  });
+
+  if (isDefaultParentView) {
+    return {
+      rows: buildParentConversationRows(
+        toViewMessages(decodedEvents, {
+          includeInternalSystemMessages: options.showAllParentEvents,
+          threadStatus: thread.status,
+          parentThreadId: thread.parentThreadId,
+        }),
+      ),
+      activeThinking: null,
+      contextWindowUsage:
+        extractThreadContextWindowUsage(
+          contextWindowUsageRows.map((row) => parseStoredEventRow(row)),
+        ) ?? undefined,
+    };
+  }`,
    diffStats: { added: 22, removed: 0 },
  },
  stdout: null,
  stderr: null,
  approvalStatus: null,
});

export const fileChangeActiveThinkingDelete: TimelineRow = fileChangeRow({
  id: "thr_zeb7z9afmw:fileChange:35611",
  threadId: "thr_zeb7z9afmw",
  turnId: "019dd185-ef12-7d50-aa48-47882e9c8aaf",
  sourceSeqStart: 35611,
  sourceSeqEnd: 35611,
  startedAt: 1777337127200,
  createdAt: 1777337127900,
  status: "completed",
  callId: "call_1JWzaNZyTpVIrB8reX73YYUN",
  change: {
    path: "/Users/michael/.bb-dev/worktrees/env_33i22gvcqe/bb/packages/core-ui/src/active-thinking.ts",
    kind: "delete",
    movePath: null,
    diff: null,
    diffStats: { added: 0, removed: 0 },
  },
  stdout: null,
  stderr: null,
  approvalStatus: null,
});

export const fileChangeToViewMessages: TimelineRow = fileChangeRow({
  id: "thr_zeb7z9afmw:fileChange:35671",
  threadId: "thr_zeb7z9afmw",
  turnId: "019dd185-ef12-7d50-aa48-47882e9c8aaf",
  sourceSeqStart: 35671,
  sourceSeqEnd: 35671,
  startedAt: 1777337128000,
  createdAt: 1777337129500,
  status: "completed",
  callId: "call_3qZxJB5I3kVdSM4pPiBCTm92",
  change: {
    path: "/Users/michael/.bb-dev/worktrees/env_33i22gvcqe/bb/packages/core-ui/src/to-view-messages.ts",
    kind: "update",
    movePath: null,
    diff: `@@ -497,2 +497,12 @@

+function trackReasoningTurn(
+  state: ProjectionState,
+  identity: BufferedTextInstanceIdentity | null,
+): void {
+  if (!identity || state.closedTurnIds.has(identity.turnId)) {
+    return;
+  }
+  state.openTurnIds.add(identity.turnId);
+}
+
 function finalizeReasoningLifecycle(`,
    diffStats: { added: 10, removed: 0 },
  },
  stdout: null,
  stderr: null,
  approvalStatus: null,
});
