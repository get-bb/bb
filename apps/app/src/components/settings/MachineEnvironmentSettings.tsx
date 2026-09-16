import { Link } from "react-router-dom";
import { OptionPicker } from "@/components/pickers/OptionPicker";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { Icon } from "@bb/shared-ui/icon";
import { useState, type ReactNode } from "react";
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
import { SettingsSection } from "@/components/ui/settings-section";
import { getSettingsSectionRoutePath } from "@/components/settings/settings-sections";
import { MachineEnvironmentImportDialog } from "@/components/settings/MachineEnvironmentImportDialog";
import type { ParsedEnvEntry } from "@/lib/parse-env-file";
import {
  invalidateMachineEnvironment,
  invalidateSystemConfig,
} from "@/hooks/cache-owners/system-cache-effects";
import { machineEnvironmentQueryKey } from "@/hooks/queries/query-keys";

const GLOBAL_SCOPE = "global";

type DraftRow = Omit<MachineEnvironmentVariable, "value"> & {
  id: string;
  nameLocked: boolean;
  value: string | null;
};

type EnvironmentEntry =
  | { kind: "inherited"; variable: MachineEnvironmentVariable }
  | { kind: "row"; row: DraftRow; index: number; overridesGlobal: boolean };

export function MachineEnvironmentSettings() {
  const [scope, setScope] = useState(GLOBAL_SCOPE);
  const projects = useSidebarNavigation().data?.projects ?? [];
  const selected = projects.find((project) => project.id === scope) ?? null;
  return (
    <ScopedMachineEnvironmentSettings
      key={selected?.id ?? GLOBAL_SCOPE}
      projectId={selected?.id ?? null}
      scopeControl={
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="text-sm text-subtle-foreground">
            Showing variables for
          </span>
          <OptionPicker
            modal={false}
            label="Scope"
            className="text-sm"
            value={selected?.id ?? GLOBAL_SCOPE}
            onChange={setScope}
            options={[
              { value: GLOBAL_SCOPE, label: "All projects" },
              ...projects.map((project) => ({
                value: project.id,
                label: project.name,
              })),
            ]}
          />
        </div>
      }
    />
  );
}

export function ScopedMachineEnvironmentSettings({
  projectId,
  scopeControl,
}: {
  projectId: string | null;
  scopeControl?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const settings = useSystemConfig().data?.generalSettings;
  const updateSettings = useUpdateGeneralSettings();
  const query = useQuery({
    queryKey: machineEnvironmentQueryKey(projectId),
    queryFn: async () =>
      projectId === null
        ? { ...(await sdk.system.machineEnvironment()), inheritedVariables: [] }
        : sdk.projects.machineEnvironment({ projectId }),
  });
  const save = async (rows: readonly DraftRow[]) => {
    const input = {
      variables: rows.map((row) => ({
        name: row.name,
        value: row.value,
        note: row.note,
      })),
    };
    if (projectId === null) await sdk.system.replaceMachineEnvironment(input);
    else await sdk.projects.replaceMachineEnvironment({ ...input, projectId });
  };
  return (
    <MachineEnvironmentSettingsContent
      key={projectId ?? GLOBAL_SCOPE}
      projectScope={projectId !== null}
      scopeControl={scopeControl}
      inheritedVariables={query.data?.inheritedVariables ?? []}
      environment={query.data ?? null}
      loadFailed={query.isError}
      gitCredentialsEnabled={settings?.machineGitCredentialsEnabled ?? true}
      gitSwitchDisabled={!settings || updateSettings.isPending}
      onSave={save}
      onSaved={() => {
        invalidateMachineEnvironment({ queryClient });
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
  projectScope = false,
  scopeControl,
  inheritedVariables = [],
  loadFailed = false,
  gitCredentialsEnabled,
  gitSwitchDisabled = false,
  onSave,
  onSaved,
  onSaveFailed,
  onSetGitCredentials,
}: {
  environment: MachineEnvironmentList | null;
  projectScope?: boolean;
  scopeControl?: ReactNode;
  inheritedVariables?: readonly MachineEnvironmentVariable[];
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
  const [importing, setImporting] = useState(false);
  const rows =
    draft ??
    (environment?.variables ?? []).map((row) => ({
      ...row,
      id: row.name,
      nameLocked: true,
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
  const saved = environment?.variables ?? [];
  const isDirty =
    draft !== null &&
    (draft.length !== saved.length ||
      draft.some((row, index) => {
        const base = saved[index];
        return (
          base === undefined ||
          base.name !== row.name ||
          base.note !== row.note ||
          row.value !== null
        );
      }));
  const change = (id: string, patch: Partial<DraftRow>) => {
    setDraft(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setError(null);
  };
  const addRow = () =>
    setDraft([
      ...rows,
      {
        id: crypto.randomUUID(),
        nameLocked: false,
        name: "",
        value: "",
        secret: true,
        note: null,
      },
    ]);
  const importRows = (entries: readonly ParsedEnvEntry[]) => {
    const next = [...rows];
    for (const entry of entries) {
      const index = next.findIndex((row) => row.name === entry.name);
      const existing = index === -1 ? undefined : next[index];
      if (existing) next[index] = { ...existing, value: entry.value };
      else
        next.push({
          id: crypto.randomUUID(),
          nameLocked: false,
          name: entry.name,
          value: entry.value,
          secret: true,
          note: null,
        });
    }
    setDraft(next);
    setError(null);
  };
  const override = (variable: MachineEnvironmentVariable) =>
    setDraft([
      ...rows,
      { ...variable, id: variable.name, nameLocked: true, value: "" },
    ]);
  const inherited = projectScope ? inheritedVariables : [];
  const inheritedNames = new Set(inherited.map((variable) => variable.name));
  const entries: EnvironmentEntry[] = [];
  for (const variable of inherited) {
    const index = rows.findIndex((row) => row.name === variable.name);
    const row = rows[index];
    entries.push(
      row
        ? { kind: "row", row, index, overridesGlobal: true }
        : { kind: "inherited", variable },
    );
  }
  rows.forEach((row, index) => {
    if (!inheritedNames.has(row.name))
      entries.push({ kind: "row", row, index, overridesGlobal: false });
  });
  const git = environment?.builtInGit;
  const gitOverridden =
    rows.some((row) => row.name === "GH_TOKEN") ||
    inheritedNames.has("GH_TOKEN");
  return (
    <SettingsSection
      title="Environment variables"
      description="Sent to machines created by a machine provider, not to your local machine. Configure them globally or per project."
      bodyClassName="space-y-8"
    >
      <div className="space-y-5">
        {scopeControl}
        {environment === null && !loadFailed && (
          <p className="text-xs text-subtle-foreground">Loading…</p>
        )}
        {environment !== null && (
          <MachineEnvironmentAutomaticRow
            git={git}
            enabled={gitCredentialsEnabled}
            switchDisabled={gitSwitchDisabled}
            projectScope={projectScope}
            overridden={gitOverridden}
            overrideDisabled={disabled || gitOverridden}
            onSetEnabled={onSetGitCredentials}
            onOverride={() =>
              override({
                name: "GH_TOKEN",
                value: null,
                secret: true,
                note: null,
              })
            }
          />
        )}
        {environment !== null &&
          entries.map((entry) =>
            entry.kind === "inherited" ? (
              <MachineEnvironmentInheritedRow
                key={`inherited:${entry.variable.name}`}
                variable={entry.variable}
                disabled={disabled}
                onOverride={() => override(entry.variable)}
              />
            ) : (
              <MachineEnvironmentVariableRow
                key={entry.row.id}
                row={entry.row}
                index={entry.index}
                disabled={disabled}
                error={
                  touched.has(entry.row.id)
                    ? (issues[entry.index] ?? null)
                    : null
                }
                revealed={visible.has(entry.row.id)}
                caption={
                  entry.overridesGlobal ? (
                    <>
                      <RowScope>Override</RowScope>
                      {entry.row.note ??
                        "Replaces the global value; remove it to inherit again."}
                    </>
                  ) : (
                    entry.row.note
                  )
                }
                onBlur={() =>
                  setTouched((current) => new Set(current).add(entry.row.id))
                }
                onNameChange={(name) => change(entry.row.id, { name })}
                onValueChange={(value) => change(entry.row.id, { value })}
                onToggleReveal={() =>
                  setVisible((current) => {
                    const next = new Set(current);
                    if (next.has(entry.row.id)) next.delete(entry.row.id);
                    else next.add(entry.row.id);
                    return next;
                  })
                }
                onRemove={() =>
                  setDraft(rows.filter((other) => other.id !== entry.row.id))
                }
              />
            ),
          )}
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
      {environment !== null && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 sm:flex-none"
            disabled={disabled}
            onClick={addRow}
          >
            Add variable
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 sm:flex-none"
            disabled={disabled}
            onClick={() => setImporting(true)}
          >
            Import from .env
          </Button>
          <div className="ml-auto flex w-full items-center justify-end gap-2 sm:w-auto">
            {isDirty && (
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
              disabled={disabled || !isDirty || issues.some(Boolean)}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Saving…" : "Save variables"}
            </Button>
          </div>
        </div>
      )}
      <MachineEnvironmentImportDialog
        open={importing}
        onOpenChange={setImporting}
        onImport={importRows}
      />
    </SettingsSection>
  );
}

const ROW_GRID_CLASS_NAME =
  "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]";
const ROW_CAPTION_CLASS_NAME = "text-xs leading-snug text-subtle-foreground";

function GlobalSettingsLink() {
  return (
    <Link
      to={getSettingsSectionRoutePath("environment-variables")}
      className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      global settings
    </Link>
  );
}

function RowScope({ children }: { children: string }) {
  return (
    <>
      <span className="text-foreground">{children}</span>
      {" · "}
    </>
  );
}

export function MachineEnvironmentAutomaticRow({
  git,
  enabled,
  switchDisabled = false,
  projectScope = false,
  overridden = false,
  overrideDisabled = false,
  onSetEnabled,
  onOverride,
}: {
  git: MachineEnvironmentList["builtInGit"] | undefined;
  enabled: boolean;
  switchDisabled?: boolean;
  projectScope?: boolean;
  overridden?: boolean;
  overrideDisabled?: boolean;
  onSetEnabled: (enabled: boolean) => void;
  onOverride: () => void;
}) {
  const dimmed = !enabled || overridden;
  const missing = git?.status === "not logged in";
  return (
    <div className="space-y-2">
      <div className={ROW_GRID_CLASS_NAME}>
        <Input
          className={`col-span-2 font-mono sm:col-span-1 ${dimmed ? "opacity-50" : ""}`}
          aria-label="Automatic variable name"
          value="GH_TOKEN"
          readOnly
        />
        <Input
          className={`font-mono ${dimmed ? "opacity-50" : ""}`}
          aria-label="Automatic GH_TOKEN value"
          value={git?.status === "logged in" ? "••••••••" : ""}
          placeholder={
            git?.status === "disabled"
              ? "Disabled"
              : missing
                ? "Not available"
                : "Checking…"
          }
          readOnly
        />
        <div className="flex size-8 items-center justify-center">
          {projectScope ? (
            <Button
              size="icon"
              variant="ghost"
              className="size-8 text-subtle-foreground"
              aria-label="Override GH_TOKEN"
              disabled={overrideDisabled}
              onClick={onOverride}
            >
              <Icon name="Edit" className="size-4" />
            </Button>
          ) : (
            <Switch
              aria-label="Automatic GH_TOKEN"
              checked={enabled}
              disabled={switchDisabled}
              onCheckedChange={onSetEnabled}
            />
          )}
        </div>
      </div>
      <p className={`${ROW_CAPTION_CLASS_NAME} ${dimmed ? "opacity-50" : ""}`}>
        <RowScope>Automatic</RowScope>
        <span
          role={missing && !overridden ? "alert" : "status"}
          className={
            missing && !overridden ? "text-destructive-text" : undefined
          }
        >
          {overridden ? (
            "Overridden by the GH_TOKEN variable below."
          ) : missing ? (
            "GitHub is not logged in. Run gh auth login on the server, or add your own GH_TOKEN."
          ) : git?.status === "logged in" ? (
            <>
              Generated using <code>gh auth token --hostname github.com</code>.
            </>
          ) : git?.status === "disabled" ? (
            "Disabled — no automatic GitHub credentials are sent to machines."
          ) : git?.status === "overridden" ? (
            "The server’s GitHub login will be used after saving."
          ) : (
            "Checking the server’s GitHub login…"
          )}
          {projectScope ? (
            <>
              {" Managed in "}
              <GlobalSettingsLink />.
            </>
          ) : null}
        </span>
      </p>
    </div>
  );
}

export function MachineEnvironmentInheritedRow({
  variable,
  disabled = false,
  onOverride,
}: {
  variable: MachineEnvironmentVariable;
  disabled?: boolean;
  onOverride: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className={ROW_GRID_CLASS_NAME}>
        <Input
          className="col-span-2 font-mono sm:col-span-1"
          aria-label={`Global variable ${variable.name}`}
          value={variable.name}
          readOnly
        />
        <Input
          className="font-mono"
          aria-label={`Global value for ${variable.name}`}
          value="••••••••"
          readOnly
        />
        <Button
          size="icon"
          variant="ghost"
          className="size-8 text-subtle-foreground"
          aria-label={`Override ${variable.name}`}
          disabled={disabled}
          onClick={onOverride}
        >
          <Icon name="Edit" className="size-4" />
        </Button>
      </div>
      <p className={ROW_CAPTION_CLASS_NAME}>
        <RowScope>Global</RowScope>
        {variable.note ?? (
          <>
            Inherited from <GlobalSettingsLink />.
          </>
        )}
      </p>
    </div>
  );
}

export function MachineEnvironmentVariableRow({
  row,
  index,
  disabled = false,
  error = null,
  revealed = false,
  caption = null,
  onBlur,
  onNameChange,
  onValueChange,
  onToggleReveal,
  onRemove,
}: {
  row: DraftRow;
  index: number;
  disabled?: boolean;
  error?: string | null;
  revealed?: boolean;
  caption?: ReactNode;
  onBlur: () => void;
  onNameChange: (name: string) => void;
  onValueChange: (value: string) => void;
  onToggleReveal: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className={ROW_GRID_CLASS_NAME}>
        <Input
          className="col-span-2 font-mono sm:col-span-1"
          aria-label={`Variable name ${index + 1}`}
          placeholder="KEY"
          value={row.name}
          disabled={disabled}
          readOnly={row.nameLocked}
          aria-invalid={error !== null}
          onBlur={onBlur}
          onChange={(event) => onNameChange(event.target.value)}
        />
        <div className="relative min-w-0">
          <Input
            className="min-w-0 pr-9 font-mono"
            aria-label={`Value for ${row.name || `variable ${index + 1}`}`}
            type={revealed ? "text" : "password"}
            placeholder={
              row.value === null ? "Saved secret · enter to replace" : "VALUE"
            }
            value={row.value ?? ""}
            autoComplete="off"
            disabled={disabled}
            onChange={(event) => onValueChange(event.target.value)}
          />
          <Button
            size="icon"
            variant="ghost"
            className="absolute inset-y-0 right-0 my-auto size-8 text-subtle-foreground"
            aria-label={`${revealed ? "Hide" : "Show"} ${row.name || "value"}`}
            disabled={disabled || row.value === null}
            onClick={onToggleReveal}
          >
            <Icon name={revealed ? "EyeOff" : "Eye"} className="size-4" />
          </Button>
        </div>
        <Button
          size="icon"
          className="size-8 text-subtle-foreground"
          variant="ghost"
          aria-label={`Remove ${row.name || "variable"}`}
          disabled={disabled}
          onClick={onRemove}
        >
          <Icon name="X" className="size-4" />
        </Button>
      </div>
      {caption && <p className={ROW_CAPTION_CLASS_NAME}>{caption}</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}
