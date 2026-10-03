import { useState } from "react";
import {
  definePluginApp,
  type PluginPendingInteractionProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import {
  buildMcpElicitationResponse,
  mcpElicitationSchema,
} from "./src/mcp-elicitation.js";

function Elicitation({ interaction, submit }: PluginPendingInteractionProps) {
  const parsed = mcpElicitationSchema.safeParse(interaction.payload);
  const [values, setValues] = useState(() => new Map<string, string>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finish = async (
    action: "accept" | "decline" | "cancel",
    persist?: "session" | "always",
  ) => {
    if (busy) return;
    setError(null);
    try {
      if (!parsed.success) {
        if (action !== "cancel") return;
        await submit({ action });
        return;
      }
      const content: Record<string, string | number | boolean> = {};
      if (action === "accept") {
        for (const [name, field] of Object.entries(
          parsed.data.requestedSchema.properties,
        )) {
          const value =
            values.get(name) ??
            (field.default == null ? "" : String(field.default));
          if (value === "" && field.type !== "string") continue;
          if (
            value === "" &&
            !(parsed.data.requestedSchema.required ?? []).includes(name)
          )
            continue;
          content[name] =
            field.type === "boolean"
              ? value === "true"
              : field.type === "string"
                ? value
                : Number(value);
        }
      }
      const answer =
        action === "accept"
          ? { action, content, ...(persist ? { persist } : {}) }
          : { action };
      buildMcpElicitationResponse(parsed.data, answer);
      setBusy(true);
      await submit(answer);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not submit response",
      );
    } finally {
      setBusy(false);
    }
  };
  if (!parsed.success)
    return (
      <div className="space-y-2 text-sm">
        <p>Unsupported MCP request.</p>
        <Button onClick={() => void finish("cancel")}>Cancel</Button>
      </div>
    );
  const request = parsed.data;
  const controlClass =
    "w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-foreground";
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">MCP server: {request.serverName}</p>
      <p className="whitespace-pre-wrap break-words">{request.message}</p>
      {request.metadata?.riskLevel ? (
        <p>Risk: {request.metadata.riskLevel}</p>
      ) : null}
      {request.metadata?.subtitle ? (
        <p className="whitespace-pre-wrap">{request.metadata.subtitle}</p>
      ) : null}
      {request.metadata?.tool_params_display?.map((param, index) => (
        <p key={index}>
          {param.display_name}: {param.value}
        </p>
      ))}
      {Object.entries(request.requestedSchema.properties).map(
        ([name, field]) => {
          const value =
            values.get(name) ??
            (field.default == null ? "" : String(field.default));
          const id = `${interaction.id}-${name}`;
          return (
            <div key={name} className="space-y-1">
              <label htmlFor={id}>{field.title ?? name}</label>
              {field.description ? (
                <p className="text-muted-foreground">{field.description}</p>
              ) : null}
              {field.type === "boolean" ||
              (field.type === "string" && field.enum) ? (
                <select
                  id={id}
                  className={controlClass}
                  disabled={busy}
                  value={value}
                  onChange={(e) =>
                    setValues((v) => new Map(v).set(name, e.target.value))
                  }
                >
                  <option value="">Choose…</option>
                  {(field.type === "boolean"
                    ? ["true", "false"]
                    : field.enum!
                  ).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={id}
                  className={controlClass}
                  disabled={busy}
                  type={field.type === "string" ? "text" : "number"}
                  value={value}
                  onChange={(e) =>
                    setValues((v) => new Map(v).set(name, e.target.value))
                  }
                />
              )}
            </div>
          );
        },
      )}
      {error ? (
        <p role="alert" className="text-destructive whitespace-pre-wrap">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void finish("cancel")}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void finish("decline")}
        >
          Decline
        </Button>
        {request.metadata?.persist ? (
          request.metadata.persist.map((scope) => (
            <Button
              key={scope}
              size="sm"
              disabled={busy}
              onClick={() => void finish("accept", scope)}
            >
              {scope === "session" ? "Allow for this session" : "Always allow"}
            </Button>
          ))
        ) : (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void finish("accept")}
          >
            Accept
          </Button>
        )}
      </div>
    </div>
  );
}
export default definePluginApp((app) => {
  app.slots.pendingInteraction({
    id: "mcp-elicitation",
    component: Elicitation,
  });
});
