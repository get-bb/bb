import type { ClientTurnRequestId } from "@bb/domain";

interface SubmittedRequest {
  submittedAt: number;
  threadId: string;
}

export class TurnRequestDelivery {
  private readonly inFlight = new Map<string, SubmittedRequest>();
  private readonly awaitingAcceptance = new Map<string, SubmittedRequest>();
  private readonly reportedIdleAtByThreadId = new Map<string, number>();

  submitted(args: { requestId: ClientTurnRequestId; threadId: string }): void {
    this.inFlight.set(args.requestId, {
      submittedAt: Date.now(),
      threadId: args.threadId,
    });
  }

  settled(
    requestId: ClientTurnRequestId,
    outcome: "refused" | "sent" | "unknown",
  ): void {
    const submitted = this.inFlight.get(requestId);
    if (submitted === undefined) return;
    this.inFlight.delete(requestId);
    if (outcome === "refused") return;
    const reportedIdleAt = this.reportedIdleAtByThreadId.get(
      submitted.threadId,
    );
    if (
      outcome === "unknown" &&
      reportedIdleAt !== undefined &&
      reportedIdleAt > submitted.submittedAt
    ) {
      return;
    }
    this.awaitingAcceptance.set(requestId, {
      submittedAt: Date.now(),
      threadId: submitted.threadId,
    });
  }

  accepted(requestId: string): void {
    this.inFlight.delete(requestId);
    this.awaitingAcceptance.delete(requestId);
  }

  pendingStartsDropped(threadIds: ReadonlySet<string>): void {
    for (const [requestId, awaiting] of this.awaitingAcceptance) {
      if (threadIds.has(awaiting.threadId)) {
        this.awaitingAcceptance.delete(requestId);
      }
    }
  }

  daemonReportedIdle(threadIds: ReadonlySet<string>): void {
    const now = Date.now();
    for (const threadId of threadIds) {
      this.reportedIdleAtByThreadId.set(threadId, now);
    }
    this.pendingStartsDropped(threadIds);
  }

  threadsAwaitingAcceptanceSince(before: number): Set<string> {
    return new Set(
      [...this.awaitingAcceptance.values()]
        .filter((awaiting) => awaiting.submittedAt <= before)
        .map((awaiting) => awaiting.threadId),
    );
  }

  mayStillBeAccepted(requestId: string): boolean {
    return (
      this.inFlight.has(requestId) || this.awaitingAcceptance.has(requestId)
    );
  }
}
