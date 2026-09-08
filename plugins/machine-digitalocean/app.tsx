import { useEffect, useRef, useState } from "react";
import { Input } from "@bb/shared-ui/input";
import {
  definePluginApp,
  type JsonValue,
  type PluginMachineProviderInputsProps,
} from "@get-bb/plugin-sdk/app";
import { inputsSchema } from "./inputs.js";

function initialInputs(value: JsonValue | null) {
  const defaults = inputsSchema.parse({});
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return defaults;
  return {
    region: typeof value.region === "string" ? value.region : defaults.region,
    size: typeof value.size === "string" ? value.size : defaults.size,
  };
}

function DigitalOceanInputs({
  value,
  onChange,
}: PluginMachineProviderInputsProps) {
  const [inputs, setInputs] = useState(() => initialInputs(value));
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const validation = inputsSchema.safeParse(inputs);
  const error = validation.success
    ? null
    : (validation.error.issues[0]?.message ?? "Enter a valid region and size.");

  useEffect(() => {
    onChangeRef.current(
      error === null
        ? { status: "ready", value: inputs }
        : { status: "blocked", reason: error },
    );
  }, [inputs, error]);

  return (
    <div className="flex min-w-0 flex-col gap-3 text-sm">
      <label className="flex min-w-0 flex-col gap-1.5">
        <span className="text-muted-foreground">Region</span>
        <Input
          aria-label="Region"
          autoCapitalize="none"
          spellCheck={false}
          value={inputs.region}
          onChange={(event) =>
            setInputs((current) => ({ ...current, region: event.target.value }))
          }
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1.5">
        <span className="text-muted-foreground">Size</span>
        <Input
          aria-label="Size"
          autoCapitalize="none"
          spellCheck={false}
          value={inputs.size}
          onChange={(event) =>
            setInputs((current) => ({ ...current, size: event.target.value }))
          }
        />
      </label>
      {error !== null && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_machineProviderInputs({
    machineProviderId: "digitalocean",
    component: DigitalOceanInputs,
  });
});
