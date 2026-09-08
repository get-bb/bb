import type { JsonValue, ThreadEvent, ThreadEventItem } from "@bb/domain";

type Redact = (text: string) => string;

function redactJson(value: JsonValue, redact: Redact): JsonValue {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value))
    return value.map((entry) => redactJson(entry, redact));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        redactJson(entry, redact),
      ]),
    );
  }
  return value;
}

function redactOpaque(value: unknown, redact: Redact): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value))
    return value.map((entry: unknown) => redactOpaque(entry, redact));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        redactOpaque(entry, redact),
      ]),
    );
  }
  return value;
}

function redactItem<T extends ThreadEventItem>(item: T, redact: Redact): T {
  const optional = (value: string | undefined) =>
    value === undefined ? undefined : redact(value);
  const nullable = (value: string | null) =>
    value === null ? null : redact(value);
  if ("presentation" in item && item.presentation) {
    const presentation = item.presentation;
    item = {
      ...item,
      presentation: {
        ...presentation,
        label: {
          pending: redact(presentation.label.pending),
          completed: redact(presentation.label.completed),
        },
        title: optional(presentation.title),
        detail: optional(presentation.detail)?.slice(0, 280),
        ...(presentation.badge
          ? {
              badge: {
                ...presentation.badge,
                label: redact(presentation.badge.label).slice(0, 80),
                hint: redact(presentation.badge.hint).slice(0, 80),
              },
            }
          : {}),
      },
    };
  }
  switch (item.type) {
    case "agentMessage":
    case "plan":
      return { ...item, text: redact(item.text) };
    case "userMessage":
      return {
        ...item,
        content: item.content.map((entry) =>
          entry.type === "text"
            ? { ...entry, text: redact(entry.text) }
            : entry,
        ),
      };
    case "commandExecution":
      return {
        ...item,
        command: redact(item.command),
        aggregatedOutput: optional(item.aggregatedOutput),
      };
    case "reasoning":
      return {
        ...item,
        summary: item.summary.map(redact),
        content: item.content.map(redact),
      };
    case "fileChange":
      return {
        ...item,
        changes: item.changes.map((change) => ({
          ...change,
          diff: optional(change.diff),
        })),
      };
    case "toolCall":
      return {
        ...item,
        arguments:
          item.arguments === undefined
            ? undefined
            : Object.fromEntries(
                Object.entries(item.arguments).map(([key, value]) => [
                  key,
                  redactOpaque(value, redact),
                ]),
              ),
        result: redactOpaque(item.result, redact),
        error: optional(item.error),
      };
    case "webSearch":
      return {
        ...item,
        queries: item.queries.map(redact),
        resultText: nullable(item.resultText),
      };
    case "webFetch":
      return {
        ...item,
        url: redact(item.url),
        prompt: nullable(item.prompt),
        pattern: nullable(item.pattern),
        resultText: nullable(item.resultText),
      };
    case "fileRead":
      return { ...item, cmd: optional(item.cmd) };
    case "search":
      return { ...item, query: redact(item.query), cmd: optional(item.cmd) };
    case "planSteps":
      return {
        ...item,
        steps: item.steps.map((step) => ({ ...step, step: redact(step.step) })),
        explanation: optional(item.explanation),
      };
    case "backgroundTask":
      return {
        ...item,
        description: redact(item.description),
        summary: optional(item.summary),
        error: optional(item.error),
      };
    case "delegation":
      return {
        ...item,
        label: redact(item.label),
        summary: optional(item.summary),
      };
    case "extension":
      return { ...item, payload: redactJson(item.payload, redact) };
    default:
      return item;
  }
}

export function redactThreadEventContent<T extends ThreadEvent>(
  event: T,
  redact: Redact,
): T {
  const optional = (value: string | undefined) =>
    value === undefined ? undefined : redact(value);
  switch (event.type) {
    case "item/started":
    case "item/completed":
    case "item/backgroundTask/progress":
    case "item/backgroundTask/completed":
    case "item/delegation/progress":
    case "item/delegation/completed":
      return { ...event, item: redactItem(event.item, redact) };
    case "item/agentMessage/delta":
    case "item/commandExecution/outputDelta":
    case "item/fileChange/outputDelta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
    case "item/plan/delta":
      return { ...event, delta: redact(event.delta) };
    case "turn/completed":
      return {
        ...event,
        ...(event.error
          ? { error: { ...event.error, message: redact(event.error.message) } }
          : {}),
      };
    case "thread/name/updated":
      return { ...event, threadName: redact(event.threadName) };
    case "thread/goal/updated":
      return { ...event, objective: redact(event.objective) };
    case "item/mcpToolCall/progress":
    case "item/toolCall/progress":
      return { ...event, message: optional(event.message) };
    case "turn/plan/updated":
      return {
        ...event,
        plan: event.plan.map((step) => ({ ...step, step: redact(step.step) })),
        explanation: optional(event.explanation),
      };
    case "turn/diff/updated":
      return { ...event, diff: optional(event.diff) };
    case "provider/error":
      return {
        ...event,
        message: redact(event.message),
        detail: optional(event.detail),
      };
    case "provider/warning":
      return {
        ...event,
        summary: optional(event.summary),
        details: optional(event.details),
      };
    case "provider/modelFallback":
      return { ...event, message: redact(event.message) };
    case "provider.env-resolved":
      return {
        ...event,
        entries: event.entries.map((entry) => ({
          ...entry,
          value:
            typeof entry.value === "string" ? redact(entry.value) : entry.value,
          reason: optional(entry.reason),
        })),
      };
    case "thread/extensionState/updated":
      return { ...event, payload: redactJson(event.payload, redact) };
    case "provider/unhandled":
      return {
        ...event,
        rawEvent: {
          ...event.rawEvent,
          ...(event.rawEvent.params === undefined
            ? {}
            : { params: redactJson(event.rawEvent.params, redact) }),
        },
      };
    default:
      return event;
  }
}
