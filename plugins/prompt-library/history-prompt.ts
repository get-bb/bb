import type {
  BbPluginApi,
  ComposerAttachment,
  ComposerDraftReplacement,
  ComposerMention,
} from "@get-bb/plugin-sdk";

export type HistoryEntry = Awaited<
  ReturnType<BbPluginApi["sdk"]["promptHistory"]["list"]>
>["entries"][number];
type HistoryInput = HistoryEntry["input"][number];
type HistoryMention = Extract<
  HistoryInput,
  { type: "text" }
>["mentions"][number];

function composerMention({
  start,
  end,
  resource,
}: HistoryMention): ComposerMention {
  if (resource.kind !== "plugin") return { from: start, to: end, ...resource };
  const { itemId, ...plugin } = resource;
  const separator = itemId.indexOf(":");
  return {
    from: start,
    to: end,
    ...plugin,
    provider: separator === -1 ? resource.pluginId : itemId.slice(0, separator),
    id: separator === -1 ? itemId : itemId.slice(separator + 1),
  };
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function promptFromHistory(
  input: readonly HistoryInput[],
): ComposerDraftReplacement {
  const segments: string[] = [];
  const mentions: ComposerMention[] = [];
  const attachments: ComposerAttachment[] = [];
  let offset = 0;
  for (const chunk of input) {
    if (chunk.type === "text") {
      if (chunk.text.trim().length === 0) continue;
      if (segments.length > 0) offset += 2;
      for (const mention of chunk.mentions) {
        const converted = composerMention(mention);
        mentions.push({
          ...converted,
          from: converted.from + offset,
          to: converted.to + offset,
        });
      }
      segments.push(chunk.text);
      offset += chunk.text.length;
    } else if (chunk.type === "localImage") {
      attachments.push({
        type: "localImage",
        path: chunk.path,
        name: fileName(chunk.path),
        sizeBytes: 0,
      });
    } else if (chunk.type === "localFile") {
      attachments.push({
        type: "localFile",
        path: chunk.path,
        name: chunk.name ?? fileName(chunk.path),
        sizeBytes: chunk.sizeBytes ?? 0,
        ...(chunk.mimeType !== undefined ? { mimeType: chunk.mimeType } : {}),
      });
    }
  }
  return { text: segments.join("\n\n"), mentions, attachments };
}
