import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  MachineEnvironmentSet,
  MachineEnvironmentVariable,
} from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { sdk } from "@/lib/sdk";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section";
import { invalidateSystemConfig } from "@/hooks/cache-owners/system-cache-effects";

const queryKey = ["machine-environment"];
const empty: MachineEnvironmentSet = {
  name: "",
  value: "",
  secret: false,
  note: null,
};

export function MachineEnvironmentSettings() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey,
    queryFn: () => sdk.system.machineEnvironment(),
  });
  const [draft, setDraft] = useState<MachineEnvironmentSet>(empty);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (input: MachineEnvironmentSet | string) =>
      typeof input === "string"
        ? sdk.system.unsetMachineEnvironment(input)
        : sdk.system.setMachineEnvironment(input),
    onSuccess: () => {
      void query.refetch();
      invalidateSystemConfig({ queryClient });
      setDraft(empty);
      setEditing(false);
      setError(null);
    },
    onError: () =>
      setError(
        "Could not update the machine environment. Use a valid variable name and try again.",
      ),
  });
  const edit = (row: MachineEnvironmentVariable) => {
    setDraft({ ...row, value: row.value ?? "" });
    setEditing(true);
  };
  return (
    <SettingsSection
      title="Machine environment"
      description="Applies to new agent turns, setup commands, and terminals on every machine. User variables override built-ins."
    >
      <SettingsWithControl
        label="Built-in GitHub credentials"
        description={
          query.data?.builtInGit.statusMessage ?? "Checking the server gh login"
        }
      >
        <span>{query.data?.builtInGit.status ?? "Checking…"}</span>
      </SettingsWithControl>
      {query.data?.variables.map((row) => (
        <SettingsWithControl
          key={row.name}
          label={row.name}
          description={
            row.note ??
            (row.secret ? "Secret value configured" : (row.value ?? ""))
          }
        >
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => edit(row)}
              disabled={mutation.isPending}
            >
              Edit {row.name}
            </Button>
            <Button
              variant="ghost"
              onClick={() => mutation.mutate(row.name)}
              disabled={mutation.isPending}
            >
              Remove {row.name}
            </Button>
          </div>
        </SettingsWithControl>
      ))}
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate(draft);
        }}
      >
        <Input
          aria-label="Variable name"
          placeholder="VARIABLE_NAME"
          value={draft.name}
          disabled={editing || mutation.isPending}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
        <Input
          aria-label="Variable value"
          placeholder={draft.secret ? "Enter a new secret value" : "Value"}
          type={draft.secret || draft.name === "GH_TOKEN" ? "password" : "text"}
          autoComplete="off"
          value={draft.value}
          onChange={(event) =>
            setDraft({ ...draft, value: event.target.value })
          }
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.secret || draft.name === "GH_TOKEN"}
            disabled={draft.name === "GH_TOKEN"}
            onChange={(event) =>
              setDraft({ ...draft, secret: event.target.checked })
            }
          />
          Secret — hidden after saving
        </label>
        <Input
          aria-label="Variable note"
          placeholder="Note (optional)"
          value={draft.note ?? ""}
          onChange={(event) =>
            setDraft({ ...draft, note: event.target.value || null })
          }
        />
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={!draft.name || mutation.isPending}>
            {editing ? "Save variable" : "Add variable"}
          </Button>
          {editing ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setDraft(empty);
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
    </SettingsSection>
  );
}
