import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  MachineEnvironmentSet,
  MachineEnvironmentVariable,
} from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Switch } from "@bb/shared-ui/switch";
import { Input } from "@bb/shared-ui/input";
import { sdk } from "@/lib/sdk";
import {
  SettingsBadge,
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
  const [formOpen, setFormOpen] = useState(false);
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
      setFormOpen(false);
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
    setFormOpen(true);
    setError(null);
  };
  return (
    <SettingsSection
      title="Machine environment"
      description="Variables shared by enrolled machines. Changes apply to new agent turns, setup commands, and terminals."
      bodyClassName="space-y-5"
      action={
        <Button
          size="sm"
          variant="outline"
          disabled={formOpen || mutation.isPending}
          onClick={() => setFormOpen(true)}
        >
          Add variable
        </Button>
      }
    >
      <SettingsWithControl
        label="GitHub credentials"
        description={
          query.data?.builtInGit.statusMessage ?? "Checking the server gh login"
        }
      >
        <SettingsBadge>
          {query.data?.builtInGit.status ?? "Checking…"}
        </SettingsBadge>
      </SettingsWithControl>
      {query.isError ? (
        <p role="alert" className="text-xs text-destructive-text">
          Could not load machine variables. Try refreshing this page.
        </p>
      ) : null}
      {query.data?.variables.length === 0 && !formOpen ? (
        <p className="border-t border-border pt-4 text-xs text-subtle-foreground">
          No custom variables. Add values or secrets to make them available on
          your machines.
        </p>
      ) : null}
      {query.data && query.data.variables.length > 0 ? (
        <div className="divide-y divide-border border-t border-border pt-4">
          {query.data?.variables.map((row) => (
            <div key={row.name} className="py-4 first:pt-0 last:pb-0">
              <SettingsWithControl
                label={row.name}
                description={`${row.secret ? "Secret value configured" : (row.value ?? "")}${row.note ? ` · ${row.note}` : ""}`}
              >
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Edit ${row.name}`}
                    onClick={() => edit(row)}
                    disabled={mutation.isPending}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${row.name}`}
                    onClick={() => mutation.mutate(row.name)}
                    disabled={mutation.isPending}
                  >
                    Remove
                  </Button>
                </div>
              </SettingsWithControl>
            </div>
          ))}
        </div>
      ) : null}
      {formOpen ? (
        <form
          className="space-y-4 border-t border-border pt-5"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate(draft);
          }}
        >
          <p className="text-sm font-medium">
            {editing ? "Edit variable" : "New variable"}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5 text-xs text-subtle-foreground">
              <span>Name</span>
              <Input
                className="font-mono"
                aria-label="Variable name"
                placeholder="VARIABLE_NAME"
                value={draft.name}
                disabled={editing || mutation.isPending}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
            </label>
            <label className="block space-y-1.5 text-xs text-subtle-foreground">
              <span>{editing && draft.secret ? "New value" : "Value"}</span>
              <Input
                aria-label="Variable value"
                placeholder={
                  draft.secret ? "Enter a new secret value" : "Value"
                }
                type={
                  draft.secret || draft.name === "GH_TOKEN"
                    ? "password"
                    : "text"
                }
                autoComplete="off"
                value={draft.value}
                onChange={(event) =>
                  setDraft({ ...draft, value: event.target.value })
                }
              />
            </label>
          </div>
          <SettingsWithControl
            label="Secret value"
            description="Hidden after saving. GitHub tokens are always stored as secrets."
          >
            <Switch
              aria-label="Secret value"
              checked={draft.secret || draft.name === "GH_TOKEN"}
              disabled={draft.name === "GH_TOKEN" || mutation.isPending}
              onCheckedChange={(secret) => setDraft({ ...draft, secret })}
            />
          </SettingsWithControl>
          <label className="block space-y-1.5 text-xs text-subtle-foreground">
            <span>
              Note <span className="text-subtle-foreground/70">(optional)</span>
            </span>
            <Input
              aria-label="Variable note"
              placeholder="Note (optional)"
              value={draft.note ?? ""}
              onChange={(event) =>
                setDraft({ ...draft, note: event.target.value || null })
              }
            />
          </label>
          {error ? (
            <p role="alert" className="text-xs text-destructive-text">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              size="sm"
              type="submit"
              disabled={!draft.name || mutation.isPending}
            >
              {editing ? "Save variable" : "Add variable"}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={mutation.isPending}
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setFormOpen(false);
                setError(null);
                setDraft(empty);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </SettingsSection>
  );
}
