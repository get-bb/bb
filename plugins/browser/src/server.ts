import type { BbPluginApi, PluginAgentToolResult } from "@get-bb/plugin-sdk";
import {
  browserAgentOperationSchema,
  browserOperationSchema,
  executeBrowserOperation,
} from "./contracts.js";

const toolName = "bb_browser";

function errorResult(error: unknown): PluginAgentToolResult {
  return {
    content: [
      {
        type: "text",
        text: error instanceof Error ? error.message : String(error),
      },
    ],
    isError: true,
  };
}

export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    homepageUrl: {
      type: "string",
      label: "Default URL for new browser tabs",
      description:
        "Used when an agent opens a Browser tab without specifying a URL.",
      default: "https://www.google.com/",
    },
  });

  bb.agents.registerTool({
    name: toolName,
    description:
      "Create, inspect, and control thread-owned native Browser tabs in the calling thread or an explicitly selected destination.",
    instructions:
      "Call operation=list before every action. List is scoped to the calling thread by default; pass threadId and projectId to inspect another destination explicitly. Operation=open creates the first thread-owned Browser tab in the calling thread by default, including when its Browser panel is not mounted. It never falls back to a Browser owned by another thread. To create and control a background Browser in another thread without changing the visible app layout, pass that threadId and projectId; use clientId and windowId from list only to resolve multiple active BB app windows. Omit url to open the configured default URL. Use the returned exact client/window/tab/navigation revision for later actions. Snapshot before ref actions, and never assume an active Browser tab.",
    presentation: {
      label: {
        pending: "Controlling Browser",
        completed: "Controlled Browser",
      },
      icon: { glyph: "Globe" },
    },
    parameters: browserAgentOperationSchema,
    async execute(operation, context) {
      try {
        const { homepageUrl } = await settings.get();
        const parsedOperation = browserOperationSchema.parse(operation);
        const result = await executeBrowserOperation({
          browser: bb,
          context,
          defaultHomepageUrl: homepageUrl,
          operation: parsedOperation,
        });
        return JSON.stringify(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  });

  bb.agents.configure(() => ({ tools: [toolName], skills: ["bb-browser"] }));
}
