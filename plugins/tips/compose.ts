import type {
  ComposerDraftReplacement,
  ComposerDraftSnapshot,
} from "@get-bb/plugin-sdk/app";

export function hasTaskSlot(prompt: string): boolean {
  return prompt.endsWith(" ");
}

export function composeTipDraft(
  prompt: string,
  current: ComposerDraftSnapshot,
): ComposerDraftReplacement | ComposerDraftSnapshot {
  const task = current.text.trim();
  if (task === "") return { text: prompt, mentions: [] };
  if (current.text.includes(prompt.trim())) return current;
  if (!hasTaskSlot(prompt)) {
    return {
      text: `${current.text.trimEnd()}\n\n${prompt}`,
      mentions: current.mentions,
    };
  }
  const shift =
    prompt.length - (current.text.length - current.text.trimStart().length);
  return {
    text: `${prompt}${task}`,
    mentions: current.mentions.map((mention) => ({
      ...mention,
      from: mention.from + shift,
      to: mention.to + shift,
    })),
  };
}
