import {
  definePluginApp,
  type ComposerDraftReplacement,
  type ComposerDraftSnapshot,
} from "@get-bb/plugin-sdk/app";

const CREATE_PLUGIN_PROMPT = "Create a new bb plugin that ";

export function withCreatePluginPrompt(
  draft: ComposerDraftSnapshot,
): ComposerDraftReplacement {
  const leadingCommand = draft.mentions.find(
    (mention) => mention.kind === "command" && mention.from === 0,
  );
  const rest = draft.text.slice(leadingCommand?.to ?? 0).trimStart();
  const body = rest.startsWith(CREATE_PLUGIN_PROMPT)
    ? rest.slice(CREATE_PLUGIN_PROMPT.length)
    : rest;
  const removed = draft.text.length - body.length;
  const shift = CREATE_PLUGIN_PROMPT.length - removed;
  return {
    text: `${CREATE_PLUGIN_PROMPT}${body}`,
    mentions: draft.mentions
      .filter((mention) => mention.from >= removed)
      .map((mention) => ({
        ...mention,
        from: mention.from + shift,
        to: mention.to + shift,
      })),
  };
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "create-plugin",
    plusMenu: [
      {
        id: "plugin",
        label: "Plugin",
        icon: "Plug02",
        run: ({ composer }) => composer.replace(withCreatePluginPrompt),
      },
    ],
  });
});
