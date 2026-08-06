import {
  createFauxCore,
  fauxAssistantMessage,
  fauxToolCall,
  Type,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";

const provider = createFauxCore({
  api: "bb-config-e2e-api",
  provider: "bb-config-e2e",
  models: [
    {
      id: "bb-config-e2e-model",
      name: "BB Pi configuration test model",
      reasoning: true,
    },
  ],
});

provider.setResponses([
  fauxAssistantMessage(
    [
      fauxToolCall(
        "configured_tool",
        { value: "extension tool input" },
        { id: "configured-tool-call" },
      ),
      fauxToolCall(
        "bb_dynamic_tool",
        { value: "BB tool input" },
        { id: "bb-tool-call" },
      ),
    ],
    { stopReason: "toolUse" },
  ),
  fauxAssistantMessage("Pi configuration and tools completed."),
]);

export default function configurePi(pi: ExtensionAPI): void {
  pi.registerProvider("bb-config-e2e", {
    api: provider.api,
    apiKey: "bb-config-e2e-key",
    baseUrl: "http://127.0.0.1:1",
    models: provider.models.map((model) => ({
      id: model.id,
      name: model.name,
      reasoning: model.reasoning,
      input: model.input,
      cost: model.cost,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    })),
    streamSimple: provider.streamSimple,
  });

  pi.registerTool({
    name: "configured_tool",
    label: "Configured tool",
    description: "A tool from the user's Pi extension.",
    parameters: Type.Object({ value: Type.String() }),
    async execute(_toolCallId, params) {
      const markerPath = process.env.BB_PI_E2E_TOOL_MARKER;
      if (!markerPath) {
        throw new Error("BB_PI_E2E_TOOL_MARKER is not set");
      }
      writeFileSync(markerPath, params.value, "utf8");
      return {
        content: [{ type: "text", text: `Configured tool: ${params.value}` }],
        details: {},
      };
    },
  });

  pi.on("before_agent_start", (_event, context) => {
    const markerPath = process.env.BB_PI_E2E_SESSION_MARKER;
    if (!markerPath) {
      throw new Error("BB_PI_E2E_SESSION_MARKER is not set");
    }
    writeFileSync(
      markerPath,
      JSON.stringify({
        model: context.model?.id,
        provider: context.model?.provider,
        thinkingLevel: context.thinkingLevel,
      }),
      "utf8",
    );
  });
}
