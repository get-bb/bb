import {
  promptTextMentionSchema,
  type PromptInput,
  type PromptTextMention,
} from "@bb/domain";
import {
  uploadedPromptAttachmentSchema,
  type UploadedPromptAttachment,
} from "@bb/server-contract";
import { z } from "zod";

export type PromptDraftAttachment = UploadedPromptAttachment;

export interface PromptQuote {
  id: string;
  text: string;
  /**
   * Timeline row id of the agent message the selection came from. Drives the
   * pill's "jump to source" affordance. Omitted for quotes with no known source
   * message (the pill then renders without the jump button).
   */
  sourceMessageId?: string;
}

export interface PromptDraftState {
  text: string;
  mentions: PromptTextMention[];
  attachments: PromptDraftAttachment[];
  quotes: PromptQuote[];
}

const promptQuoteSchema = z.object({
  id: z.string(),
  text: z.string(),
  sourceMessageId: z.string().optional(),
});

const promptDraftStorageSchema = z.object({
  text: z.string().default(""),
  mentions: z
    .array(z.unknown())
    .default([])
    .transform((items) =>
      items.flatMap((item) => {
        const result = promptTextMentionSchema.safeParse(item);
        return result.success ? [result.data] : [];
      }),
    ),
  attachments: z
    .array(z.unknown())
    .default([])
    .transform((items) =>
      items.flatMap((item) => {
        const result = uploadedPromptAttachmentSchema.safeParse(item);
        return result.success ? [result.data] : [];
      }),
    ),
  quotes: z
    .array(z.unknown())
    .default([])
    .transform((items) =>
      items.flatMap((item) => {
        const result = promptQuoteSchema.safeParse(item);
        return result.success ? [result.data] : [];
      }),
    ),
});

export function emptyPromptDraftState(): PromptDraftState {
  return {
    text: "",
    mentions: [],
    attachments: [],
    quotes: [],
  };
}

export function addQuoteToDraft(
  state: PromptDraftState,
  text: string,
  sourceMessageId?: string,
): PromptDraftState {
  // Guard the boundary: an empty/whitespace-only selection would otherwise
  // emit a bare "> " block and make an empty draft look dirty.
  const trimmed = text.trim();
  if (trimmed === "") return state;
  return {
    ...state,
    quotes: [
      ...state.quotes,
      {
        id: crypto.randomUUID(),
        text: trimmed,
        ...(sourceMessageId !== undefined ? { sourceMessageId } : {}),
      },
    ],
  };
}

export function removeQuoteFromDraft(
  state: PromptDraftState,
  id: string,
): PromptDraftState {
  return {
    ...state,
    quotes: state.quotes.filter((quote) => quote.id !== id),
  };
}

export function isPromptDraftEmpty(draft: PromptDraftState): boolean {
  return (
    draft.text.length === 0 &&
    draft.mentions.length === 0 &&
    draft.attachments.length === 0 &&
    draft.quotes.length === 0
  );
}

export function parsePromptDraftStorage(
  rawValue: string | null,
): PromptDraftState {
  if (!rawValue) return emptyPromptDraftState();

  try {
    const parsed: unknown = JSON.parse(rawValue);
    const result = promptDraftStorageSchema.safeParse(parsed);
    return result.success ? result.data : emptyPromptDraftState();
  } catch {
    return emptyPromptDraftState();
  }
}

export function serializePromptDraftStorage(
  draft: PromptDraftState,
): string | null {
  const text = draft.text;
  const mentions = draft.mentions;
  const attachments = draft.attachments;
  const quotes = draft.quotes;
  if (isPromptDraftEmpty(draft)) {
    return null;
  }
  return JSON.stringify({
    text,
    ...(mentions.length > 0 ? { mentions } : {}),
    attachments,
    ...(quotes.length > 0 ? { quotes } : {}),
  });
}

export function arePromptDraftStatesEqual(
  left: PromptDraftState,
  right: PromptDraftState,
): boolean {
  return (
    serializePromptDraftStorage(left) === serializePromptDraftStorage(right)
  );
}

function getFileNameFromPath(path: string): string {
  const trimmedPath = path.trim();
  if (trimmedPath.length === 0) {
    return "Attachment";
  }

  const segments = trimmedPath.split("/");
  const lastSegment = segments[segments.length - 1];
  return lastSegment && lastSegment.length > 0 ? lastSegment : trimmedPath;
}

function normalizePromptTextMentions(
  mentions: readonly PromptTextMention[],
  textLength: number,
): PromptTextMention[] {
  return mentions
    .filter(
      (mention) =>
        mention.start >= 0 &&
        mention.end > mention.start &&
        mention.end <= textLength,
    )
    .sort((left, right) => left.start - right.start || left.end - right.end);
}

function buildQuoteBlock(quotes: readonly PromptQuote[]): string {
  return quotes
    .map((quote) =>
      quote.text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n"),
    )
    .join("\n\n");
}

export function promptDraftToInput(draft: PromptDraftState): PromptInput[] {
  const input: PromptInput[] = [];

  if (draft.quotes.length > 0) {
    input.push({
      type: "text",
      text: buildQuoteBlock(draft.quotes),
      mentions: [],
    });
  }

  const trimStartLength = draft.text.length - draft.text.trimStart().length;
  const trimEndIndex = draft.text.trimEnd().length;
  const text = draft.text.slice(trimStartLength, trimEndIndex);
  if (text.length > 0) {
    const mentions = normalizePromptTextMentions(
      draft.mentions.flatMap((mention) => {
        const visibleStart = Math.max(mention.start, trimStartLength);
        const visibleEnd = Math.min(mention.end, trimEndIndex);
        return visibleStart < visibleEnd
          ? [
              {
                ...mention,
                start: visibleStart - trimStartLength,
                end: visibleEnd - trimStartLength,
              },
            ]
          : [];
      }),
      text.length,
    );
    input.push({
      type: "text",
      text,
      mentions,
    });
  }

  for (const attachment of draft.attachments) {
    if (attachment.type === "localImage") {
      input.push({
        type: "localImage",
        path: attachment.path,
      });
      continue;
    }

    input.push({
      type: "localFile",
      path: attachment.path,
      name: attachment.name,
      sizeBytes: attachment.sizeBytes,
      ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
    });
  }

  return input;
}

// Note: quotes are write-once at submit. `promptDraftToInput` flattens them
// into a leading `> ...` text part, and this reverse path intentionally does
// NOT reconstruct quote identity — a draft rebuilt from `PromptInput[]` (e.g.
// prompt history / edit-last-message) surfaces the quote as inline body text,
// not a removable chip. localStorage persistence preserves quotes separately.
export function promptInputToDraft(
  input: readonly PromptInput[],
): PromptDraftState {
  const textSegments: string[] = [];
  const mentions: PromptTextMention[] = [];
  const attachments: PromptDraftState["attachments"] = [];
  let textOffset = 0;

  for (const chunk of input) {
    if (chunk.type === "text") {
      if (chunk.text.trim().length > 0) {
        if (textSegments.length > 0) {
          textOffset += 2;
        }
        for (const mention of chunk.mentions) {
          if (
            mention.start >= 0 &&
            mention.end > mention.start &&
            mention.end <= chunk.text.length
          ) {
            mentions.push({
              ...mention,
              start: textOffset + mention.start,
              end: textOffset + mention.end,
            });
          }
        }
        textSegments.push(chunk.text);
        textOffset += chunk.text.length;
      }
      continue;
    }

    if (chunk.type === "localImage") {
      attachments.push({
        type: "localImage",
        path: chunk.path,
        name: getFileNameFromPath(chunk.path),
        sizeBytes: 0,
      });
      continue;
    }

    if (chunk.type === "localFile") {
      attachments.push({
        type: "localFile",
        path: chunk.path,
        name: chunk.name ?? getFileNameFromPath(chunk.path),
        sizeBytes: chunk.sizeBytes ?? 0,
        ...(chunk.mimeType ? { mimeType: chunk.mimeType } : {}),
      });
    }
  }

  return {
    text: textSegments.join("\n\n"),
    mentions,
    attachments,
    quotes: [],
  };
}
