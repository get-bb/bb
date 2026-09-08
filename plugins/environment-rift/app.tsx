import { useEffect } from "react";
import {
  definePluginApp,
  experimental_BranchPicker,
  type JsonValue,
  type PluginEnvironmentProviderInputsProps,
} from "@get-bb/plugin-sdk/app";
import { RIFT_ENVIRONMENT_PROVIDER_ID } from "./provider-id.js";
import type { RiftInputs } from "./server.js";

const BranchPicker = experimental_BranchPicker;
const DEFAULT_INPUTS: RiftInputs = { branch: { kind: "default" }, copy: "all" };

export function selectedBranchName(value: JsonValue | null): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const branch = value.branch;
  if (typeof branch !== "object" || branch === null || Array.isArray(branch)) {
    return null;
  }
  return branch.kind === "named" && typeof branch.name === "string"
    ? branch.name
    : null;
}

function RiftInputsControl({
  projectId,
  hostId,
  value,
  onChange,
}: PluginEnvironmentProviderInputsProps) {
  useEffect(() => {
    if (value === null) {
      onChange({ status: "ready", value: DEFAULT_INPUTS });
    }
  }, [value, onChange]);
  const copy =
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.copy === "filtered"
      ? "filtered"
      : "all";
  return (
    <div className="flex items-center gap-2">
      <BranchPicker
        hostId={hostId}
        projectId={projectId}
        label="Branch:"
        placeholder="New branch"
        value={selectedBranchName(value)}
        onChange={(next) => {
          const inputs: RiftInputs =
            next === null
              ? { ...DEFAULT_INPUTS, copy }
              : { branch: { kind: "named", name: next }, copy };
          onChange({ status: "ready", value: inputs });
        }}
      />
      <label className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
        Copy:
        <select
          className="bg-transparent text-xs text-foreground"
          value={copy}
          onChange={(event) =>
            onChange({
              status: "ready",
              value: {
                branch:
                  selectedBranchName(value) === null
                    ? { kind: "default" }
                    : { kind: "named", name: selectedBranchName(value) },
                copy: event.target.value === "filtered" ? "filtered" : "all",
              },
            })
          }
        >
          <option value="all">All files</option>
          <option value="filtered">Filtered</option>
        </select>
      </label>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_environmentProviderInputs({
    environmentProviderId: RIFT_ENVIRONMENT_PROVIDER_ID,
    component: RiftInputsControl,
  });
});
