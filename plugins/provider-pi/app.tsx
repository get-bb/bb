import { useMemo, useState, type FormEvent } from "react";
import {
  definePluginApp,
  type PluginPendingInteractionProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  PI_EXTENSION_UI_RENDERER_ID,
  piExtensionUiPayloadDataSchema,
  type PiExtensionUiMethod,
} from "./src/extension-ui-contract.js";

interface ParsedRequest {
  requestId: string;
  method: PiExtensionUiMethod;
  options?: string[];
  message?: string;
  placeholder?: string;
  prefill?: string;
}

function parseRequest(payload: unknown): ParsedRequest | null {
  if (typeof payload !== "object" || payload === null) return null;
  const direct = piExtensionUiPayloadDataSchema.safeParse(payload);
  if (direct.success) return direct.data;
  const data = (payload as { data?: unknown }).data;
  const wrapped = piExtensionUiPayloadDataSchema.safeParse(data);
  return wrapped.success ? wrapped.data : null;
}

function ExtensionUiInteraction({
  interaction,
  submit,
  cancel,
}: PluginPendingInteractionProps) {
  const request = useMemo(() => parseRequest(interaction.payload), [interaction.payload]);
  const [text, setText] = useState(request?.prefill ?? "");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!request) {
    return (
      <div className="space-y-3 text-xs text-muted-foreground">
        <p>This request could not be displayed.</p>
        <Button type="button" size="sm" variant="outline" onClick={() => void cancel()}>
          Cancel
        </Button>
      </div>
    );
  }

  const finish = (value: unknown) => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      try {
        await submit(value as never);
      } catch {
      } finally {
        setBusy(false);
      }
    })();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (request.method === "confirm") return;
    if (request.method === "select") {
      if (selected !== null) finish(selected);
      return;
    }
    finish(text);
  };

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 text-xs text-muted-foreground"
    >
      {request.message ? <p className="text-sm text-foreground">{request.message}</p> : null}
      {request.method === "select" ? (
        <fieldset className="flex flex-col gap-1.5" disabled={busy}>
          {(request.options ?? []).map((option) => (
            <label
              key={option}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground",
                selected === option && "border-ring bg-surface-raised",
              )}
            >
              <input
                type="radio"
                name={request.requestId}
                className="size-3.5"
                checked={selected === option}
                onChange={() => setSelected(option)}
              />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {request.method === "input" ? (
        <input
          type="text"
          className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-foreground focus-visible:border-ring/50 focus-visible:outline-none"
          value={text}
          placeholder={request.placeholder}
          autoFocus
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
        />
      ) : null}
      {request.method === "editor" ? (
        <textarea
          className="min-h-32 w-full resize-y rounded-md border border-border bg-surface-raised px-3 py-2 font-mono text-sm text-foreground focus-visible:border-ring/50 focus-visible:outline-none"
          value={text}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
        />
      ) : null}
      {request.method === "confirm" ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => finish(false)}
          >
            No
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={() => finish(true)}>
            Yes
          </Button>
        </div>
      ) : null}
      {request.method !== "confirm" ? (
        <div className="flex items-center justify-between gap-2">
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void cancel()}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={busy || (request.method === "select" && selected === null)}
          >
            Submit
          </Button>
        </div>
      ) : null}
    </form>
  );
}

export default definePluginApp((app) => {
  app.slots.pendingInteraction({
    id: PI_EXTENSION_UI_RENDERER_ID,
    component: ExtensionUiInteraction,
  });
});
