import { useMemo, useState } from "react";
import {
  definePluginApp,
  type PluginPendingInteractionProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  REFUSAL_FALLBACK_RENDERER_ID,
  refusalFallbackPayloadSchema,
  type RefusalFallbackOption,
  type RefusalFallbackResponse,
} from "./src/contracts.js";

interface ModelRowProps {
  checked: boolean;
  option: RefusalFallbackOption;
  onSelect: () => void;
}

function ModelRow({ checked, option, onSelect }: ModelRowProps) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors",
        checked ? "bg-surface-selected" : "hover:bg-state-hover",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
          checked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input",
        )}
      >
        {checked ? <Icon name="Check" className="size-3" aria-hidden /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">
          {option.label}
        </span>
        {option.description ? (
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
            {option.description}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function RefusalFallbackInteraction({
  interaction,
  submit,
  cancel,
}: PluginPendingInteractionProps) {
  const parsed = useMemo(
    () => refusalFallbackPayloadSchema.safeParse(interaction.payload),
    [interaction.payload],
  );
  const options = parsed.success ? parsed.data.options : [];
  const [selected, setSelected] = useState(() => options[0]?.model ?? null);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);

  const finish = (response: RefusalFallbackResponse): void => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      try {
        await submit(response);
      } catch {
      } finally {
        setBusy(false);
      }
    })();
  };

  const handleCancel = (): void => {
    void (async () => {
      try {
        await cancel();
      } catch {}
    })();
  };

  if (!parsed.success) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          This refusal could not be displayed.
        </p>
        <Button type="button" variant="outline" onClick={handleCancel}>
          Cancel
        </Button>
      </div>
    );
  }

  const payload = parsed.data;

  return (
    <div className="flex min-h-0 flex-col text-xs text-muted-foreground">
      <div className="text-sm font-semibold text-foreground">
        {payload.refusedModelLabel} refused this message
      </div>
      <p className="mt-1 leading-snug">{payload.detail}</p>
      <div className="mt-2 space-y-0.5">
        {payload.options.map((option) => (
          <ModelRow
            key={option.model}
            checked={selected === option.model}
            option={option}
            onSelect={() => setSelected(option.model)}
          />
        ))}
      </div>
      <label className="mt-2 flex items-center gap-2 px-2.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={remember}
          disabled={busy}
          onChange={(event) => setRemember(event.target.checked)}
        />
        Switch automatically next time, do not ask again
      </label>
      <div className="mt-3 flex shrink-0 items-center justify-between gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => finish({ model: null, remember: false })}
        >
          Keep {payload.refusedModelLabel}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy || selected === null}
          onClick={() =>
            selected === null
              ? undefined
              : finish({ model: selected, remember })
          }
        >
          {busy ? (
            <Icon name="Spinner" className="size-3 animate-spin" />
          ) : null}
          Switch and retry
        </Button>
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.pendingInteraction({
    id: REFUSAL_FALLBACK_RENDERER_ID,
    component: RefusalFallbackInteraction,
  });
});
