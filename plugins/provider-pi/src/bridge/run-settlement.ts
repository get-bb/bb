export function runSettlementError(
  event: Record<string, unknown>,
  messages: unknown,
): string | undefined {
  if (Object.hasOwn(event, "aborted") && typeof event.aborted !== "boolean") {
    return "Invalid Pi settlement: aborted must be boolean when present";
  }
  const last = Array.isArray(messages)
    ? [...messages]
        .reverse()
        .find(
          (value: unknown): value is Record<string, unknown> =>
            typeof value === "object" &&
            value !== null &&
            "role" in value &&
            value.role === "assistant",
        )
    : undefined;
  if (event.aborted === true || last?.stopReason === "aborted") {
    return "Pi run interrupted unexpectedly; no automatic resume was attempted";
  }
  if (last?.stopReason === "error") {
    return typeof last.errorMessage === "string" && last.errorMessage.trim()
      ? last.errorMessage
      : "Pi run failed";
  }
  return undefined;
}
