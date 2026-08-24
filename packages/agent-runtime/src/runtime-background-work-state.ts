import type { ThreadEvent } from "@bb/domain";

/**
 * Tracks background tasks and delegations that are still open per thread,
 * from the same normalized event stream the runtime forwards to the server.
 *
 * Background tasks outlive the turn that spawned them, so a thread can be idle
 * while its workflow or backgrounded command is still running inside the
 * provider process. Turn state alone therefore cannot tell a caller whether
 * shutting the runtime down would destroy live work — this can.
 *
 * Open delegations are open work too (grammar v3, docs/provider-plugin-api.md
 * §3): a codex native sub-agent can still be running, or still owe a
 * followup turn, after the parent turn that spawned it settled. The
 * delegation item's lifecycle (`item/started` pending, `item/completed`, and
 * the thread-scoped `item/delegation/*` events for background ones) is the
 * only signal; bridges report no side channel for it.
 *
 * Ambient (`skipTranscript`) tasks count too: they are hidden from the
 * transcript, not detached from the process that would be killed.
 */
export class RuntimeBackgroundWorkState {
  private readonly openTaskIdsByThreadId = new Map<string, Set<string>>();

  clear(): void {
    this.openTaskIdsByThreadId.clear();
  }

  clearThread(threadId: string): void {
    this.openTaskIdsByThreadId.delete(threadId);
  }

  hasOpenWork(): boolean {
    return this.openTaskIdsByThreadId.size > 0;
  }

  hasOpenThreadWork(threadId: string): boolean {
    return (this.openTaskIdsByThreadId.get(threadId)?.size ?? 0) > 0;
  }

  observe(event: ThreadEvent): void {
    if (event.type === "item/started" || event.type === "item/completed") {
      if (
        event.item.type === "backgroundTask" ||
        event.item.type === "delegation"
      ) {
        this.setTaskOpen({
          isOpen: event.item.status === "pending",
          taskId: event.item.id,
          threadId: event.threadId,
        });
      }
      return;
    }

    if (
      event.type === "item/backgroundTask/progress" ||
      event.type === "item/backgroundTask/completed" ||
      event.type === "item/delegation/progress" ||
      event.type === "item/delegation/completed"
    ) {
      this.setTaskOpen({
        isOpen: event.item.status === "pending",
        taskId: event.item.id,
        threadId: event.threadId,
      });
    }
  }

  private setTaskOpen(args: {
    isOpen: boolean;
    taskId: string;
    threadId: string;
  }): void {
    const openTaskIds = this.openTaskIdsByThreadId.get(args.threadId);
    if (!args.isOpen) {
      if (!openTaskIds) {
        return;
      }
      openTaskIds.delete(args.taskId);
      if (openTaskIds.size === 0) {
        this.openTaskIdsByThreadId.delete(args.threadId);
      }
      return;
    }

    if (openTaskIds) {
      openTaskIds.add(args.taskId);
      return;
    }
    this.openTaskIdsByThreadId.set(args.threadId, new Set([args.taskId]));
  }
}
