import { useMemo, useState } from "react";
import {
  definePluginApp,
  type PluginPendingInteractionProps,
} from "@bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { Label } from "@bb/shared-ui/label";
import {
  secretRequestPayloadSchema,
  secretRequestResponseSchema,
} from "./src/contracts.js";
import { reconcileDotenv } from "./src/dotenv.js";

function SecretRequestInteraction({
  interaction,
  submit,
  cancel,
}: PluginPendingInteractionProps) {
  const parsed = useMemo(
    () => secretRequestPayloadSchema.safeParse(interaction.payload),
    [interaction.payload],
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!parsed.success) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          This secret request is invalid.
        </p>
        <Button
          variant="outline"
          onClick={() => void cancel().catch(() => undefined)}
        >
          Cancel
        </Button>
      </div>
    );
  }
  const payload = parsed.data;
  const complete = payload.fields.every(
    (field) => (values[field.name] ?? "").length > 0,
  );
  const submitValues = async () => {
    const validated = secretRequestResponseSchema.safeParse({ values });
    if (!validated.success) {
      setFormError(
        "Every secret must be a non-empty single-line value no larger than 16 KiB.",
      );
      return;
    }
    try {
      reconcileDotenv("", validated.data.values);
    } catch {
      setFormError(
        "One value cannot be represented safely in a dotenv assignment.",
      );
      return;
    }
    setFormError(null);
    setBusy(true);
    try {
      try {
        await submit({ values });
        setValues({});
      } catch {
        // The host renders the submission error outside this plugin form.
      }
    } finally {
      setBusy(false);
    }
  };
  const cancelRequest = async () => {
    try {
      await cancel();
    } catch {
      // The host renders the cancellation error outside this plugin form.
    }
  };

  return (
    <div className="space-y-4">
      {payload.purpose ? (
        <p className="text-sm text-muted-foreground">{payload.purpose}</p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Destination: {payload.destination.path}
      </p>
      {payload.fields.map((field) => (
        <div key={field.name} className="space-y-1.5">
          <Label htmlFor={`secret-${interaction.id}-${field.name}`}>
            {field.name}
          </Label>
          {field.description ? (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          ) : null}
          <div className="flex gap-2">
            <Input
              id={`secret-${interaction.id}-${field.name}`}
              type={revealed[field.name] ? "text" : "password"}
              autoComplete="off"
              value={values[field.name] ?? ""}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [field.name]: event.target.value,
                }))
              }
              disabled={busy}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setRevealed((current) => ({
                  ...current,
                  [field.name]: !current[field.name],
                }))
              }
              disabled={busy}
            >
              {revealed[field.name] ? "Hide" : "Show"}
            </Button>
          </div>
        </div>
      ))}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void cancelRequest()}
        >
          Cancel
        </Button>
        <Button
          type="button"
          disabled={busy || !complete}
          onClick={() => void submitValues()}
        >
          Add secrets
        </Button>
      </div>
      {formError ? (
        <p className="text-sm text-destructive">{formError}</p>
      ) : null}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.pendingInteraction({
    id: "secret-request",
    component: SecretRequestInteraction,
  });
});
