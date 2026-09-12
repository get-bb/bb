import {
  type DeltaItemKey,
  type DeltaPresentation,
  type ThreadDelta,
  experimental_presentationFileName as presentationFileName,
  experimental_presentationTitle as presentationTitle,
  experimental_toolPresentation as toolPresentation,
  experimental_withTitle as withTitle,
} from "@get-bb/plugin-sdk/provider-bridge";

const AGENT_MESSAGE_PRESENTATION: DeltaPresentation = {
  label: { pending: "Responding", completed: "Responded" },
  icon: { glyph: "MessageSquare" },
};

export function agentMessageOpen(key: DeltaItemKey): ThreadDelta {
  return {
    kind: "item.open",
    key,
    item: { type: "agentMessage", text: "" },
    presentation: AGENT_MESSAGE_PRESENTATION,
  };
}

export function agentMessageClose(
  key: DeltaItemKey,
  text: string,
  status: "completed" | "interrupted" = "completed",
): ThreadDelta {
  return {
    kind: "item.close",
    key,
    status,
    item: { type: "agentMessage", text },
    presentation: AGENT_MESSAGE_PRESENTATION,
  };
}

export function commandPresentation(command: string): DeltaPresentation {
  return withTitle(
    {
      label: { pending: "Running command", completed: "Ran command" },
      icon: { glyph: "Terminal" },
    },
    presentationTitle(command),
  );
}

export function fileChangePresentation(path: string): DeltaPresentation {
  return withTitle(
    {
      label: { pending: "Editing file", completed: "Edited file" },
      icon: { glyph: "EditFile" },
    },
    presentationTitle(presentationFileName(path)),
  );
}

export function taskUpdatePresentation(subject: string): DeltaPresentation {
  return withTitle(
    {
      label: { pending: "Updating task", completed: "Updated task" },
      icon: { glyph: "ListTodo" },
      suppress: true,
    },
    presentationTitle(subject),
  );
}

export function mcpToolPresentation(args: {
  server: string;
  tool: string;
}): DeltaPresentation {
  return withTitle(toolPresentation(args.tool), presentationTitle(args.server));
}
