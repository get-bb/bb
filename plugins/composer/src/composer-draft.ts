import type { ComposerDraftSnapshot } from "@get-bb/plugin-sdk/app";

export function isDraftEmpty(draft: ComposerDraftSnapshot): boolean {
  return (
    draft.text.length === 0 &&
    draft.mentions.length === 0 &&
    draft.attachments.length === 0
  );
}

function sortObjectKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
}

function canonicalDraftJson(draft: ComposerDraftSnapshot): string {
  return JSON.stringify(
    {
      text: draft.text,
      mentions: draft.mentions,
      attachments: draft.attachments,
    },
    sortObjectKeys,
  );
}

export function areDraftsEqual(
  left: ComposerDraftSnapshot,
  right: ComposerDraftSnapshot,
): boolean {
  return canonicalDraftJson(left) === canonicalDraftJson(right);
}
