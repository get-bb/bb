import type { ThreadEvent } from "@bb/domain";
import { createSecretStreamRedactor } from "@bb/process-utils";
import { redactThreadEventContent } from "./thread-event-redaction.js";

type DeltaEvent = Extract<ThreadEvent, { delta: string; itemId: string }>;

export function createThreadEventStreamRedactor(
  getSecrets: () => readonly string[],
) {
  const streams = new Map<
    string,
    {
      event: DeltaEvent;
      redactor: ReturnType<typeof createSecretStreamRedactor>;
    }
  >();
  function flush(
    threadId: string,
    itemId?: string,
    turnId?: string,
  ): ThreadEvent[] {
    const events: ThreadEvent[] = [];
    for (const [key, stream] of streams) {
      if (
        stream.event.threadId !== threadId ||
        (turnId !== undefined &&
          (stream.event.scope.kind !== "turn" ||
            stream.event.scope.turnId !== turnId)) ||
        (itemId !== undefined && stream.event.itemId !== itemId)
      )
        continue;
      const delta = stream.redactor.flush();
      if (delta) events.push({ ...stream.event, delta });
      streams.delete(key);
    }
    return events;
  }
  return {
    flush,
    push(event: ThreadEvent): ThreadEvent[] {
      if ("delta" in event && "itemId" in event) {
        const key = JSON.stringify([
          event.threadId,
          event.providerThreadId,
          event.itemId,
          event.type,
          event.scope,
          event.parentToolCallId,
        ]);
        if (event.type === "item/commandExecution/outputDelta" && event.reset)
          streams.delete(key);
        let stream = streams.get(key);
        if (!stream) {
          stream = { event, redactor: createSecretStreamRedactor(getSecrets) };
          streams.set(key, stream);
        }
        stream.event =
          event.type === "item/commandExecution/outputDelta"
            ? { ...event, reset: false }
            : event;
        const delta = stream.redactor.push(event.delta);
        return delta ||
          (event.type === "item/commandExecution/outputDelta" && event.reset)
          ? [{ ...event, delta }]
          : [];
      }
      const flushed =
        event.type === "item/completed"
          ? flush(
              event.threadId,
              event.item.id,
              event.scope.kind === "turn" ? event.scope.turnId : undefined,
            )
          : event.type === "turn/completed"
            ? flush(
                event.threadId,
                undefined,
                event.scope.kind === "turn" ? event.scope.turnId : undefined,
              )
            : [];
      const secrets = getSecrets();
      const safe = redactThreadEventContent(event, (text) => {
        const redactor = createSecretStreamRedactor(secrets);
        return redactor.push(text) + redactor.flush();
      });
      return [...flushed, safe];
    },
  };
}
