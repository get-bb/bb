import { Icon } from "@bb/shared-ui/icon";
import { useState } from "react";
import { Switch } from "@bb/shared-ui/switch";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  machineEnvironmentSetSchema,
  type MachineEnvironmentList,
  type MachineEnvironmentVariable,
} from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { sdk } from "@/lib/sdk";
import {
  SettingsBadge,
  SettingsSection,
} from "@/components/ui/settings-section";
import { invalidateSystemConfig } from "@/hooks/cache-owners/system-cache-effects";
import { machineEnvironmentQueryKey } from "@/hooks/queries/query-keys";

type DraftRow = Omit<MachineEnvironmentVariable, "value"> & {
  id: string;
  existing: boolean;
  value: string | null;
};

export function MachineEnvironmentSettings() {
  const queryClient = useQueryClient();
  const settings = useSystemConfig().data?.generalSettings;
  const updateSettings = useUpdateGeneralSettings();
  const query = useQuery({
    queryKey: machineEnvironmentQueryKey(),
    queryFn: () => sdk.system.machineEnvironment(),
  });
  const save = async (rows: readonly DraftRow[]) => {
    await sdk.system.replaceMachineEnvironment({
      variables: rows.map((row) => ({
        name: row.name,
        value: row.value,
        note: row.note,
      })),
    });
  };
  return (
    <MachineEnvironmentSettingsContent
      environment={query.data ?? null}
      loadFailed={query.isError}
      gitCredentialsEnabled={settings?.machineGitCredentialsEnabled ?? true}
      gitSwitchDisabled={!settings || updateSettings.isPending}
      onSave={save}
      onSaved={async () => {
        await query.refetch();
        invalidateSystemConfig({ queryClient });
      }}
      onSaveFailed={() => void query.refetch()}
      onSetGitCredentials={(enabled) => {
        if (!settings) return;
        updateSettings.mutate(
          { ...settings, machineGitCredentialsEnabled: enabled },
          { onSuccess: () => void query.refetch() },
        );
      }}
    />
  );
}

export function MachineEnvironmentSettingsContent({
  environment,
  loadFailed = false,
  gitCredentialsEnabled,
  gitSwitchDisabled = false,
  onSave,
  onSaved,
  onSaveFailed,
  onSetGitCredentials,
}: {
  environment: MachineEnvironmentList | null;
  loadFailed?: boolean;
  gitCredentialsEnabled: boolean;
  gitSwitchDisabled?: boolean;
  onSave: (rows: readonly DraftRow[]) => Promise<void>;
  onSaved?: () => void | Promise<void>;
  onSaveFailed?: () => void;
  onSetGitCredentials: (enabled: boolean) => void;
}) {
  const [draft, setDraft] = useState<DraftRow[] | null>(null);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const rows =
    draft ??
    (environment?.variables ?? []).map((row) => ({
      ...row,
      id: row.name,
      existing: true,
    }));
  const issues = rows.map((row) => {
    if (rows.filter((other) => other.name === row.name).length > 1)
      return "Variable name already exists.";
    const result = machineEnvironmentSetSchema.safeParse({
      name: row.name,
      value: row.value ?? "",
      note: row.note,
    });
    return result.success
      ? null
      : !row.name
        ? "Enter a variable name."
        : "Use uppercase letters, numbers, and underscores; start with a letter or underscore.";
  });
  const mutation = useMutation({
    mutationFn: () => onSave(rows),
    onSuccess: async () => {
      await onSaved?.();
      setDraft(null);
      setVisible(new Set());
      setError(null);
    },
    onError: () => {
      onSaveFailed?.();
      setError(
        "Some changes could not be saved. Your edits are retained; try saving again.",
      );
    },
  });
  const disabled = environment === null || mutation.isPending;
  const change = (id: string, patch: Partial<DraftRow>) => {
    setDraft(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setError(null);
  };
  const hasOverride = rows.some((row) => row.name === "GH_TOKEN");
  const git = environment?.builtInGit;
  const gitDisabled = !gitCredentialsEnabled;
  const gitMissing = git?.status === "not logged in";
  return (
    <SettingsSection
      title="Machine environment"
      description="Configuration for machines provisioned by plugins."
      bodyClassName="space-y-3 rounded-none border-0 bg-transparent p-0"
      action={
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() =>
            setDraft([
              ...rows,
              {
                id: crypto.randomUUID(),
                existing: false,
                name: "",
                value: "",
                secret: true,
                note: null,
              },
            ])
          }
        >
          Add variable
        </Button>
      }
    >
      <div className="space-y-5">
        {!hasOverride && (
          <div className="space-y-2">
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <Input
                className={`col-span-2 font-mono sm:col-span-1 ${gitDisabled ? "opacity-50" : ""}`}
                aria-label="Automatic variable name"
                value="GH_TOKEN"
                readOnly
              />
              <Input
                className={`font-mono ${gitDisabled ? "opacity-50" : ""}`}
                aria-label="Automatic GH_TOKEN value"
                value={git?.status === "logged in" ? "••••••••" : ""}
                placeholder={
                  git?.status === "disabled"
                    ? "Disabled"
                    : gitMissing
                      ? "Not available"
                      : "Checking…"
                }
                readOnly
              />
              <div className="flex size-8 items-center justify-center">
                <Switch
                  aria-label="Automatic GH_TOKEN"
                  checked={gitCredentialsEnabled}
                  disabled={gitSwitchDisabled}
                  onCheckedChange={onSetGitCredentials}
                />
              </div>
            </div>
            <p
              className={`flex min-w-0 items-center gap-1.5 text-xs ${gitDisabled ? "opacity-50" : ""}`}
            >
              <SettingsBadge>Automatic</SettingsBadge>
              <span
                role={gitMissing ? "alert" : "status"}
                className={`min-w-0 truncate ${
                  gitMissing
                    ? "text-destructive-text"
                    : "text-subtle-foreground"
                }`}
              >
                {gitMissing ? (
                  "GitHub is not logged in. Run gh auth login on the server, or add your own GH_TOKEN."
                ) : git?.status === "logged in" ? (
                  <>
                    Generated using{" "}
                    <code>gh auth token --hostname github.com</code>.
                  </>
                ) : git?.status === "disabled" ? (
                  "Disabled — no automatic GitHub credentials are sent to machines."
                ) : git?.status === "overridden" ? (
                  "The server’s GitHub login will be used after saving."
                ) : (
                  "Checking the server’s GitHub login…"
                )}
              </span>
            </p>
          </div>
        )}
        {rows.map((row, index) => (
          <div key={row.id} className="space-y-2">
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <Input
                className="col-span-2 font-mono sm:col-span-1"
                aria-label={`Variable name ${index + 1}`}
                placeholder="KEY"
                value={row.name}
                disabled={disabled}
                readOnly={row.existing}
                aria-invalid={touched.has(row.id) && issues[index] !== null}
                onBlur={() =>
                  setTouched((current) => new Set(current).add(row.id))
                }
                onChange={(event) =>
                  change(row.id, {
                    name: event.target.value,
                  })
                }
              />
              <div className="relative min-w-0">
                <Input
                  className="min-w-0 pr-9 font-mono"
                  aria-label={`Value for ${row.name || `variable ${index + 1}`}`}
                  type={visible.has(row.id) ? "text" : "password"}
                  placeholder={
                    row.value === null
                      ? "Saved secret · enter to replace"
                      : "VALUE"
                  }
                  value={row.value ?? ""}
                  autoComplete="off"
                  disabled={disabled}
                  onChange={(event) =>
                    change(row.id, { value: event.target.value })
                  }
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute inset-y-0 right-0 my-auto size-8 text-subtle-foreground"
                  aria-label={`${visible.has(row.id) ? "Hide" : "Show"} ${row.name || "value"}`}
                  disabled={disabled || row.value === null}
                  onClick={() =>
                    setVisible((current) => {
                      const next = new Set(current);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      return next;
                    })
                  }
                >
                  <Icon
                    name={visible.has(row.id) ? "EyeOff" : "Eye"}
                    className="size-4"
                  />
                </Button>
              </div>
              <Button
                size="icon"
                className="size-8 text-subtle-foreground hover:text-destructive-text"
                variant="ghost"
                aria-label={`Remove ${row.name || "variable"}`}
                disabled={disabled}
                onClick={() =>
                  setDraft(rows.filter((entry) => entry.id !== row.id))
                }
              >
                <Icon name="X" className="size-4" />
              </Button>
            </div>
            {row.name === "GH_TOKEN" && (
              <p className="text-xs text-subtle-foreground">
                Overrides the automatic token from the server’s GitHub login.
              </p>
            )}
            {row.note && (
              <p className="text-xs text-subtle-foreground">{row.note}</p>
            )}
            {touched.has(row.id) && issues[index] && (
              <p role="alert" className="text-xs text-destructive-text">
                {issues[index]}
              </p>
            )}
          </div>
        ))}
      </div>
      {loadFailed && (
        <p role="alert" className="text-xs text-destructive-text">
          Could not load machine variables. Try refreshing this page.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive-text">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {draft !== null && (
          <Button
            size="sm"
            variant="ghost"
            disabled={mutation.isPending}
            onClick={() => {
              setDraft(null);
              setError(null);
              setVisible(new Set());
            }}
          >
            Discard changes
          </Button>
        )}
        <Button
          size="sm"
          disabled={disabled || draft === null || issues.some(Boolean)}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "Saving…" : "Save variables"}
        </Button>
      </div>
    </SettingsSection>
  );
}
