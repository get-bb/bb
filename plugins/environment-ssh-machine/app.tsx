import { useEffect, useId, useRef, useState } from "react";
import {
  definePluginApp,
  useRpc,
  type JsonValue,
  type PluginMachineProviderInputsProps,
} from "@get-bb/plugin-sdk/app";
import { sshDestinationSchema } from "./configuration.js";
import { sshMachineRpcContract } from "./contract.js";
import { SSH_MACHINE_PROVIDER_ID } from "./provider-id.js";

export function selectedTargetName(value: JsonValue | null): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return typeof value.target === "string" ? value.target : null;
}

function SshMachineInputsControl({
  value,
  onChange,
}: PluginMachineProviderInputsProps) {
  const rpc = useRpc<typeof sshMachineRpcContract>();
  const aliasesId = useId();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [targets, setTargets] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [target, setTarget] = useState(selectedTargetName(value) ?? "");

  useEffect(() => {
    let active = true;
    void rpc
      .call("listTargets", null)
      .then((aliases) => {
        if (!active) return;
        setTargets(aliases);
        setTarget((current) => current || aliases[0] || "");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [rpc]);

  useEffect(() => {
    if (targets === null && loadError === null) {
      onChangeRef.current({ status: "blocked", reason: "Loading SSH hosts…" });
      return;
    }
    const parsed = sshDestinationSchema.safeParse(target);
    if (!parsed.success) {
      onChangeRef.current({
        status: "blocked",
        reason:
          parsed.error.issues[0]?.message ?? "Enter an SSH host or alias.",
      });
      return;
    }
    onChangeRef.current({ status: "ready", value: { target: parsed.data } });
  }, [loadError, target, targets]);

  if (targets === null && loadError === null) {
    return (
      <span className="text-sm text-muted-foreground">Loading SSH hosts…</span>
    );
  }

  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-sm">
      <span className="text-muted-foreground">SSH host</span>
      <input
        aria-label="SSH host"
        list={aliasesId}
        className="min-w-0 rounded-md border border-input bg-background px-3 py-2 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={target}
        placeholder="alias or user@host"
        onChange={(event) => setTarget(event.target.value)}
      />
      <datalist id={aliasesId}>
        {(targets ?? []).map((alias) => (
          <option key={alias} value={alias} />
        ))}
      </datalist>
      {loadError === null ? (
        <span className="text-xs text-subtle-foreground">
          Pick a Host alias from ~/.ssh/config or enter user@host.
        </span>
      ) : (
        <span className="text-xs text-destructive">{loadError}</span>
      )}
    </label>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_machineProviderInputs({
    machineProviderId: SSH_MACHINE_PROVIDER_ID,
    component: SshMachineInputsControl,
  });
});
