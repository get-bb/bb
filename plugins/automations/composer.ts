import type {
  ComposerCustomization,
  ComposerDraftReplacement,
  ComposerDraftSnapshot,
} from "@get-bb/plugin-sdk/app";

export const CREATE_AUTOMATION_PROMPT = "Create a new bb automation to ";

export function withCreateAutomationPrompt(
  draft: ComposerDraftSnapshot,
): ComposerDraftReplacement {
  const leadingCommand = draft.mentions.find(
    (mention) => mention.kind === "command" && mention.from === 0,
  );
  const rest = draft.text.slice(leadingCommand?.to ?? 0).trimStart();
  const body = rest.startsWith(CREATE_AUTOMATION_PROMPT)
    ? rest.slice(CREATE_AUTOMATION_PROMPT.length)
    : rest;
  const removed = draft.text.length - body.length;
  const shift = CREATE_AUTOMATION_PROMPT.length - removed;
  return {
    text: `${CREATE_AUTOMATION_PROMPT}${body}`,
    mentions: draft.mentions
      .filter((mention) => mention.from >= removed)
      .map((mention) => ({
        ...mention,
        from: mention.from + shift,
        to: mention.to + shift,
      })),
  };
}

export const composerCustomization: ComposerCustomization = {
  id: "create-automation",
  plusMenu: [
    {
      id: "automation",
      label: "Automation",
      icon: "Repeat",
      run: ({ composer }) => composer.replace(withCreateAutomationPrompt),
    },
  ],
};
