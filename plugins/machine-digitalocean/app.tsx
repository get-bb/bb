import { DevboxSettings } from "./settings.js";
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
    idleMinutes:
      typeof value.idleMinutes === "number" ? value.idleMinutes : null,
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
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
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
      <label className="flex flex-col gap-1.5">
        <span>Idle stop after minutes (empty disables)</span>
        <Input
          aria-label="Idle stop minutes"
          type="number"
          min={1}
          value={inputs.idleMinutes ?? ""}
          onChange={(event) =>
            setInputs((current) => ({
              ...current,
              idleMinutes:
                event.target.value === "" ? null : Number(event.target.value),
            }))
          }
        />
      </label>
      <p>
        Powered-off droplets still bill; snapshot storage bills per GB.{" "}
        <a
          href="https://docs.digitalocean.com/products/droplets/details/pricing/"
          target="_blank"
          rel="noreferrer"
        >
          Droplet pricing
        </a>{" "}
        ·{" "}
        <a
          href="https://docs.digitalocean.com/products/snapshots/details/pricing/"
          target="_blank"
          rel="noreferrer"
        >
          Snapshot pricing
        </a>
      </p>
      {error !== null && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({ id: "devboxes", component: DevboxSettings });
  app.slots.experimental_machineProviderInputs({
    machineProviderId: "digitalocean",
    component: DigitalOceanInputs,
  });
});
