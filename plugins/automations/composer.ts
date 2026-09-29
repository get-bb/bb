import type {
  ComposerCustomization,
  ComposerDraftReplacement,
  ComposerDraftSnapshot,
} from "@get-bb/plugin-sdk/app";

const AUTOMATION_COMMAND = "/automation";

export function withAutomationCommand(
  draft: ComposerDraftSnapshot,
): ComposerDraftReplacement {
  const leadingCommand = draft.mentions.find(
    (mention) => mention.kind === "command" && mention.from === 0,
  );
  const rest = draft.text.slice(leadingCommand?.to ?? 0).trimStart();
  const removed = draft.text.length - rest.length;
  const shift = AUTOMATION_COMMAND.length + 1 - removed;
  return {
    text: `${AUTOMATION_COMMAND} ${rest}`,
    mentions: [
      {
        kind: "command",
        trigger: "/",
        name: "automation",
        source: "command",
        origin: "user",
        argumentHint: null,
        label: "automation",
        from: 0,
        to: AUTOMATION_COMMAND.length,
      },
      ...draft.mentions
        .filter((mention) => mention.from >= removed)
        .map((mention) => ({
          ...mention,
          from: mention.from + shift,
          to: mention.to + shift,
        })),
    ],
  };
}

export const composerCustomization: ComposerCustomization = {
  id: "create-automation",
  plusMenu: [
    {
      id: "automation",
      label: "Automation",
      icon: "Repeat",
      run: ({ composer }) => composer.replace(withAutomationCommand),
    },
  ],
};
