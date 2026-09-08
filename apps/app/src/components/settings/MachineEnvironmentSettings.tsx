import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  machineEnvironmentSetSchema,
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
import { parseMachineEnvironmentImport } from "./machine-environment-import";

const queryKey = ["machine-environment"];
type DraftRow = MachineEnvironmentVariable & { id: string; existing: boolean };

export function MachineEnvironmentSettings() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey,
    queryFn: () => sdk.system.machineEnvironment(),
  });
  const [draft, setDraft] = useState<DraftRow[] | null>(null);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rows =
    draft ??
    (query.data?.variables ?? []).map((row) => ({
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
      secret: row.secret,
      note: row.note,
    });
    return result.success
      ? null
      : "Use an uppercase variable name (letters, numbers, underscores) and a valid value.";
  });
  const mutation = useMutation({
    mutationFn: async () => {
      for (const row of rows) {
        const original = query.data?.variables.find(
          (entry) => entry.name === row.name,
        );
        if (
          row.value === null ||
          (original &&
            row.value === original.value &&
            row.secret === original.secret &&
            row.note === original.note)
        )
          continue;
        await sdk.system.setMachineEnvironment({
          name: row.name,
          value: row.value,
          secret: row.secret,
          note: row.note,
        });
      }
      for (const original of query.data?.variables ?? []) {
        if (!rows.some((row) => row.name === original.name))
          await sdk.system.unsetMachineEnvironment(original.name);
      }
    },
    onSuccess: async () => {
      await query.refetch();
      invalidateSystemConfig({ queryClient });
      setDraft(null);
      setVisible(new Set());
      setError(null);
    },
    onError: () => {
      void query.refetch();
      setError(
        "Some changes could not be saved. Your edits are retained; try saving again.",
      );
    },
  });
  const disabled = !query.data || mutation.isPending;
  const change = (id: string, patch: Partial<MachineEnvironmentVariable>) => {
    setDraft(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setError(null);
  };
  const hasOverride = rows.some((row) => row.name === "GH_TOKEN");
  const git = query.data?.builtInGit;
  const gitMissing = git?.status === "not logged in";
  return (
    <SettingsSection
      title="Machine environment"
      description="Variables shared by enrolled machines. Changes apply to new agent turns, setup commands, and terminals."
      bodyClassName="space-y-3"
    >
      <div className="flex flex-wrap gap-2">
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
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => setImportOpen(!importOpen)}
        >
          Import .env
        </Button>
      </div>
      {importOpen && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <label className="block space-y-2 text-xs">
            <span>
              Paste .env contents. Matching names replace existing values when
              you save.
            </span>
            <textarea
              className="min-h-32 w-full rounded-md border border-border bg-background p-2 font-mono text-sm"
              aria-label="Environment file contents"
              value={importText}
              disabled={disabled}
              onChange={(event) => setImportText(event.target.value)}
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || !importText.trim()}
            onClick={() => {
              try {
                const imported = parseMachineEnvironmentImport(importText);
                const next = [...rows];
                for (const entry of imported) {
                  const index = next.findIndex(
                    (row) => row.name === entry.name,
                  );
                  if (index >= 0)
                    next[index] = {
                      ...next[index]!,
                      value: entry.value,
                      secret: true,
                    };
                  else
                    next.push({
                      ...entry,
                      id: crypto.randomUUID(),
                      existing: false,
                      secret: true,
                      note: null,
                    });
                }
                setDraft(next);
                setImportText("");
                setImportOpen(false);
                setError(null);
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Could not import variables.",
                );
              }
            }}
          >
            Import variables
          </Button>
        </div>
      )}
      {!hasOverride && (
        <div
          className={`space-y-2 rounded-md border p-3 ${gitMissing ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/20"}`}
        >
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            <Input
              className="font-mono"
              aria-label="Automatic variable name"
              value="GH_TOKEN"
              readOnly
            />
            <Input
              className="font-mono"
              aria-label="Automatic GH_TOKEN value"
              value={git?.status === "logged in" ? "••••••••" : ""}
              placeholder={gitMissing ? "Not available" : "Checking…"}
              readOnly
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <SettingsBadge>Automatic</SettingsBadge>
            <span
              role={gitMissing ? "alert" : "status"}
              className={
                gitMissing ? "text-destructive-text" : "text-subtle-foreground"
              }
            >
              {gitMissing
                ? "GitHub is not logged in. Run gh auth login on the server, or add your own GH_TOKEN."
                : git?.status === "logged in"
                  ? "Provided by the server’s GitHub login."
                  : git?.status === "overridden"
                    ? "The server’s GitHub login will be used after saving."
                    : "Checking the server’s GitHub login…"}
            </span>
          </div>
        </div>
      )}
      {rows.map((row, index) => (
        <div
          key={row.id}
          className="space-y-2 rounded-md border border-border p-3"
        >
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            <Input
              className="font-mono"
              aria-label={`Variable name ${index + 1}`}
              placeholder="KEY"
              value={row.name}
              disabled={disabled || row.existing}
              aria-invalid={issues[index] !== null}
              onChange={(event) =>
                change(row.id, {
                  name: event.target.value,
                  ...(event.target.value === "GH_TOKEN"
                    ? { secret: true }
                    : {}),
                })
              }
            />
            <div className="flex min-w-0 gap-1">
              <Input
                className="min-w-0 font-mono"
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
                size="sm"
                variant="ghost"
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
                {visible.has(row.id) ? "Hide" : "Show"}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs text-subtle-foreground">
              <input
                type="checkbox"
                checked={row.secret}
                disabled={
                  disabled || row.name === "GH_TOKEN" || row.value === null
                }
                onChange={(event) =>
                  change(row.id, { secret: event.target.checked })
                }
              />
              Secret
            </label>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove ${row.name || "variable"}`}
              disabled={disabled}
              onClick={() =>
                setDraft(rows.filter((entry) => entry.id !== row.id))
              }
            >
              Remove
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
          {issues[index] && (
            <p role="alert" className="text-xs text-destructive-text">
              {issues[index]}
            </p>
          )}
        </div>
      ))}
      {query.isError && (
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
