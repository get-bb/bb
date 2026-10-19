import { useEffect } from "react";
import type { JsonValue } from "@bb/domain";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { collectPluginAppRegistrations } from "@/lib/plugin-app-definition";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { PluginPendingInteractionComposer } from "@/components/plugin/PluginPendingInteractionComposer";
import { loadPluginAppDefinition } from "../../../../.ladle/plugin-app-module";

installTestPluginRuntime();
const codexApp = await loadPluginAppDefinition(
  import.meta.glob<unknown>("../../../../../../plugins/provider-codex/app.tsx"),
);

export default { title: "plugins/Codex MCP elicitation" };

function Elicitation({ title, data }: { title: string; data: JsonValue }) {
  useEffect(() => {
    setPluginSlotRegistrations(
      "provider-codex",
      makePluginRegistrationSet({
        pendingInteractions:
          collectPluginAppRegistrations(codexApp).pendingInteractions,
      }),
    );
    return () => removePluginSlotRegistrations("provider-codex");
  }, []);
  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-3xl flex-col justify-end p-4">
      <PluginPendingInteractionComposer
        collapsedByDefault={false}
        interaction={{
          id: "codex-elicitation-demo",
          threadId: "thread-demo",
          createdAt: 1,
        }}
        origin="provider"
        request={{
          pluginId: "provider-codex",
          rendererId: "mcp-elicitation",
          title,
          data,
        }}
      />
    </div>
  );
}

const computerUse = {
  kind: "computer_use",
  serverName: "cua_repl",
  message: 'Allow Computer Use to use "Calculator"?',
  app: { id: "com.apple.calculator", name: "Calculator", iconDataUrl: null },
  scopes: ["session", "always"],
  warning: null,
  riskLevel: "low",
} satisfies JsonValue;

export function ComputerUse() {
  return (
    <Elicitation title="Allow Codex to use Calculator?" data={computerUse} />
  );
}

export function ComputerUseHighRisk() {
  return (
    <Elicitation
      title="Allow Codex to use Terminal?"
      data={{
        ...computerUse,
        message: 'Allow Computer Use to use "Terminal"?',
        app: {
          id: "com.apple.Terminal",
          name: "Terminal",
          iconDataUrl: null,
        },
        scopes: ["session"],
        warning:
          "Terminal can run commands with your user's permissions, including reading and deleting files.",
        riskLevel: "high",
      }}
    />
  );
}

export function Form() {
  return (
    <Elicitation
      title="Create the issue in which team?"
      data={{
        kind: "form",
        serverName: "linear",
        message: "Create the issue in which team?",
        fields: [
          {
            name: "team",
            title: "Team",
            description: null,
            required: true,
            kind: "enum",
            options: [
              { value: "eng", label: "Engineering" },
              { value: "design", label: "Design" },
              { value: "ops", label: "Operations" },
            ],
            defaultValue: null,
          },
          {
            name: "title",
            title: "Issue title",
            description: "Shown in the Linear inbox",
            required: true,
            kind: "string",
            defaultValue: null,
            minLength: 1,
            maxLength: null,
            format: null,
          },
          {
            name: "estimate",
            title: "Estimate",
            description: null,
            required: false,
            kind: "integer",
            defaultValue: null,
            minimum: 1,
            maximum: 8,
          },
          {
            name: "urgent",
            title: "Mark as urgent",
            description: null,
            required: false,
            kind: "boolean",
            defaultValue: false,
          },
          {
            name: "labels",
            title: "Labels",
            description: null,
            required: false,
            kind: "multi_enum",
            options: [
              { value: "bug", label: "bug" },
              { value: "ui", label: "ui" },
              { value: "infra", label: "infra" },
            ],
            defaultValue: null,
            minItems: null,
            maxItems: null,
          },
        ],
      }}
    />
  );
}

export function Url() {
  return (
    <Elicitation
      title="Sign in to GitHub to continue."
      data={{
        kind: "url",
        serverName: "github",
        message: "Sign in to GitHub to continue.",
        url: "https://github.com/login/device?code=ABCD-1234",
        elicitationId: "e1",
      }}
    />
  );
}

export function Unsupported() {
  return (
    <Elicitation
      title="Upload a file"
      data={{
        kind: "unsupported",
        serverName: "files",
        message: "Upload a file",
        nativeMode: "form",
        reason: "This form uses fields or constraints BB cannot display.",
      }}
    />
  );
}

export function ToolApproval() {
  return (
    <Elicitation
      title='Allow the deploy MCP server to run tool "delete_widget"?'
      data={{
        kind: "tool_approval",
        serverName: "deploy",
        message: 'Allow the deploy MCP server to run tool "delete_widget"?',
        toolName: null,
        toolDescription: "Delete a widget by id. Destructive.",
        params: [
          { name: "widget_id", label: "widget_id", value: "w-42" },
          { name: "force", label: "force", value: "true" },
        ],
        omittedParamCount: 0,
        scopes: ["session", "always"],
      }}
    />
  );
}
