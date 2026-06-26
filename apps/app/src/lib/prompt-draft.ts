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

export interface PromptDraftState {
  text: string;
  mentions: PromptTextMention[];
  attachments: PromptDraftAttachment[];
}

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
});

export function emptyPromptDraftState(): PromptDraftState {
  return {
    text: "",
    mentions: [],
    attachments: [],
  };
}

function normalizeQuotedSelectionText(text: string): string {
  const lines = text.replace(/\r\n|\r/gu, "\n").split("\n");
  const normalizedLines: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const previousLine = normalizedLines.at(-1);
    const nextLine = lines[index + 1];
    if (
      line.trim().length === 0 &&
      previousLine?.startsWith(">") === true &&
      nextLine?.startsWith(">") === true
    ) {
      continue;
    }
    normalizedLines.push(line);
  }

  return normalizedLines.join("\n").trim();
}

/**
 * Append a quoted selection to the draft text as a `> `-prefixed blockquote
 * block. The editor parses these blocks into real blockquote nodes; the user
 * types their reply in the paragraph below. Appending to the END of the text
 * keeps every existing mention offset unchanged.
 */
export function appendQuoteToDraftText(
  state: PromptDraftState,
  quotedText: string,
): PromptDraftState {
  // Guard the boundary: an empty/whitespace-only selection would otherwise
  // emit a bare "> " block and make an empty draft look dirty.
  const trimmed = normalizeQuotedSelectionText(quotedText);
  if (trimmed === "") return state;

  const block = trimmed
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n");

  // Trailing newline so the reply paragraph sits below the quote.
  const text = state.text === "" ? `${block}\n` : `${state.text}\n${block}\n`;

  return { ...state, text };
}

export function isPromptDraftEmpty(draft: PromptDraftState): boolean {
  return (
    draft.text.length === 0 &&
    draft.mentions.length === 0 &&
    draft.attachments.length === 0
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
  if (isPromptDraftEmpty(draft)) {
    return null;
  }
  return JSON.stringify({
    text,
    ...(mentions.length > 0 ? { mentions } : {}),
    attachments,
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

export function promptDraftToInput(draft: PromptDraftState): PromptInput[] {
  const input: PromptInput[] = [];

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
  };
}
