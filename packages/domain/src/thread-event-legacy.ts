export const LEGACY_CLIENT_REQUEST_SEQUENCE_KEY = [
  "clientRequest",
  "Sequence",
].join("");

export interface LegacyClientRequestSequenceIssue {
  message: string;
  path: string[];
}

function isPropertyBag(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function findLegacyClientRequestSequenceIssues(
  value: unknown,
): LegacyClientRequestSequenceIssue[] {
  if (!isPropertyBag(value)) {
    return [];
  }

  const issues: LegacyClientRequestSequenceIssue[] = [];
  if (Object.hasOwn(value, LEGACY_CLIENT_REQUEST_SEQUENCE_KEY)) {
    issues.push({
      message: "legacy request sequence field is no longer accepted",
      path: [LEGACY_CLIENT_REQUEST_SEQUENCE_KEY],
    });
  }

  const item = value.item;
  if (
    isPropertyBag(item) &&
    item.type === "userMessage" &&
    Object.hasOwn(item, LEGACY_CLIENT_REQUEST_SEQUENCE_KEY)
  ) {
    issues.push({
      message: "legacy user-message request sequence field is no longer accepted",
      path: ["item", LEGACY_CLIENT_REQUEST_SEQUENCE_KEY],
    });
  }

  return issues;
}
