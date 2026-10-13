import type { PromptInput } from "@bb/domain";

function textPrompt(text: string): PromptInput {
  return { type: "text", text, mentions: [] };
}

export function textInput(text: string): PromptInput[] {
  return [textPrompt(text)];
}

export function skillInput(name: string, rest = ""): PromptInput[] {
  const command = `/${name}`;
  return [
    {
      type: "text",
      text: `${command}${rest}`,
      mentions: [
        {
          start: 0,
          end: command.length,
          resource: {
            kind: "command",
            trigger: "/",
            name,
            source: "skill",
            origin: "user",
            label: name,
            argumentHint: null,
          },
        },
      ],
    },
  ];
}
